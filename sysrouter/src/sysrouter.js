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

import { ID, GATE, MODES, TYPES, PRIMITIVES, EXPOSE_TO, dict, checkArgs, readPrimitive as checkPrim, createRegistry } from './registry.js';
import { workerEngine } from './worker-engine.js';

const TIERS = { core: 0, system: 1, extension: 2 };          // lower number = higher priority
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
      const [rawId, rawM] = part.split(':'), id = rawId === 'wake' ? 'fuzzy' : (rawId === 'express' ? 'emote' : rawId), m = rawM === 'parallel' ? 'live' : rawM;
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
  const actions = dict(), providers = dict(), routes = dict(), capabilities = dict(), triggers = dict(), installed = dict(), gates = dict(), held = dict(), last = dict(), seqOf = dict(), spend = dict(), reqSpend = dict(), extUsd = dict(), lastPick = dict(), flight = dict(), health = dict(), paid = dict(), streams = dict();
  // reliability limits, all overridable: a provider that fails BREAK.fails times in a row is left alone for BREAK.ms; hosted engines stop being asked once the session has spent maxUsd
  const BREAK = { fails: Math.max(1, +(opts.breaker && opts.breaker.fails) || 3), ms: Math.max(0, +(opts.breaker && opts.breaker.ms) || 30000) }, maxUsd = opts.maxUsd >= 0 ? +opts.maxUsd : 0.25, reqPerMin = opts.reqPerMin > 0 ? +opts.reqPerMin : 30;
  const maxHops = Number.isInteger(opts.maxHops) && opts.maxHops >= 0 ? opts.maxHops : 3;
  let sealed = false, seq = 0, evSeq = 0, activeHop = -1, usd = 0;
  let blockList = { names: new Set(), hashes: new Set() };
  const assertOpen = () => { if (sealed) throw new Error('sysrouter: sealed'); };

  function registerProvider(id, p, who) {
    if (!ID.test(id || '') || !p || typeof p.ask !== 'function') throw new Error('sysrouter: bad provider ' + id);
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
    const tier = who.tier, owner = who.name || '';
    const isExt = tier === 'extension';
    providers[id] = {
      ask: p.ask, sync: isExt ? false : !!p.sync, exact: isExt ? false : !!p.exact, inFunnel: isExt ? false : !!p.inFunnel,
      model: String(p.model || ''), types: Object.keys(prims), primitives: prims, tier, owner, terminate: p.terminate || null
    };
    if (has(prims, 'sense') && typeof p.subscribeSense === 'function') {
      p.subscribeSense((ev) => {
        if (flags.off || !ev || !has(streams, ev.stream)) return;
        const s = streams[ev.stream];
        if (s.tier === 'core' || s.tier !== tier || s.owner !== owner) return;
        if (!has(s.types, ev.type)) return;
        emit(ev.stream, { type: ev.type, data: ev.data });
      });
    }
    return id;
  }

  async function registerExtEngine(decl, who) {
    if (!decl || typeof decl !== 'object' || !ID.test(decl.id || '')) throw new Error('sysrouter: bad engine');
    if (decl.exact || decl.inFunnel) throw new Error('sysrouter: third-party engines cannot set exact or inFunnel');
    if (!decl.worker || typeof decl.worker !== 'object' || typeof decl.worker.source !== 'string' || !decl.worker.source.trim()) throw new Error('sysrouter: engine needs worker.source');
    if (!decl.primitives || typeof decl.primitives !== 'object' || Array.isArray(decl.primitives) || !Object.keys(decl.primitives).length) throw new Error('sysrouter: engine needs primitives');
    let w, blobUrl = '';
    if (typeof Worker === 'function' && typeof Blob === 'function' && typeof URL === 'function' && typeof URL.createObjectURL === 'function') {
      blobUrl = URL.createObjectURL(new Blob([decl.worker.source], { type: 'text/javascript' }));
      w = new Worker(blobUrl, { type: 'module' });
    } else {
      const { Worker: NodeWorker } = await import('node:worker_threads');
      w = new NodeWorker(decl.worker.source, { eval: true });
    }
    const eng = workerEngine(w, { primitives: decl.primitives, model: decl.model || '' });
    const origTerm = eng.terminate;
    eng.terminate = () => { if (origTerm) origTerm(); if (blobUrl) try { URL.revokeObjectURL(blobUrl); } catch (e) {} };
    try { return registerProvider(decl.id, eng, who); } catch (e) { eng.terminate(); throw e; }
  }

  const reg = createRegistry({ actions, providers, routes, capabilities, triggers, installed, streams, assertOpen, isSealed: () => sealed, getBlockList: () => blockList, registerExtEngine });

  function setBlockList(bl) {
    const names = new Set(Array.isArray(bl && bl.names) ? bl.names.map(String) : []);
    const hashes = new Set(Array.isArray(bl && bl.hashes) ? bl.hashes.map((h) => String(h).toLowerCase()) : []);
    blockList = { names, hashes };
    for (const n of Object.keys(installed)) {
      if (names.has(n) || hashes.has(installed[n].hash)) reg.uninstall(n);
    }
  }
  if (opts.blockList) setBlockList(opts.blockList);

  const coreExp = (id) => Object.freeze(Array.isArray(opts.exposeStreams && opts.exposeStreams[id]) ? opts.exposeStreams[id].filter((e) => EXPOSE_TO.includes(e)) : []);
  streams['speech'] = { id: 'speech', tier: 'core', owner: '', types: { person: true, creature: true }, exposeTo: coreExp('speech'), latest: null, watchers: [] };
  streams['body.sense'] = { id: 'body.sense', tier: 'core', owner: '', types: { trig: true }, exposeTo: coreExp('body.sense'), latest: null, watchers: [] };

  function exposeStream(id, list) {
    assertOpen();
    if (!has(streams, id) || !Array.isArray(list)) throw new Error('sysrouter: bad exposeStream ' + id);
    const out = [];
    for (const e of list) { if (!EXPOSE_TO.includes(e)) throw new Error('sysrouter: bad exposeTo ' + e); if (!out.includes(e)) out.push(e); }
    streams[id].exposeTo = Object.freeze(out);
  }

  const modeOf = (r) => flags.off ? 'off' : (flags.routes && has(flags.routes, r.id) ? flags.routes[r.id] : r.mode);
  const gateOf = (r, pid, model) => { if (!model) return null; const g = gates[r.id] || dict(); return g[pid + '@' + model] || null; };

  function row(r, why, x) {   // one journal row per decision (R-OBS-1). Never the words: the funnel's own "user" row holds their hash.
    const o = { r: r.id, tier: r.tier, mode: modeOf(r), why };
    if (r.owner) o.ext = r.owner;
    if (r._from) o.from = r._from;
    if (x) for (const k in x) if (x[k] !== undefined && x[k] !== null && x[k] !== '') o[k] = x[k];
    if (r.agree && o.a && why !== 'agree' && why !== 'shadow_arm' && o.from !== 'creature') lastPick[r.id] = o.a;
    try { log('sysroute', o); } catch (e) {}
    return o;
  }

  function checkExtRate(r) {
    if (!r.perMin) return true;
    const m = Math.floor(now() / 60000), s = spend[r.owner] = spend[r.owner] && spend[r.owner].m === m ? spend[r.owner] : { m, n: 0 };
    if (++s.n > r.perMin) { row(r, 'rate'); return false; }
    return true;
  }
  function overBudget(r, pid) {
    if (!paid[pid]) return false;
    if (usd >= maxUsd) return true;
    if (r.tier === 'extension' && r.owner && (extUsd[r.owner] || 0) >= (r.maxUsd || 0)) return true;
    return false;
  }
  function addSpend(r, pid, cost) {
    if (Number.isFinite(cost) && cost >= 0) {
      usd += cost;
      if (r.tier === 'extension' && r.owner) extUsd[r.owner] = (extUsd[r.owner] || 0) + cost;
      if (cost > 0) paid[pid] = true;
    }
  }

  function emit(streamId, event, explicitHop, waitsOut) {
    if (flags.off) return null;
    const s = has(streams, streamId) ? streams[streamId] : null;
    if (!s || !event || typeof event !== 'object' || typeof event.type !== 'string' || !has(s.types, event.type)) throw new Error('sysrouter: bad event for ' + streamId);
    const hop = typeof explicitHop === 'number' ? explicitHop : (activeHop >= 0 ? activeHop + 1 : 0);
    if (hop > maxHops) { row({ id: streamId, tier: s.tier, owner: s.owner, mode: 'live' }, 'hops', { stream: streamId, type: event.type, hop }); return null; }
    const raw = event.data, data = typeof raw === 'string' ? (raw.length > 600 ? raw.slice(0, 600) : raw) : raw;
    const ev = Object.freeze({ stream: streamId, type: event.type, data, t: now(), seq: ++evSeq, hop });
    s.latest = ev;
    const prevHop = activeHop; activeHop = hop;
    const speaker = streamId === 'speech' ? ev.type : '';
    try {
      for (const fn of s.watchers.slice()) { try { fn(ev); } catch (e) {} }
      for (const tid in triggers) {
        const tr = triggers[tid];
        if (tr.on.stream === streamId && (!tr.on.type || tr.on.type === ev.type)) {
          const r = fireTrigger(tr, ev.data, ev.hop, false, speaker);
          if (waitsOut && r && typeof r.then === 'function') waitsOut.push(r);
        }
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

  function action(id, a) {
    if (!ID.test(id) || !a || typeof a.run !== 'function') throw new Error('sysrouter: bad action ' + id);
    if (has(actions, id)) throw new Error('sysrouter: action exists: ' + id);
    if (a.reserved && sealed) throw new Error('sysrouter: reserved actions are registered before seal()');
    assertOpen();
    return reg.addCommand({ id, run: a.run, resource: a.resource, holdMs: a.holdMs, reserved: a.reserved, exposeTo: a.exposeTo }, { tier: 'system' });
  }
  function provider(id, p) { assertOpen(); registerProvider(id, p, { tier: 'system' }); }
  function calibrate(table) {   // { routeId: { 'providerId' or 'providerId@model': { p, pn, margin } } }
    assertOpen();
    if (!table || typeof table !== 'object') return;
    for (const rawRid of Object.keys(table)) {
      if (!ID.test(rawRid) || !table[rawRid] || typeof table[rawRid] !== 'object') continue;
      const rids = rawRid === 'wake' ? ['wake', 'fuzzy'] : (rawRid === 'express' ? ['express', 'emote'] : [rawRid]);
      for (const rid of rids) {
        gates[rid] = gates[rid] || dict();
        for (const k of Object.keys(table[rawRid])) { const g = table[rawRid][k]; if (GATE.test(k) && g && g.p > 0.5 && g.p <= 1) gates[rid][k] = { p: +g.p, pn: g.pn > 0.5 && g.pn <= 1 ? +g.pn : +g.p, margin: +g.margin || 0 }; }
      }
    }
  }

  function extension(name, grants) {
    assertOpen();
    if (!ID.test(name)) throw new Error('sysrouter: bad extension name');
    if (blockList.names.has(name)) throw new Error('sysrouter: blocked extension name ' + name);
    const p = reg.normPerms(grants);
    const who = { tier: 'extension', name, grants: p };
    const snap = () => JSON.parse(JSON.stringify(who.grants));
    return Object.freeze({ route: (spec) => reg.addRoute(spec, who), unroute: (id) => reg.dropRoute(id, who), grants: snap });
  }

  function act(r, pick, x, rawArgs, hop, metered, speaker) {
    const aid = has(r.on, pick) ? r.on[pick] : '', mode = modeOf(r);
    if (!aid) {
      if (r.unexposed && r.unexposed.includes(pick)) { x.did = 0; return row(r, 'unexposed', x); }
      return row(r, 'none', x);
    }
    const a = actions[aid], t = now(), tier = TIERS[r.tier];
    x.act = aid;
    const isCap = !a.run && a.capability && has(capabilities, a.capability);
    if (mode === 'shadow' && !isCap) return row(r, 'shadow', x);
    const clearHolds = () => { for (const k in held) delete held[k]; };
    if (x.p && providers[x.p] && providers[x.p].inFunnel) {
      if (a.reserved) clearHolds();
      x.did = 0;
      return row(r, 'readers_acted', x);
    }
    let checkedArgs = rawArgs !== undefined ? rawArgs : (r.onArgs && has(r.onArgs, pick) ? r.onArgs[pick] : undefined);
    if (a.args) { const okArgs = checkArgs(a.args, checkedArgs); if (!okArgs) return row(r, 'bad_args', x); checkedArgs = okArgs; }
    const cd = a.cooldownMs || r.cooldownMs;
    if (mode !== 'shadow' && !a.reserved) {
      if (cd && t - (last[r.id + '>' + aid] || -1e15) < cd) return row(r, 'cooldown', x);   // per action: a debounce against the same thing twice, never a block on a different command
      const h = a.resource && held[a.resource];
      if (h && h.until > t && h.tier < tier) return row(r, 'held', x);                 // a lower tier never pre-empts what a higher tier holds (R-TRUST-2)
    }
    if (isCap) {
      const cap = capabilities[a.capability];
      const capMode = mode === 'shadow' || modeOf(cap) === 'shadow' ? 'shadow' : modeOf(cap);
      return resolveCapability(cap, checkedArgs, capMode, hop, metered, speaker).then((res) => {
        if (capMode === 'shadow') { x.did = 0; return row(r, 'shadow', x); }
        if (res && res.ok) {
          last[r.id + '>' + aid] = t;
          if (a.reserved) clearHolds();
          else if (a.resource && a.holdMs) held[a.resource] = { tier, until: t + a.holdMs };
          x.did = 1;
          return row(r, 'acted', x);
        }
        x.did = 0;
        return row(r, (res && res.why) || 'error', x);
      });
    }
    const prevHop = activeHop;
    if (typeof hop === 'number') activeHop = hop;
    try { if (a.run) a.run({ route: r.id, pick, tier: r.tier, args: checkedArgs }); } catch (e) { return row(r, 'act_error', x); }
    finally { activeHop = prevHop; }
    last[r.id + '>' + aid] = t;
    if (a.reserved) clearHolds();                                                        // a stop clears every hold, whoever owns it
    else if (a.resource && a.holdMs) held[a.resource] = { tier, until: t + a.holdMs };
    x.did = 1;
    return row(r, 'acted', x);
  }

  // Ask one provider. Sync providers answer in the same tick: a deterministic stop is never
  // behind a promise. Returns { d, x } where d is the checked decision or null.
  function settle(r, pid, res, t0) {
    const P = providers[pid], x = { p: pid, ms: Math.round(now() - t0) };
    if (!res || typeof res !== 'object' || !res.answers) return { d: null, x, why: 'bad_answer' };
    if (res.model) x.m = String(res.model).replace(/[^\w.\/:@~-]/g, '').slice(0, 48);
    if (Number.isFinite(res.usd) && res.usd >= 0) { x.usd = res.usd; addSpend(r, pid, res.usd); }
    if (res.usage && res.usage.input_tokens >= 0) x.tok = res.usage.input_tokens;
    const raw = res.answers.q;
    if (raw && raw.abstain) return { d: null, x, why: 'abstain' };                      // "my rules do not cover this": escalate, never a confident none
    const d = readAnswer(r.question, raw);
    if (!d) return { d: null, x, why: 'bad_answer' };
    x.a = d.pick; x.pr = Math.round(d.p * 1000) / 1000;
    const g = P.exact ? { p: 0, pn: 0, margin: 0 } : gateOf(r, pid, res.model || P.model);
    if (!g) return { d: null, x, why: 'no_gate' };
    // an answer that triggers nothing has its own gate (pn): how sure "nothing was asked" must be before a cascade stops there instead of asking the next engine
    const target = has(r.on, d.pick) || (r.unexposed && r.unexposed.includes(d.pick));
    if (d.p < (target ? g.p : g.pn) || d.p - d.second < g.margin) return { d: null, x, why: 'unsure' };
    return { d, x, why: '' };
  }
  function askAsync(r, pid, req, signal) {
    const t0 = now(), skip = (why) => Promise.resolve({ d: null, x: { p: pid, ms: 0 }, why }), h = health[pid] || (health[pid] = { fails: 0, until: 0 });
    const whyAbort = () => signal.reason === 'stale' ? 'stale' : signal.reason === 'won' ? 'lost' : 'timeout';
    if (signal.aborted) return skip(whyAbort());                                                  // the budget is spent or newer words arrived: nobody else is asked (found by test/fuzz_router.mjs: a second engine asked after the deadline never settled)
    if (h.until > t0) return skip('open');                                                       // circuit breaker: this engine just failed several times running, so it is not asked and the cascade moves on
    if (overBudget(r, pid)) return skip('budget');                                               // spend cap: session or per-extension limit reached
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

  // Unified decision-step resolver used by both routes and capabilities (#26).
  function resolveDecisionStep(r, st, req, ctl, sctl, fresh, onWin) {
    const rid = r.id, engines = st.engines, shadow = st.shadow || [], policy = st.policy;
    const stepR = Object.assign({}, r, { question: st.question, providers: engines, shadow, policy });
    let i = 0, decided = false, syncWin = null, lastRes = null;
    for (; i < engines.length && providers[engines[i]].sync; i++) {
      const t0 = now(); let res;
      try { res = settle(stepR, engines[i], providers[engines[i]].ask(req, { route: rid }), t0); } catch (e) { res = { d: null, x: { p: engines[i] }, why: 'error' }; }
      lastRes = res;
      if (res.d) { decided = true; syncWin = res; if (onWin) onWin(res); break; }
      if (policy === 'single' || i === engines.length - 1 || res.why !== 'abstain') row(r, res.why, res.x);
    }
    const rest = decided ? [] : engines.slice(i);
    if (!rest.length && !shadow.length) return { sync: true, res: syncWin || lastRes };
    const sh = shadow.map((pid) => askAsync(stepR, pid, req, sctl.signal).then((res) => { row(r, 'shadow_arm', Object.assign(res.x, { arm: res.why || 'ok' })); }));
    let winRes = syncWin, failRes = lastRes;
    let main;
    if (decided) main = Promise.resolve(true);
    else if (policy === 'race') main = new Promise((done) => { let left = rest.length, won = false; if (!left) done();
      rest.forEach((pid) => askAsync(stepR, pid, req, ctl.signal).then((res) => { if (res.d && !won) { won = true; if (fresh()) { winRes = res; if (onWin) onWin(res); } else row(r, 'stale', res.x); ctl.abort('won'); } else if (!res.d && !won && res.why !== 'lost' && (left === 1 || res.why !== 'abstain')) { failRes = res; row(r, res.why, res.x); } if (!--left || won) done(); })); });   // first CONFIDENT answer wins, not first to arrive
    else main = rest.reduce((chain, pid, k) => chain.then((got) => got ? got : askAsync(stepR, pid, req, ctl.signal).then((res) => {
      if (!fresh()) { row(r, 'stale', res.x); return true; }
      if (res.d) { winRes = res; if (onWin) onWin(res); return true; }
      failRes = res;
      if (k === rest.length - 1 || res.why !== 'abstain') row(r, res.why, res.x);     // every engine consulted writes a row except a non-final abstain
      return false; })), Promise.resolve(false));
    return { sync: false, promise: Promise.all([main].concat(sh)).then(() => winRes || failRes) };
  }

  function resolve(r, req, fresh, finish) {
    const fk = r._flightKey || r.id, st = r.steps[0];
    if (flight[fk]) flight[fk].abort('stale');                                           // one flight per route (and speaker for input:'both'): older words are told to stop
    const ctl = new AbortController(), sctl = new AbortController();
    const out = resolveDecisionStep(r, st, req, ctl, sctl, fresh, finish);
    if (out.sync) return null;
    flight[fk] = ctl;
    const timer = setTimeout(() => { ctl.abort('timeout'); sctl.abort('timeout'); }, r.budgetMs);
    const end = () => { clearTimeout(timer); if (flight[fk] === ctl) delete flight[fk]; };
    return out.promise.then(end, end);
  }

  function hear(text, meta) {
    meta = meta || {};
    const out = { acted: [], done: null }, waits = [], from = meta.from === 'creature' ? 'creature' : 'person';
    if (flags.off || typeof text !== 'string' || !text.trim()) { out.done = Promise.resolve(out); return out; }
    const ev = emit('speech', { type: from, data: text }, undefined, waits);
    if (!ev) { out.done = Promise.resolve(out); return out; }
    const state = ev.data, my = ++seq, prevHop = activeHop;
    activeHop = ev.hop;
    try { for (const rid in routes) {
      const r = routes[rid];
      if (modeOf(r) === 'off' || (r.input !== 'both' && r.input !== from)) continue;
      if (!checkExtRate(r)) continue;
      const sk = r.input === 'both' ? rid + ':' + from : rid;
      const rr = r.input === 'both' ? Object.assign({}, r, { _from: from, _flightKey: sk }) : r;
      seqOf[sk] = my;
      const req = { state, questions: { q: r.question } }, fresh = () => seqOf[sk] === my;
      const finish = (res) => { const o = act(rr, res.d.pick, res.x, undefined, ev.hop, true); if (o && o.did) out.acted.push(o.act); };
      const p = resolve(rr, req, fresh, finish);
      if (p) waits.push(p);
    } } finally { activeHop = prevHop; }
    out.done = Promise.all(waits).then(() => out);
    return out;
  }

  // Shadow agreement (R-OBS-3): when the brain's reply lands, say whether it agreed with what
  // each route or capability decided for the same words (only when kind === 'event', #39, #29).
  function replied(reply, kind) {
    if (flags.off || !reply || typeof reply !== 'object') return;
    if (kind === 'event') {
      for (const rid in routes) { const r = routes[rid], lp = lastPick[rid]; if (!r.agree || !lp) continue; delete lastPick[rid];
        row(r, 'agree', { a: lp, brain: typeof reply[r.agree] === 'string' ? reply[r.agree].slice(0, 24) : '', ok: reply[r.agree] === lp ? 1 : 0 }); }
      for (const cid in capabilities) { const c = capabilities[cid], lp = lastPick[cid]; if (!c.agree || !lp) continue; delete lastPick[cid];
        row(c, 'agree', { a: lp, brain: typeof reply[c.agree] === 'string' ? reply[c.agree].slice(0, 24) : '', ok: reply[c.agree] === lp ? 1 : 0 }); }
    }
    if (typeof reply.say === 'string' && reply.say.trim()) hear(reply.say, { from: 'creature' });
  }

  // Multi-step capability resolution sharing resolveDecisionStep, flight/stale, rate/spend caps, shadow suppression, and async hop propagation.
  async function resolveCapability(cap, input, modeOverride, hop, metered, speaker) {
    const effMode = modeOverride || modeOf(cap);
    const r = { id: cap.id, tier: cap.tier, owner: cap.owner, mode: effMode, on: cap.behavior.request || dict(), onArgs: cap.behavior.onArgs, cooldownMs: cap.cooldownMs || 0, agree: cap.agree, perMin: cap.perMin || 0, maxUsd: cap.maxUsd || 0, _from: speaker || '' };
    if (effMode === 'off' || modeOf(cap) === 'off') return { ok: false, why: 'off' };
    if (!metered && !checkExtRate(r)) return { ok: false, why: 'rate' };
    const fkey = 'cap:' + cap.id + (speaker ? ':' + speaker : ''), my = ++seq;
    seqOf[fkey] = my;
    if (flight[fkey]) flight[fkey].abort('stale');
    const ctl = flight[fkey] = new AbortController(), sctl = new AbortController();
    const timer = setTimeout(() => { ctl.abort('timeout'); sctl.abort('timeout'); }, cap.budgetMs);
    const fresh = () => seqOf[fkey] === my;
    let cur = input, finalDecision = null;
    try {
      for (let k = 0; k < cap.steps.length; k++) {
        const st = cap.steps[k];
        if (ctl.signal.aborted) { const why = ctl.signal.reason === 'stale' ? 'stale' : 'timeout'; row(r, why, { step: k }); return { ok: false, why }; }
        if (st.question) {
          const req = { state: typeof cur === 'string' ? cur : JSON.stringify(cur), input: cur, questions: { q: st.question } };
          const stepOut = resolveDecisionStep(r, st, req, ctl, sctl, fresh, null);
          const res = stepOut.sync ? stepOut.res : await stepOut.promise;
          if (!fresh()) return { ok: false, why: 'stale' };
          if (!res || !res.d) return { ok: false, why: (res && res.why) || 'unsure' };
          finalDecision = res; cur = res.d.pick;
          if (effMode === 'shadow' && !cap.behavior.request) row(r, 'shadow', Object.assign({}, res.x));
        } else {
          const pid = st.engines[0], P = providers[pid], t0 = now();
          if (st.primitive === 'actuate' && effMode === 'shadow') { row(r, 'shadow', { p: pid }); return { ok: true, output: { ok: false }, decision: null }; }
          if (overBudget(r, pid)) { row(r, 'budget', { p: pid, ms: 0 }); return { ok: false, why: 'budget' }; }
          let raw;
          try {
            let onAbort;
            const aborted = new Promise((_, rej) => { onAbort = () => rej(new Error('timeout')); ctl.signal.addEventListener('abort', onAbort, { once: true }); });
            const p = P.sync ? P.ask({ state: cur, input: cur, primitive: st.primitive, signal: ctl.signal }, { signal: ctl.signal, route: cap.id })
              : Promise.race([Promise.resolve().then(() => P.ask({ state: cur, input: cur, primitive: st.primitive, signal: ctl.signal }, { signal: ctl.signal, route: cap.id })), aborted]).finally(() => ctl.signal.removeEventListener('abort', onAbort));
            raw = await p;
          } catch (e) { const why = ctl.signal.aborted ? (ctl.signal.reason === 'stale' ? 'stale' : 'timeout') : 'error'; row(r, why, { p: pid, ms: Math.round(now() - t0) }); return { ok: false, why }; }
          if (ctl.signal.aborted) { const why = ctl.signal.reason === 'stale' ? 'stale' : 'timeout'; row(r, why, { p: pid, ms: Math.round(now() - t0) }); return { ok: false, why }; }
          if (raw && typeof raw === 'object' && Number.isFinite(raw.usd) && raw.usd >= 0) addSpend(r, pid, raw.usd);
          const outVal = raw && typeof raw === 'object' && !Array.isArray(raw) && has(raw, 'output') ? raw.output : raw;
          const checked = readPrimitive(st.primitive, st, outVal);
          if (checked === null) { row(r, 'bad_answer', { p: pid, ms: Math.round(now() - t0) }); return { ok: false, why: 'bad_answer' }; }
          cur = checked;
        }
      }
      const isShadow = effMode === 'shadow';
      if (isShadow) {
        if (cap.behavior.request && finalDecision) act(r, finalDecision.d.pick, finalDecision.x, undefined, hop, true);
        return { ok: true, output: cur, decision: finalDecision ? finalDecision.d : null };
      }
      const nextHop = (typeof hop === 'number' ? hop : (activeHop >= 0 ? activeHop : -1)) + 1;
      if (cap.behavior.publish) emit(cap.behavior.publish, { type: cap.behavior.publishType, data: finalDecision ? finalDecision.d.pick : cur }, nextHop);
      if (cap.behavior.request && finalDecision) act(r, finalDecision.d.pick, finalDecision.x, undefined, hop, true);
      return { ok: true, output: cur, decision: finalDecision ? finalDecision.d : null };
    } finally { clearTimeout(timer); if (flight[fkey] === ctl) delete flight[fkey]; }
  }

  function fireTrigger(tr, rawData, hop, metered, speaker) {
    if (flags.off || modeOf(tr) === 'off') return null;
    if (!metered && !checkExtRate(tr)) return null;
    const r = { id: tr.id, tier: tr.tier, owner: tr.owner, mode: tr.mode, on: { go: tr.command }, cooldownMs: tr.cooldownMs, _from: speaker || '' };
    return act(r, 'go', {}, tr.args !== undefined ? tr.args : rawData, hop, true, speaker);
  }

  function request(commandId, args, reqOpts) {
    if (flags.off) return { did: 0, why: 'off' };
    const from = reqOpts && reqOpts.from;
    if (from !== 'person' && from !== 'creature') return row({ id: 'request', tier: 'system', mode: 'live' }, 'refused', { act: String(commandId || ''), did: 0 });
    const m = Math.floor(now() / 60000), rs = reqSpend[from] && reqSpend[from].min === m ? reqSpend[from] : (reqSpend[from] = { min: m, n: 0 });
    if (++rs.n > reqPerMin) return row({ id: 'request', tier: 'system', mode: 'live' }, 'rate', { act: String(commandId || ''), from, did: 0 });
    // Exposure and person-grant checks run BEFORE any trigger fires (#20).
    const a = has(actions, commandId) ? actions[commandId] : null;
    if (!a) return row({ id: 'request', tier: 'system', mode: 'live' }, 'refused', { act: String(commandId || ''), from, did: 0 });
    if (!a.exposeTo.includes(from)) return row({ id: 'request', tier: a.tier, owner: a.owner, mode: 'live' }, 'refused', { act: commandId, from, did: 0 });
    if (a.tier === 'extension' && (!has(installed, a.owner) || !installed[a.owner].permissions.actions.includes(commandId))) {
      return row({ id: 'request', tier: a.tier, owner: a.owner, mode: 'live' }, 'refused', { act: commandId, from, did: 0 });
    }
    if (a.tier === 'extension' && has(installed, a.owner)) {
      if (!checkExtRate({ id: 'request', tier: a.tier, owner: a.owner, mode: 'live', perMin: installed[a.owner].permissions.perMin })) return { did: 0, why: 'rate' };
    }
    let res = null;
    for (const tid in triggers) {
      const tr = triggers[tid];
      if (tr.on[from] === true && tr.command === commandId) res = fireTrigger(tr, args, undefined, a.tier === 'extension' && tr.owner === a.owner);
    }
    if (res) return res;
    return act({ id: 'request', tier: a.tier, owner: a.owner, mode: 'live', on: { go: commandId }, cooldownMs: a.cooldownMs }, 'go', { from }, args, undefined, true);
  }

  const extensions = () => Object.keys(installed).map((k) => ({ name: installed[k].name, hash: installed[k].hash, permissions: JSON.parse(JSON.stringify(installed[k].permissions)) }));
  const sense = (trig) => (flags.off || typeof trig !== 'string' || !trig.trim()) ? null : emit('body.sense', { type: 'trig', data: trig });
  const release = (resource) => { delete held[resource]; };
  const spent = () => usd;
  const list = () => Object.keys(routes).map((id) => ({ id, tier: routes[id].tier, owner: routes[id].owner, mode: modeOf(routes[id]), providers: routes[id].providers.slice(), on: Object.assign({}, routes[id].on) }));
  const port = Object.freeze({
    hear, replied, read, watch, sense, request, list, extensions,
    install: reg.install, uninstall: reg.uninstall, spent, release,
    flags: () => ({ off: !!flags.off, routes: Object.assign({}, flags.routes) })
  });

  return {
    action, command: (spec) => reg.addCommand(spec, { tier: 'system' }), provider, calibrate, extension, hear, replied, read, watch, emit,
    stream: (decl) => { assertOpen(); return reg.addStream(decl, { tier: 'system' }); },
    exposeStream,
    capability: (spec) => { assertOpen(); return reg.addCapability(spec, { tier: 'system' }); },
    trigger: (spec) => { assertOpen(); return reg.addTrigger(spec, { tier: 'system' }); },
    invoke: (id, input, mode) => { const c = has(capabilities, id) ? capabilities[id] : null; if (!c) throw new Error('sysrouter: unknown capability ' + id); return resolveCapability(c, input, mode); },
    route: (spec) => { assertOpen(); return reg.addRoute(spec, { tier: 'system' }); },
    core: (spec) => { if (sealed) throw new Error('sysrouter: core routes are registered before seal()'); return reg.addRoute(spec, { tier: 'core' }); },
    unroute: (id) => { assertOpen(); const r = routes[id]; if (!r || r.tier === 'extension') return false; delete routes[id]; return true; },
    setBlockList,
    seal: () => { sealed = true; },
    release,
    spent,                                                                               // what hosted engines have cost this session, for the page to show
    list,
    port: () => port
  };
}
