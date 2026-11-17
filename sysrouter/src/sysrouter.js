// sysrouter.js — the GrowBot System Router. One registry for the fast paths.
// A ROUTE is a typed question about what was just said (yes/no, pick one, score) plus a table
// of which registered ACTION each answer may trigger. A PROVIDER answers the question: Brit's
// own regex readers, an on-device model, Jev, Clef, a small language model. The router asks,
// checks the answer, and at most selects an action the page registered. Zero dependencies.
//
// Laws (sysrouter/SPEC.md has the reasons, sysrouter/test/ proves each one):
//   • SELECT, NEVER AUTHOR. An answer can only pick a key of route.on, and that key can only
//     name an action the PAGE registered. No engine output reaches the body any other way.
//   • SHADOW FIRST. A route acts on nothing until its mode says so. Default mode: "shadow".
//   • NO THRESHOLD, NO ACTION. A probabilistic provider with no calibrated gate for this
//     route never acts. Gates are data (calibrate()), fitted on held-out data, per model.
//   • FAIL TO TODAY. Timeout, error, bad answer, missing key, low confidence, stale words:
//     nothing happens, the row says why, the words go down the path they take today.
//   • THE PERSON'S NEWEST WORDS DECIDE. An answer that lands after newer words is dropped.
//   • STOP IS CODE. Reserved actions are registered by the page before seal(), run for any
//     tier's deterministic route, and can never be blocked, delayed or held off by a route.
//
// Usage:
//   import { createRouter } from '/sysrouter/sysrouter.js';
//   const sr = createRouter({ log: logEv });
//   sr.action('perk', { run: () => playExpression('perk'), resource: 'legs', holdMs: 3000 });
//   sr.provider('readers', readersProvider(_ftWords));          // sync, exact
//   sr.provider('clef-flash', httpProvider({ ... }));            // async, probabilistic
//   sr.route({ id: 'wake', question: {...}, on: { halt: 'halt' }, providers: ['readers', 'clef-flash'], policy: 'cascade' });
//   sr.calibrate({ wake: { 'clef-flash': { p: 0.93 } } });
//   sr.seal();                                                   // no reserved action or core route after this
//   // in sendTxtFrom, after the local readers:  try{ if(typeof SysRouter!=="undefined") SysRouter.hear(t); }catch(_sr){}

import { ID, KEY, GATE, dict, copyDict, checkArgs, readPrimitive as checkPrim, sha256Hex } from './registry.js';

const TIERS = { core: 0, system: 1, extension: 2 };          // lower number = higher priority
const MODES = ['shadow', 'live'], POLICIES = ['single', 'cascade', 'race'], TYPES = ['noul', 'choice', 'score'];
const PRIMITIVES = ['noul', 'choice', 'score', 'generate', 'match', 'embed', 'query', 'sense', 'actuate'];
const EXPOSE_TO = ['third-party', 'creature', 'person'], ARG_TYPES = ['number', 'string', 'boolean', 'enum'];
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Kill switch and per-route modes, the codebase's way: read from the URL, persisted to
// localStorage, so a link turns it off and it stays off (?bodysnd=0, ?stream=0 do the same).
//   ?sysrouter=0            everything off          ?sysrouter=1   back on
//   ?sysroute=wake:live,express:off                 per route: off | shadow | live
export function readFlags(search, storage) {
  const f = { off: false, routes: {} };
  try {
    const q = new URLSearchParams(search || ''), a = q.get('sysrouter'), b = q.get('sysroute');
    if (a === '0' || a === '1') storage.gb_sysrouter = a;
    if (b !== null) storage.gb_sysroute = b;
    f.off = storage.gb_sysrouter === '0';
    for (const part of String(storage.gb_sysroute || '').split(',')) {
      const [id, rawM] = part.split(':'), m = rawM === 'parallel' ? 'live' : rawM;
      if (ID.test(id || '') && (m === 'off' || MODES.includes(m))) f.routes[id] = m;
    }
  } catch (e) {}
  return f;
}

// One answer, any question type -> { pick, p, second }. Returns null for anything malformed:
// a vendor reply is untrusted input (R-SAFE-2), so every field is checked before it is used.
export function readAnswer(q, a) {
  if (!a || typeof a !== 'object') return null;
  const ok = (x) => typeof x === 'number' && x >= 0 && x <= 1;
  if (q.type === 'noul') { if (!ok(a.noul)) return null; return { pick: a.noul >= 0.5 ? 'true' : 'false', p: Math.max(a.noul, 1 - a.noul), second: Math.min(a.noul, 1 - a.noul) }; }
  let pick, pr = a.probabilities;
  if (!pr || typeof pr !== 'object') return null;
  if (q.type === 'choice') { pick = a.choice; if (typeof pick !== 'string' || !has(q.criteria, pick)) return null; }
  else {   // score: levels are numbered from 0 in the reply's legend (measured on jev-1.14, 2026-11-17); `score` is the expected value and can sit between levels, so the pick is the most probable level
    for (const k in pr) if (has(pr, k)) { if (!/^\d$/.test(k) || +k >= q.criteria.length) return null; if (pick === undefined || pr[k] > pr[pick]) pick = k; }
    if (pick === undefined) return null;
  }
  let p = pr[pick], second = 0;
  if (!ok(p)) return null;
  for (const k in pr) if (k !== pick && has(pr, k)) { if (!ok(pr[k]) || (q.type === 'choice' && !has(q.criteria, k))) return null; if (pr[k] > second) second = pr[k]; }
  return { pick, p, second };
}

export function readPrimitive(prim, spec, raw) { return checkPrim(prim, spec, raw, readAnswer); }

export function createRouter(opts) {
  opts = opts || {};
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const now = opts.now || (() => Date.now());
  const flags = opts.flags || { off: false, routes: {} };
  const actions = dict(), providers = dict(), routes = dict(), capabilities = dict(), triggers = dict(), installed = dict(), gates = dict(), held = dict(), last = dict(), seqOf = dict(), spend = dict(), lastPick = dict(), flight = dict(), health = dict(), paid = dict(), streams = dict();
  // reliability limits, all overridable: a provider that fails BREAK.fails times in a row is left alone for BREAK.ms; hosted engines stop being asked once the session has spent maxUsd
  const BREAK = { fails: Math.max(1, +(opts.breaker && opts.breaker.fails) || 3), ms: Math.max(0, +(opts.breaker && opts.breaker.ms) || 30000) }, maxUsd = opts.maxUsd >= 0 ? +opts.maxUsd : 0.25;
  const maxHops = Number.isInteger(opts.maxHops) && opts.maxHops >= 0 ? opts.maxHops : 3;
  let sealed = false, seq = 0, evSeq = 0, activeHop = -1, usd = 0;
  let blockList = { names: new Set(), hashes: new Set() };
  function setBlockList(bl) {
    const names = new Set(Array.isArray(bl && bl.names) ? bl.names.map(String) : []);
    const hashes = new Set(Array.isArray(bl && bl.hashes) ? bl.hashes.map((h) => String(h).toLowerCase()) : []);
    blockList = { names, hashes };
    for (const n of Object.keys(installed)) {
      if (names.has(n) || hashes.has(installed[n].hash)) uninstall(n);
    }
  }
  if (opts.blockList) setBlockList(opts.blockList);

  streams['speech'] = { id: 'speech', tier: 'core', owner: '', types: { person: true, creature: true }, latest: null, watchers: [] };

  function row(r, why, x) {   // one journal row per decision (R-OBS-1). Never the words: the funnel's own "user" row holds their hash.
    const o = { r: r.id, tier: r.tier, mode: modeOf(r), why };
    if (r.owner) o.ext = r.owner;
    if (x) for (const k in x) if (x[k] !== undefined && x[k] !== null && x[k] !== '') o[k] = x[k];
    if (r.agree && o.a && why !== 'agree' && why !== 'shadow_arm') lastPick[r.id] = o.a;
    try { log('sysroute', o); } catch (e) {}
    return o;
  }
  const modeOf = (r) => flags.off ? 'off' : (flags.routes && has(flags.routes, r.id) ? flags.routes[r.id] : r.mode);
  const gateOf = (r, pid, model) => { if (!model) return null; const g = gates[r.id] || dict(); return g[pid + '@' + model] || null; };

  const assertOpen = () => { if (sealed) throw new Error('sysrouter: sealed'); };

  function addStream(rawDecl, who) {
    if (!rawDecl || typeof rawDecl !== 'object') throw new Error('sysrouter: bad stream');
    const id = rawDecl.id, rt = rawDecl.types;
    if (!ID.test(id || '')) throw new Error('sysrouter: bad stream id ' + id);
    if (has(streams, id)) throw new Error('sysrouter: stream exists: ' + id);
    const types = dict();
    if (Array.isArray(rt)) { for (const t of rt) if (typeof t === 'string' && KEY.test(t)) types[t] = true; }
    else if (rt && typeof rt === 'object') { for (const t of Object.keys(rt)) if (KEY.test(t) && !(t in Object.prototype)) types[t] = true; }
    if (!Object.keys(types).length) throw new Error('sysrouter: stream ' + id + ' needs types');
    streams[id] = { id, tier: who.tier, owner: who.name || '', types, latest: null, watchers: [] };
    return id;
  }
  function emit(streamId, event) {
    if (flags.off) return null;
    const s = has(streams, streamId) ? streams[streamId] : null;
    if (!s || !event || typeof event !== 'object' || typeof event.type !== 'string' || !has(s.types, event.type)) throw new Error('sysrouter: bad event for ' + streamId);
    const hop = activeHop >= 0 ? activeHop + 1 : 0;
    if (hop > maxHops) { row({ id: streamId, tier: s.tier, owner: s.owner, mode: 'live' }, 'hops', { stream: streamId, type: event.type, hop }); return null; }
    const raw = event.data, data = typeof raw === 'string' ? (raw.length > 600 ? raw.slice(0, 600) : raw) : raw;
    const ev = Object.freeze({ stream: streamId, type: event.type, data, t: now(), seq: ++evSeq, hop });
    s.latest = ev;
    const prevHop = activeHop; activeHop = hop;
    try {
      for (const fn of s.watchers.slice()) { try { fn(ev); } catch (e) {} }
      for (const tid in triggers) {
        const tr = triggers[tid];
        if (tr.on.stream === streamId && (!tr.on.type || tr.on.type === ev.type)) fireTrigger(tr, ev.data);
      }
    }
    finally { activeHop = prevHop; }
    return ev;
  }
  const read = (streamId) => has(streams, streamId) ? streams[streamId].latest : null;
  function watch(streamId, fn) {
    if (!has(streams, streamId) || typeof fn !== 'function') throw new Error('sysrouter: bad watch ' + streamId);
    const ws = streams[streamId].watchers;
    ws.push(fn);
    return () => { const i = ws.indexOf(fn); if (i >= 0) ws.splice(i, 1); };
  }

  function addCommand(rawSpec, who) {
    if (!rawSpec || typeof rawSpec !== 'object') throw new Error('sysrouter: bad command');
    const id = rawSpec.id, cap = rawSpec.capability, run = rawSpec.run, rArgs = rawSpec.args, rExp = rawSpec.exposeTo;
    const resource = rawSpec.resource ? String(rawSpec.resource) : '', holdMs = +rawSpec.holdMs || 0, cooldownMs = Math.max(0, +rawSpec.cooldownMs || 0), reserved = !!rawSpec.reserved;
    if (!ID.test(id || '')) throw new Error('sysrouter: bad command ' + id);
    if (has(actions, id)) throw new Error('sysrouter: action exists: ' + id);
    if (reserved && sealed) throw new Error('sysrouter: reserved actions are registered before seal()');
    if (who.tier !== 'extension') assertOpen();
    if (typeof run !== 'function' && (typeof cap !== 'string' || !ID.test(cap))) throw new Error('sysrouter: command ' + id + ' needs capability or run');
    const exposeTo = [];
    if (rExp !== undefined) {
      if (!Array.isArray(rExp)) throw new Error('sysrouter: bad exposeTo');
      for (const e of rExp) { if (!EXPOSE_TO.includes(e)) throw new Error('sysrouter: bad exposeTo ' + e); if (!exposeTo.includes(e)) exposeTo.push(e); }
    }
    let args = null;
    if (rArgs !== undefined && rArgs !== null) {
      if (typeof rArgs !== 'object' || Array.isArray(rArgs)) throw new Error('sysrouter: bad args schema');
      args = dict();
      for (const k of Object.keys(rArgs)) {
        if (!KEY.test(k) || (k in Object.prototype)) throw new Error('sysrouter: bad arg name ' + k);
        const d = rArgs[k];
        if (!d || typeof d !== 'object' || !ARG_TYPES.includes(d.type)) throw new Error('sysrouter: bad arg type ' + k);
        const entry = { type: d.type };
        if (d.type === 'number') { if (d.min !== undefined) entry.min = +d.min; if (d.max !== undefined) entry.max = +d.max; }
        if (d.type === 'string' && d.maxLen !== undefined) entry.maxLen = Math.max(0, +d.maxLen);
        if (d.type === 'enum') {
          if (!Array.isArray(d.values) || !d.values.length || !d.values.every((v) => typeof v === 'string')) throw new Error('sysrouter: enum needs values');
          entry.values = Object.freeze(d.values.slice());
        }
        args[k] = Object.freeze(entry);
      }
    }
    actions[id] = { id, tier: who.tier, owner: who.name || '', run: typeof run === 'function' ? run : null, capability: typeof cap === 'string' ? cap : '', args, exposeTo: Object.freeze(exposeTo), resource, holdMs, cooldownMs, reserved };
    return id;
  }

  function action(id, a) {
    if (!ID.test(id) || !a || typeof a.run !== 'function') throw new Error('sysrouter: bad action ' + id);
    if (has(actions, id)) throw new Error('sysrouter: action exists: ' + id);
    if (a.reserved && sealed) throw new Error('sysrouter: reserved actions are registered before seal()');
    assertOpen();
    return addCommand({ id, run: a.run, resource: a.resource, holdMs: a.holdMs, reserved: a.reserved, exposeTo: a.exposeTo }, { tier: 'system' });
  }
  function provider(id, p) {
    assertOpen();
    if (!ID.test(id) || !p || typeof p.ask !== 'function') throw new Error('sysrouter: bad provider ' + id);
    if (has(providers, id)) throw new Error('sysrouter: provider exists: ' + id);
    const prims = dict();
    if (p.primitives && typeof p.primitives === 'object' && !Array.isArray(p.primitives)) {
      for (const k of Object.keys(p.primitives)) {
        if (!PRIMITIVES.includes(k)) throw new Error('sysrouter: unknown primitive ' + k);
        prims[k] = p.primitives[k] && typeof p.primitives[k] === 'object' ? Object.assign({}, p.primitives[k]) : {};
      }
      if (has(prims, 'match') && !has(prims, 'choice')) prims.choice = prims.match;
    } else {
      for (const k of (p.types || TYPES)) {
        if (!PRIMITIVES.includes(k)) throw new Error('sysrouter: unknown primitive ' + k);
        prims[k] = {};
      }
    }
    providers[id] = { ask: p.ask, sync: !!p.sync, exact: !!p.exact, inFunnel: !!p.inFunnel, model: String(p.model || ''), types: Object.keys(prims), primitives: prims };
    if (has(prims, 'sense') && typeof p.subscribeSense === 'function') {
      p.subscribeSense((ev) => {
        if (!flags.off && ev && has(streams, ev.stream) && has(streams[ev.stream].types, ev.type)) emit(ev.stream, { type: ev.type, data: ev.data });
      });
    }
  }
  function calibrate(table) {   // { routeId: { 'providerId' or 'providerId@model': { p, pn, margin } } }
    assertOpen();
    if (!table || typeof table !== 'object') return;
    for (const rid of Object.keys(table)) { if (!ID.test(rid) || !table[rid] || typeof table[rid] !== 'object') continue; gates[rid] = gates[rid] || dict();
      for (const k of Object.keys(table[rid])) { const g = table[rid][k]; if (GATE.test(k) && g && g.p > 0.5 && g.p <= 1) gates[rid][k] = { p: +g.p, pn: g.pn > 0.5 && g.pn <= 1 ? +g.pn : +g.p, margin: +g.margin || 0 }; } }
  }

  // Registration is DATA: no function crosses this line, so the same call works from a Worker
  // or an iframe by message (R-TRUST-5). `who` is set by the loader, never read from the spec.
  function addRoute(rawSpec, who) {
    if (!rawSpec || typeof rawSpec !== 'object') throw new Error('sysrouter: route ' + (rawSpec && rawSpec.id) + ': bad id');
    const rq = rawSpec.question, rcrit = rq && typeof rq === 'object' ? rq.criteria : null;
    const rp = rawSpec.providers, rs = rawSpec.shadow, ro = rawSpec.on;
    const spec = {
      id: rawSpec.id,
      question: rq && typeof rq === 'object' ? { type: rq.type, instructions: rq.instructions, criteria: Array.isArray(rcrit) ? rcrit.slice() : copyDict(rcrit) } : null,
      notFor: rawSpec.notFor, mode: rawSpec.mode, policy: rawSpec.policy,
      providers: Array.isArray(rp) ? rp.slice() : rp,
      shadow: Array.isArray(rs) ? rs.slice() : rs,
      on: ro === undefined ? dict() : copyDict(ro),
      addsRecall: rawSpec.addsRecall, budgetMs: rawSpec.budgetMs, cooldownMs: rawSpec.cooldownMs, input: rawSpec.input, agree: rawSpec.agree
    };
    const fail = (m) => { throw new Error('sysrouter: route ' + spec.id + ': ' + m); };
    if (!ID.test(spec.id || '')) fail('bad id');
    if (has(routes, spec.id)) fail('exists');
    const q = spec.question;
    if (!q || !TYPES.includes(q.type) || typeof q.instructions !== 'string' || !q.instructions.trim()) fail('question needs type and instructions');
    if (q.type === 'score' ? !(Array.isArray(q.criteria) && q.criteria.length >= 2 && q.criteria.length <= 10) : !(q.criteria && typeof q.criteria === 'object' && !Array.isArray(q.criteria))) fail('bad criteria');
    if (q.type === 'choice' && (Object.keys(q.criteria).length < 2 || Object.keys(q.criteria).length > 64)) fail('choice needs 2-64 options');
    if (q.instructions.length > 600) fail('instructions over 600 characters');
    if (q.type !== 'score' && !Object.keys(q.criteria).every((k) => KEY.test(k) && !(k in Object.prototype) && typeof q.criteria[k] === 'string' && q.criteria[k].length <= 300)) fail('option names are plain words, descriptions are strings up to 300 characters');
    if (q.type === 'score' && !q.criteria.every((c) => typeof c === 'string' && c.length <= 300)) fail('score levels are strings up to 300 characters');
    if (q.type === 'noul' && Object.keys(q.criteria).sort().join() !== 'false,true') fail('a yes/no question has criteria true and false');
    const criteria = q.type === 'score' ? Object.freeze(q.criteria.slice()) : Object.freeze(Object.assign({}, q.criteria));
    if (typeof spec.notFor !== 'string' || spec.notFor.trim().length < 12) fail('notFor is required: say what this route must NOT fire on (R-REG-5)');
    const rawMode = spec.mode || 'shadow', mode = rawMode === 'parallel' ? 'live' : rawMode, policy = spec.policy || 'single';
    if (!MODES.includes(mode) || !POLICIES.includes(policy)) fail('bad mode or policy');
    const ps = spec.providers || [], sh = spec.shadow || [];
    if (!Array.isArray(ps) || !Array.isArray(sh) || !ps.length || ps.length > 4 || sh.length > 4) fail('1-4 providers');
    for (const pid of ps.concat(sh)) { if (!has(providers, pid)) fail('unknown provider ' + pid); if (!providers[pid].types.includes(q.type)) fail(pid + ' cannot answer ' + q.type); }
    if (policy === 'single' && ps.length !== 1) fail('single takes one provider');
    if (spec.on === null) fail('bad on');
    const on = spec.on, keys = q.type === 'noul' ? ['true', 'false'] : q.type === 'choice' ? Object.keys(q.criteria) : q.criteria.map((_, i) => String(i));
    const onArgs = dict();
    for (const k of Object.keys(on)) {
      if (!keys.includes(k)) fail('on.' + k + ' is not an answer');
      const rawEntry = on[k], aid = typeof rawEntry === 'string' ? rawEntry : (rawEntry && typeof rawEntry === 'object' && typeof rawEntry.command === 'string' ? rawEntry.command : '');
      if (!aid || !has(actions, aid)) fail('unknown action ' + aid);
      on[k] = aid;
      if (rawEntry && typeof rawEntry === 'object' && rawEntry.args !== undefined) onArgs[k] = copyDict(rawEntry.args);
      const a = actions[aid];
      // a reserved action (stop, halt) is reachable only through an exact provider chain: a probability may never be the only thing between words and a stop, in either direction (R-SAFE-1)
      if (a.reserved && !(who.tier === 'core' || ps.every((pid) => providers[pid].exact) || spec.addsRecall === true)) fail('reserved action needs exact providers, or addsRecall:true');
      if (a.reserved && who.tier === 'extension') fail('extensions cannot reach reserved actions');
      if (who.grants && !who.grants.actions.includes(aid)) fail('no grant for action ' + aid);
    }
    if (who.grants) for (const pid of ps.concat(sh)) if (!who.grants.providers.includes(pid)) fail('no grant for provider ' + pid);
    for (const rid in routes) {   // collisions (R-REG-5): two acting routes may not both claim one answer of one identical question
      const o = routes[rid]; if (o.question.instructions === q.instructions && Object.keys(on).some((k) => has(o.on, k) && o.on[k] !== on[k])) fail('collides with ' + rid);
    }
    routes[spec.id] = { id: spec.id, tier: who.tier, owner: who.name || '', question: Object.freeze({ type: q.type, instructions: q.instructions, criteria }),
      on: Object.freeze(Object.assign(dict(), on)), onArgs, providers: ps.slice(), shadow: sh.slice(), policy, mode, notFor: spec.notFor,
      budgetMs: Math.max(20, Math.min(10000, +spec.budgetMs || 1500)), cooldownMs: Math.max(0, +spec.cooldownMs || 0),
      input: spec.input === 'creature' || spec.input === 'both' ? spec.input : 'person', agree: typeof spec.agree === 'string' ? spec.agree : '', perMin: who.grants ? who.grants.perMin : 0 };
    return spec.id;
  }
  function dropRoute(id, who) { const r = routes[id]; if (!r || (who.name || '') !== r.owner || r.tier !== who.tier) return false; delete routes[id]; return true; }

  // The loader hands an extension this facade and nothing else (R-TRUST-1..4): it can add and
  // remove ITS OWN routes, over the actions and providers it was granted, at its own rate cap.
  function normPerms(p) {
    const acts = ((p && (p.commands || p.actions)) || []).slice();
    if (acts.some((id) => actions[id] && actions[id].reserved)) throw new Error('sysrouter: extensions cannot be granted reserved actions');
    const engs = ((p && (p.engines || p.providers)) || []).slice();
    const strms = ((p && p.streams) || []).slice();
    const perMin = Math.max(1, Math.min(120, +(p && p.perMin) || 20));
    const pMaxUsd = p && p.maxUsd >= 0 ? +p.maxUsd : 0;
    return { actions: acts, providers: engs, streams: strms, perMin, maxUsd: pMaxUsd };
  }
  function extension(name, grants) {
    assertOpen();
    if (!ID.test(name)) throw new Error('sysrouter: bad extension name');
    if (blockList.names.has(name)) throw new Error('sysrouter: blocked extension name ' + name);
    const p = normPerms(grants);
    const who = { tier: 'extension', name, grants: p };
    const snap = () => JSON.parse(JSON.stringify(who.grants));
    return Object.freeze({ route: (spec) => addRoute(spec, who), unroute: (id) => dropRoute(id, who), grants: snap });
  }

  function act(r, pick, x, rawArgs) {
    const aid = has(r.on, pick) ? r.on[pick] : '', mode = modeOf(r);
    if (!aid) return row(r, 'none', x);
    const a = actions[aid], t = now(), tier = TIERS[r.tier];
    x.act = aid;
    if (mode === 'shadow') return row(r, 'shadow', x);
    const clearHolds = () => { for (const k in held) delete held[k]; };
    if (x.p && providers[x.p] && providers[x.p].inFunnel) {
      if (a.reserved) clearHolds();
      x.did = 0;
      return row(r, 'readers_acted', x);
    }
    let checkedArgs = rawArgs !== undefined ? rawArgs : (r.onArgs && has(r.onArgs, pick) ? r.onArgs[pick] : undefined);
    if (a.args) { const okArgs = checkArgs(a.args, checkedArgs); if (!okArgs) return row(r, 'bad_args', x); checkedArgs = okArgs; }
    const cd = a.cooldownMs || r.cooldownMs;
    if (!a.reserved) {
      if (cd && t - (last[r.id + '>' + aid] || -1e15) < cd) return row(r, 'cooldown', x);   // per action: a debounce against the same thing twice, never a block on a different command
      const h = a.resource && held[a.resource];
      if (h && h.until > t && h.tier < tier) return row(r, 'held', x);                 // a lower tier never pre-empts what a higher tier holds (R-TRUST-2)
    }
    try { if (a.run) a.run({ route: r.id, pick, tier: r.tier, args: checkedArgs }); } catch (e) { return row(r, 'act_error', x); }
    last[r.id + '>' + aid] = t;
    if (a.reserved) clearHolds();                                                        // a stop clears every hold, whoever owns it
    else if (a.resource && a.holdMs) held[a.resource] = { tier, until: t + a.holdMs };
    if (!a.run && a.capability && has(capabilities, a.capability)) resolveCapability(capabilities[a.capability], checkedArgs, mode);
    x.did = 1;
    return row(r, 'acted', x);
  }

  // Ask one provider. Sync providers answer in the same tick: a deterministic stop is never
  // behind a promise. Returns { d, x } where d is the checked decision or null.
  function settle(r, pid, res, t0) {
    const P = providers[pid], x = { p: pid, ms: Math.round(now() - t0) };
    if (!res || typeof res !== 'object' || !res.answers) return { d: null, x, why: 'bad_answer' };
    if (res.model) x.m = String(res.model).replace(/[^\w.\/:@~-]/g, '').slice(0, 48);
    if (Number.isFinite(res.usd) && res.usd >= 0) { x.usd = res.usd; usd += res.usd; if (res.usd > 0) paid[pid] = true; }
    if (res.usage && res.usage.input_tokens >= 0) x.tok = res.usage.input_tokens;
    const raw = res.answers.q;
    if (raw && raw.abstain) return { d: null, x, why: 'abstain' };                      // "my rules do not cover this": escalate, never a confident none
    const d = readAnswer(r.question, raw);
    if (!d) return { d: null, x, why: 'bad_answer' };
    x.a = d.pick; x.pr = Math.round(d.p * 1000) / 1000;
    const g = P.exact ? { p: 0, pn: 0, margin: 0 } : gateOf(r, pid, res.model || P.model);
    if (!g) return { d: null, x, why: 'no_gate' };
    // an answer that triggers nothing has its own gate (pn): how sure "nothing was asked" must be before a cascade stops there instead of asking the next engine
    if (d.p < (has(r.on, d.pick) ? g.p : g.pn) || d.p - d.second < g.margin) return { d: null, x, why: 'unsure' };
    return { d, x, why: '' };
  }
  function askAsync(r, pid, req, signal) {
    const t0 = now(), skip = (why) => Promise.resolve({ d: null, x: { p: pid, ms: 0 }, why }), h = health[pid] || (health[pid] = { fails: 0, until: 0 });
    const whyAbort = () => signal.reason === 'stale' ? 'stale' : signal.reason === 'won' ? 'lost' : 'timeout';
    if (signal.aborted) return skip(whyAbort());                                                  // the budget is spent or newer words arrived: nobody else is asked (found by test/fuzz_router.mjs: a second engine asked after the deadline never settled)
    if (h.until > t0) return skip('open');                                                       // circuit breaker: this engine just failed several times running, so it is not asked and the cascade moves on
    if (paid[pid] && usd >= maxUsd) return skip('budget');                                       // spend cap: an engine that charges is not asked once the session has spent its limit
    const mark = (res) => { if (res.why === 'error' || res.why === 'timeout' || res.why === 'bad_answer') { if (++h.fails >= BREAK.fails) { h.fails = 0; h.until = now() + BREAK.ms; } } else if (res.why !== 'stale' && res.why !== 'lost') h.fails = 0; return res; };
    let onAbort;
    const aborted = new Promise((_, rej) => { onAbort = () => rej(new Error('aborted')); signal.addEventListener('abort', onAbort, { once: true }); });
    const p = Promise.resolve().then(() => providers[pid].ask(req, { signal, route: r.id }));
    p.catch(() => {});
    return Promise.race([p, aborted]).finally(() => signal.removeEventListener('abort', onAbort)).then(
      (res) => signal.aborted ? { d: null, x: { p: pid, ms: Math.round(now() - t0) }, why: whyAbort() } : settle(r, pid, res, t0),
      () => ({ d: null, x: { p: pid, ms: Math.round(now() - t0) }, why: signal.aborted ? whyAbort() : 'error' })
    ).then(mark);
  }

  function resolve(r, req, fresh, finish) {
    const rid = r.id;
    // 1. the leading sync providers, in order, in this tick
    let i = 0, decided = false;
    for (; i < r.providers.length && providers[r.providers[i]].sync; i++) {
      const t0 = now(); let res;
      try { res = settle(r, r.providers[i], providers[r.providers[i]].ask(req, { route: rid }), t0); } catch (e) { res = { d: null, x: { p: r.providers[i] }, why: 'error' }; }
      if (res.d) { finish(res); decided = true; break; }
      if (r.policy === 'single' || i === r.providers.length - 1 || res.why !== 'abstain') row(r, res.why, res.x);
    }
    const rest = decided ? [] : r.providers.slice(i);
    if (!rest.length && !r.shadow.length) return null;
    // 2. the async providers, outside the brain's single flight (R-RT-5), under the route's budget
    if (flight[rid]) flight[rid].abort('stale');                                         // one flight per route: the engines still working on older words are told to stop
    const ctl = flight[rid] = new AbortController(), sctl = new AbortController(), timer = setTimeout(() => { ctl.abort('timeout'); sctl.abort('timeout'); }, r.budgetMs);
    const sh = r.shadow.map((pid) => askAsync(r, pid, req, sctl.signal).then((res) => { row(r, 'shadow_arm', Object.assign(res.x, { arm: res.why || 'ok' })); }));
    let main;
    if (r.policy === 'race') main = new Promise((done) => { let left = rest.length, won = false; if (!left) done();
      rest.forEach((pid) => askAsync(r, pid, req, ctl.signal).then((res) => { if (res.d && !won) { won = true; if (fresh()) finish(res); else row(r, 'stale', res.x); ctl.abort('won'); } else if (!res.d && !won && res.why !== 'lost' && (left === 1 || res.why !== 'abstain')) row(r, res.why, res.x); if (!--left || won) done(); })); });   // first CONFIDENT answer wins, not first to arrive
    else main = rest.reduce((chain, pid, k) => chain.then((got) => got ? got : askAsync(r, pid, req, ctl.signal).then((res) => {
      if (!fresh()) { row(r, 'stale', res.x); return true; }
      if (res.d) { finish(res); return true; }
      if (k === rest.length - 1 || res.why !== 'abstain') row(r, res.why, res.x);     // every engine consulted writes a row except a non-final abstain
      return false; })), Promise.resolve(false));
    const end = () => { clearTimeout(timer); if (flight[rid] === ctl) delete flight[rid]; };
    return Promise.all([main].concat(sh)).then(end, end);
  }

  function hear(text, meta) {
    meta = meta || {};
    const out = { acted: [], done: null }, waits = [], from = meta.from === 'creature' ? 'creature' : 'person';
    if (flags.off || typeof text !== 'string' || !text.trim()) { out.done = Promise.resolve(out); return out; }
    const ev = emit('speech', { type: from, data: text });
    if (!ev) { out.done = Promise.resolve(out); return out; }
    const state = ev.data, my = ++seq, prevHop = activeHop;
    activeHop = ev.hop;
    try { for (const rid in routes) {
      const r = routes[rid];
      if (modeOf(r) === 'off' || (r.input !== 'both' && r.input !== from)) continue;
      if (r.perMin) { const m = Math.floor(now() / 60000), s = spend[r.owner] = spend[r.owner] && spend[r.owner].m === m ? spend[r.owner] : { m, n: 0 }; if (++s.n > r.perMin) { row(r, 'rate'); continue; } }
      seqOf[rid] = my;
      const req = { state, questions: { q: r.question } }, fresh = () => seqOf[rid] === my;
      const finish = (res) => { const o = act(r, res.d.pick, res.x); if (o.did) out.acted.push(o.act); };
      const p = resolve(r, req, fresh, finish);
      if (p) waits.push(p);
    } } finally { activeHop = prevHop; }
    out.done = Promise.all(waits).then(() => out);
    return out;
  }

  // Shadow agreement (R-OBS-3): when the brain's reply lands, say whether it agreed with what
  // each route decided for the same words. route.agree names the reply field to compare.
  function replied(reply) {
    if (flags.off || !reply || typeof reply !== 'object') return;
    for (const rid in routes) { const r = routes[rid], lp = lastPick[rid]; if (!r.agree || !lp) continue; delete lastPick[rid];
      row(r, 'agree', { a: lp, brain: typeof reply[r.agree] === 'string' ? reply[r.agree].slice(0, 24) : '', ok: reply[r.agree] === lp ? 1 : 0 }); }
  }

  function addCapability(rawSpec, who) {
    if (!rawSpec || typeof rawSpec !== 'object') throw new Error('sysrouter: bad capability');
    const id = rawSpec.id, rawSteps = rawSpec.steps, rawBeh = rawSpec.behavior;
    const capPolicy = rawSpec.policy || 'single', budgetMs = Math.max(20, Math.min(10000, +rawSpec.budgetMs || 1500));
    const rawMode = rawSpec.mode || 'shadow', mode = rawMode === 'parallel' ? 'live' : rawMode;
    const addsRecall = !!rawSpec.addsRecall, agree = typeof rawSpec.agree === 'string' ? rawSpec.agree : '';
    if (!ID.test(id || '')) throw new Error('sysrouter: bad capability id ' + id);
    if (has(capabilities, id)) throw new Error('sysrouter: capability exists: ' + id);
    if (!MODES.includes(mode) || !POLICIES.includes(capPolicy)) throw new Error('sysrouter: bad mode or policy');
    if (!Array.isArray(rawSteps) || !rawSteps.length || rawSteps.length > 8) throw new Error('sysrouter: capability needs 1-8 steps');
    const steps = [];
    for (const st of rawSteps) {
      if (!st || typeof st !== 'object' || !PRIMITIVES.includes(st.primitive)) throw new Error('sysrouter: bad capability step');
      const prim = st.primitive, eng = (st.engines || st.providers || []).slice(), pol = st.policy || capPolicy;
      if (!eng.length || eng.length > 4 || !POLICIES.includes(pol)) throw new Error('sysrouter: bad step engines/policy');
      if (pol === 'single' && eng.length !== 1) throw new Error('sysrouter: single takes one engine');
      for (const pid of eng) {
        if (!has(providers, pid)) throw new Error('sysrouter: unknown provider ' + pid);
        if (!has(providers[pid].primitives, prim) && !providers[pid].types.includes(prim)) throw new Error(pid + ' cannot run ' + prim);
        if (who.grants && !who.grants.providers.includes(pid)) throw new Error('sysrouter: no grant for provider ' + pid);
      }
      let question = null;
      if (TYPES.includes(prim) || prim === 'match') {
        const rq = st.question || { type: prim === 'match' ? 'choice' : prim, instructions: st.instructions || id, criteria: st.criteria };
        const qt = rq.type, crit = rq.criteria;
        if (!TYPES.includes(qt) || typeof rq.instructions !== 'string' || !rq.instructions.trim()) throw new Error('sysrouter: bad step question');
        const cCopy = Array.isArray(crit) ? Object.freeze(crit.slice()) : Object.freeze(Object.assign({}, copyDict(crit)));
        question = Object.freeze({ type: qt, instructions: rq.instructions, criteria: cCopy });
      }
      steps.push(Object.freeze({ primitive: prim, engines: Object.freeze(eng), policy: pol, question, out: st.out ? copyDict(st.out) : null }));
    }
    const beh = { publish: '', publishType: '', request: null, onArgs: dict() };
    if (rawBeh && typeof rawBeh === 'object') {
      if (rawBeh.publish) {
        if (!has(streams, rawBeh.publish)) throw new Error('sysrouter: unknown stream ' + rawBeh.publish);
        beh.publish = rawBeh.publish;
        const ts = Object.keys(streams[beh.publish].types);
        beh.publishType = rawBeh.publishType && has(streams[beh.publish].types, rawBeh.publishType) ? rawBeh.publishType : ts[0];
      }
      if (rawBeh.request && typeof rawBeh.request === 'object') {
        const reqMap = dict();
        for (const k of Object.keys(rawBeh.request)) {
          const entry = rawBeh.request[k], aid = typeof entry === 'string' ? entry : (entry && typeof entry === 'object' ? entry.command : '');
          if (!aid || !has(actions, aid)) throw new Error('sysrouter: unknown action ' + aid);
          const a = actions[aid];
          if (a.reserved && who.tier === 'extension') throw new Error('sysrouter: extensions cannot reach reserved actions');
          if (who.grants && !who.grants.actions.includes(aid)) throw new Error('sysrouter: no grant for action ' + aid);
          reqMap[k] = aid;
          if (entry && typeof entry === 'object' && entry.args !== undefined) beh.onArgs[k] = copyDict(entry.args);
        }
        beh.request = Object.freeze(reqMap);
      }
    }
    capabilities[id] = { id, tier: who.tier, owner: who.name || '', steps: Object.freeze(steps), policy: capPolicy, budgetMs, mode, addsRecall, agree, behavior: beh };
    return id;
  }

  async function resolveCapability(cap, input, modeOverride) {
    const r = { id: cap.id, tier: cap.tier, owner: cap.owner, mode: modeOverride || cap.mode, on: cap.behavior.request || dict(), onArgs: cap.behavior.onArgs, cooldownMs: 0, agree: cap.agree };
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort('timeout'), cap.budgetMs);
    let cur = input, finalDecision = null;
    try {
      for (let k = 0; k < cap.steps.length; k++) {
        const st = cap.steps[k];
        if (ctl.signal.aborted) { row(r, 'timeout', { step: k }); return { ok: false, why: 'timeout' }; }
        if (st.question) {
          const stepRoute = Object.assign({}, r, { question: st.question, providers: st.engines, shadow: [], policy: st.policy, budgetMs: cap.budgetMs });
          const req = { state: typeof cur === 'string' ? cur : JSON.stringify(cur), input: cur, questions: { q: st.question } };
          let res = null;
          for (let j = 0; j < st.engines.length; j++) {
            const pid = st.engines[j];
            if (ctl.signal.aborted) { res = { d: null, x: { p: pid, ms: 0 }, why: 'timeout' }; break; }
            res = providers[pid].sync
              ? (() => { const t0 = now(); try { return settle(stepRoute, pid, providers[pid].ask(req, { route: cap.id, signal: ctl.signal }), t0); } catch (e) { return { d: null, x: { p: pid }, why: 'error' }; } })()
              : await askAsync(stepRoute, pid, req, ctl.signal);
            if (res.d) break;
            if (st.policy === 'single' || j === st.engines.length - 1 || res.why !== 'abstain') row(r, res.why, res.x);
          }
          if (!res || !res.d) return { ok: false, why: (res && res.why) || 'unsure' };
          finalDecision = res; cur = res.d.pick;
        } else {
          const pid = st.engines[0], P = providers[pid], t0 = now();
          if (st.primitive === 'actuate' && modeOf(r) === 'shadow') { row(r, 'shadow', { p: pid }); return { ok: true, output: { ok: false }, decision: null }; }
          let raw;
          try {
            const p = P.sync ? P.ask({ state: cur, input: cur, primitive: st.primitive, signal: ctl.signal }, { signal: ctl.signal, route: cap.id })
              : Promise.race([Promise.resolve().then(() => P.ask({ state: cur, input: cur, primitive: st.primitive, signal: ctl.signal }, { signal: ctl.signal, route: cap.id })),
                new Promise((_, rej) => ctl.signal.addEventListener('abort', () => rej(new Error('timeout')), { once: true }))]);
            raw = await p;
          } catch (e) { const why = ctl.signal.aborted ? 'timeout' : 'error'; row(r, why, { p: pid, ms: Math.round(now() - t0) }); return { ok: false, why }; }
          if (ctl.signal.aborted) { row(r, 'timeout', { p: pid, ms: Math.round(now() - t0) }); return { ok: false, why: 'timeout' }; }
          const outVal = raw && typeof raw === 'object' && !Array.isArray(raw) && has(raw, 'output') ? raw.output : raw;
          const checked = readPrimitive(st.primitive, st, outVal);
          if (checked === null) { row(r, 'bad_answer', { p: pid, ms: Math.round(now() - t0) }); return { ok: false, why: 'bad_answer' }; }
          cur = checked;
        }
      }
      if (cap.behavior.publish) emit(cap.behavior.publish, { type: cap.behavior.publishType, data: finalDecision ? finalDecision.d.pick : cur });
      if (cap.behavior.request && finalDecision) act(r, finalDecision.d.pick, finalDecision.x);
      return { ok: true, output: cur, decision: finalDecision ? finalDecision.d : null };
    } finally { clearTimeout(timer); }
  }

  function addTrigger(rawSpec, who) {
    if (!rawSpec || typeof rawSpec !== 'object') throw new Error('sysrouter: bad trigger');
    const id = rawSpec.id, ro = rawSpec.on, cmd = rawSpec.command, ra = rawSpec.args;
    const rawMode = rawSpec.mode || 'shadow', mode = rawMode === 'parallel' ? 'live' : rawMode, cooldownMs = Math.max(0, +rawSpec.cooldownMs || 0);
    if (!ID.test(id || '')) throw new Error('sysrouter: bad trigger id ' + id);
    if (has(triggers, id)) throw new Error('sysrouter: trigger exists: ' + id);
    if (!MODES.includes(mode)) throw new Error('sysrouter: bad trigger mode');
    if (!cmd || !has(actions, cmd)) throw new Error('sysrouter: unknown command ' + cmd);
    const a = actions[cmd];
    if (a.reserved && who.tier === 'extension') throw new Error('sysrouter: extensions cannot reach reserved actions');
    if (who.grants && !who.grants.actions.includes(cmd)) throw new Error('sysrouter: no grant for action ' + cmd);
    if (!ro || typeof ro !== 'object') throw new Error('sysrouter: bad trigger on');
    let onSnap;
    if (ro.stream) {
      if (!has(streams, ro.stream)) throw new Error('sysrouter: unknown stream ' + ro.stream);
      if (who.grants && who.grants.streams && !who.grants.streams.includes(ro.stream)) throw new Error('sysrouter: no grant for stream ' + ro.stream);
      const t = ro.type;
      if (t !== undefined && (typeof t !== 'string' || !has(streams[ro.stream].types, t))) throw new Error('sysrouter: bad trigger stream type ' + t);
      onSnap = { stream: ro.stream, type: t || '' };
    } else if (ro.person === true) onSnap = { person: true };
    else if (ro.creature === true) onSnap = { creature: true };
    else throw new Error('sysrouter: bad trigger on');
    const argsSnap = ra === undefined ? undefined : (ra && typeof ra === 'object' && !Array.isArray(ra) ? copyDict(ra) : ra);
    triggers[id] = { id, tier: who.tier, owner: who.name || '', on: Object.freeze(onSnap), command: cmd, args: argsSnap, mode, cooldownMs };
    return id;
  }

  function fireTrigger(tr, rawData) {
    if (flags.off || modeOf(tr) === 'off') return null;
    const r = { id: tr.id, tier: tr.tier, owner: tr.owner, mode: tr.mode, on: { go: tr.command }, cooldownMs: tr.cooldownMs };
    return act(r, 'go', {}, tr.args !== undefined ? tr.args : rawData);
  }

  function request(commandId, args, reqOpts) {
    if (flags.off) return { did: 0, why: 'off' };
    const from = reqOpts && reqOpts.from;
    if (from !== 'person' && from !== 'creature') return { did: 0, why: 'refused' };
    let res = null;
    for (const tid in triggers) {
      const tr = triggers[tid];
      if (tr.on[from] === true && tr.command === commandId) res = fireTrigger(tr, args);
    }
    return res || { did: 0, why: 'refused' };
  }

  function uninstall(name) {
    if (!has(installed, name)) return false;
    for (const k in triggers) if (triggers[k].tier === 'extension' && triggers[k].owner === name) delete triggers[k];
    for (const k in routes) if (routes[k].tier === 'extension' && routes[k].owner === name) delete routes[k];
    for (const k in capabilities) if (capabilities[k].tier === 'extension' && capabilities[k].owner === name) delete capabilities[k];
    for (const k in actions) if (actions[k].tier === 'extension' && actions[k].owner === name) delete actions[k];
    for (const k in streams) if (streams[k].tier === 'extension' && streams[k].owner === name) delete streams[k];
    delete installed[name];
    return true;
  }

  async function install(manifest, permissions) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('sysrouter: bad manifest');
    const name = manifest.name;
    if (!ID.test(name || '')) throw new Error('sysrouter: bad extension name');
    if (blockList.names.has(name)) throw new Error('sysrouter: blocked extension name ' + name);
    const hash = await sha256Hex(manifest);
    if (blockList.hashes.has(hash)) throw new Error('sysrouter: blocked extension hash ' + hash);
    if (has(installed, name)) throw new Error('sysrouter: extension already installed: ' + name);
    const p = normPerms(permissions);
    const who = { tier: 'extension', name, grants: p };
    const created = { streams: [], actions: [], capabilities: [], triggers: [], routes: [] };
    try {
      for (const s of (manifest.streams || [])) {
        if (!p.streams.includes(s && s.id)) throw new Error('sysrouter: no grant for stream ' + (s && s.id));
        created.streams.push(addStream(s, who));
      }
      for (const c of (manifest.capabilities || [])) created.capabilities.push(addCapability(c, who));
      for (const c of (manifest.commands || [])) {
        if (!p.actions.includes(c && c.id)) throw new Error('sysrouter: no grant for action ' + (c && c.id));
        created.actions.push(addCommand(c, who));
      }
      for (const t of (manifest.triggers || [])) created.triggers.push(addTrigger(t, who));
      for (const r of (manifest.routes || [])) created.routes.push(addRoute(r, who));
    } catch (e) {
      for (const k of created.routes) delete routes[k];
      for (const k of created.triggers) delete triggers[k];
      for (const k of created.actions) delete actions[k];
      for (const k of created.capabilities) delete capabilities[k];
      for (const k of created.streams) delete streams[k];
      throw e;
    }
    installed[name] = { name, hash, permissions: p };
    return { name, hash, permissions: JSON.parse(JSON.stringify(p)) };
  }

  const extensions = () => Object.keys(installed).map((k) => ({ name: installed[k].name, hash: installed[k].hash, permissions: JSON.parse(JSON.stringify(installed[k].permissions)) }));

  const release = (resource) => { delete held[resource]; };
  const spent = () => usd;
  const list = () => Object.keys(routes).map((id) => ({ id, tier: routes[id].tier, owner: routes[id].owner, mode: modeOf(routes[id]), providers: routes[id].providers.slice(), on: Object.assign({}, routes[id].on) }));
  const port = Object.freeze({
    hear, replied,
    read,
    watch,
    request,
    list,
    extensions,
    install,
    uninstall,
    spent, release,
    flags: () => ({ off: !!flags.off, routes: Object.assign({}, flags.routes) })
  });

  return {
    action, command: (spec) => addCommand(spec, { tier: 'system' }), provider, calibrate, extension, hear, replied, read, watch, emit,
    stream: (decl) => { assertOpen(); return addStream(decl, { tier: 'system' }); },
    capability: (spec) => { assertOpen(); return addCapability(spec, { tier: 'system' }); },
    trigger: (spec) => { assertOpen(); return addTrigger(spec, { tier: 'system' }); },
    invoke: (id, input, mode) => { const c = has(capabilities, id) ? capabilities[id] : null; if (!c) throw new Error('sysrouter: unknown capability ' + id); return resolveCapability(c, input, mode); },
    route: (spec) => { assertOpen(); return addRoute(spec, { tier: 'system' }); },
    core: (spec) => { if (sealed) throw new Error('sysrouter: core routes are registered before seal()'); return addRoute(spec, { tier: 'core' }); },
    unroute: (id) => { assertOpen(); const r = routes[id]; if (!r || r.tier === 'extension') return false; delete routes[id]; return true; },
    setBlockList,
    seal: () => { sealed = true; },
    release,
    spent,                                                                               // what hosted engines have cost this session, for the page to show
    list,
    port: () => port
  };
}
