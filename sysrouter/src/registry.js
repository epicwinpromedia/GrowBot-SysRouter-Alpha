// registry.js — registration, single-read snapshots, validation, primitive checkers, and manifest hashing. Zero dependencies.

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
export const ID = /^[a-z][a-z0-9_.-]{0,39}$/;
export const KEY = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/;
export const GATE = /^[a-z][A-Za-z0-9_.@\/:~-]{0,95}$/;
export const MODES = ['shadow', 'live'];
export const POLICIES = ['single', 'cascade', 'race'];
export const TYPES = ['noul', 'choice', 'score'];
export const PRIMITIVES = ['noul', 'choice', 'score', 'generate', 'match', 'embed', 'query', 'sense', 'actuate'];
export const EXPOSE_TO = ['third-party', 'creature', 'person'];
export const ARG_TYPES = ['number', 'string', 'boolean', 'enum'];

export const dict = () => Object.create(null);
export const copyDict = (o) => { if (!o || typeof o !== 'object' || Array.isArray(o)) return null; const d = dict(); for (const k of Object.keys(o)) d[k] = o[k]; return d; };

// Deep single-read snapshot (1A.4, #41): reads every own enumerable property at most once
// into plain null-prototype dicts / fresh arrays, so getters cannot change values between check and store.
export function snapshot(v, depth) {
  if (depth === undefined) depth = 0;
  if (depth > 10) throw new Error('sysrouter: spec too deep');
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = snapshot(v[i], depth + 1);
    return out;
  }
  const d = dict();
  for (const k of Object.keys(v)) d[k] = snapshot(v[k], depth + 1);
  return d;
}

// Strict JSON-data guard for third-party manifests (SPEC §8.4, #22): refuses functions,
// symbols, undefined, getters/setters, non-finite numbers, and non-plain objects.
export function assertJsonData(v, depth) {
  if (depth === undefined) depth = 0;
  if (depth > 10) throw new Error('sysrouter: manifest too deep');
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return;
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('sysrouter: non-JSON value in manifest'); return; }
  if (typeof v !== 'object') throw new Error('sysrouter: non-JSON value in manifest');
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const desc = Object.getOwnPropertyDescriptor(v, i);
      if (desc && (desc.get || desc.set)) throw new Error('sysrouter: non-JSON value in manifest');
      assertJsonData(v[i], depth + 1);
    }
    return;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) throw new Error('sysrouter: non-JSON value in manifest');
  for (const k of Object.keys(v)) {
    const desc = Object.getOwnPropertyDescriptor(v, k);
    if (desc && (desc.get || desc.set)) throw new Error('sysrouter: non-JSON value in manifest');
    assertJsonData(v[k], depth + 1);
  }
}

export function checkArgs(schema, raw) {
  if (!schema) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const k of Object.keys(schema)) {
    const d = schema[k], v = has(raw, k) ? raw[k] : undefined;
    if (d.type === 'number') { if (typeof v !== 'number' || !Number.isFinite(v) || (d.min !== undefined && v < d.min) || (d.max !== undefined && v > d.max)) return null; }
    else if (d.type === 'string') { if (typeof v !== 'string' || (d.maxLen !== undefined && v.length > d.maxLen)) return null; }
    else if (d.type === 'boolean') { if (typeof v !== 'boolean') return null; }
    else if (d.type === 'enum') { if (typeof v !== 'string' || !d.values.includes(v)) return null; }
    out[k] = v;
  }
  return out;
}

export function readPrimitive(prim, spec, raw, readAnswer) {
  if (prim === 'noul' || prim === 'choice' || prim === 'score' || prim === 'match') return readAnswer(spec, raw);
  if (prim === 'generate') return typeof raw === 'string' ? (raw.length > 2000 ? raw.slice(0, 2000) : raw) : null;
  if (prim === 'embed') return Array.isArray(raw) && raw.length > 0 && raw.every((v) => typeof v === 'number' && Number.isFinite(v)) ? raw.slice() : null;
  if (prim === 'query') {
    if (!Array.isArray(raw)) return null;
    const schema = spec && spec.out && typeof spec.out === 'object' && !Array.isArray(spec.out) ? spec.out : null;
    const out = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const rec = {};
      if (schema) {
        for (const k of Object.keys(schema)) {
          if (!KEY.test(k) || (k in Object.prototype) || !has(item, k)) return null;
          const t = schema[k], v = item[k];
          if (t === 'number' ? (typeof v !== 'number' || !Number.isFinite(v)) : typeof v !== t) return null;
          rec[k] = v;
        }
      } else {
        for (const k of Object.keys(item)) if (KEY.test(k) && !(k in Object.prototype)) rec[k] = item[k];
      }
      out.push(rec);
    }
    return out;
  }
  if (prim === 'sense') {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (typeof raw.stream !== 'string' || !ID.test(raw.stream) || typeof raw.type !== 'string' || !KEY.test(raw.type)) return null;
    const data = typeof raw.data === 'string' ? (raw.data.length > 600 ? raw.data.slice(0, 600) : raw.data) : raw.data;
    return { stream: raw.stream, type: raw.type, data };
  }
  if (prim === 'actuate') {
    if (typeof raw === 'boolean') return { ok: raw };
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && typeof raw.ok === 'boolean') return { ok: raw.ok };
    return null;
  }
  return null;
}

export function canonJson(v) {
  if (v === undefined || typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') throw new Error('sysrouter: non-JSON value in manifest');
  if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('sysrouter: non-JSON value in manifest');
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map((x) => canonJson(x)).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonJson(v[k])).join(',') + '}';
}

export async function sha256Hex(v) {
  const bytes = new TextEncoder().encode(typeof v === 'string' ? v : canonJson(v));
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Shared question validator for both routes and decision capabilities (R-REG-5, #26).
export function validateQuestion(q, fail) {
  if (!q || typeof q !== 'object' || !TYPES.includes(q.type) || typeof q.instructions !== 'string' || !q.instructions.trim()) fail('question needs type and instructions');
  if (q.type === 'score' ? !(Array.isArray(q.criteria) && q.criteria.length >= 2 && q.criteria.length <= 10) : !(q.criteria && typeof q.criteria === 'object' && !Array.isArray(q.criteria))) fail('bad criteria');
  if (q.type === 'choice' && (Object.keys(q.criteria).length < 2 || Object.keys(q.criteria).length > 64)) fail('choice needs 2-64 options');
  if (q.instructions.length > 600) fail('instructions over 600 characters');
  if (q.type !== 'score' && !Object.keys(q.criteria).every((k) => KEY.test(k) && !(k in Object.prototype) && typeof q.criteria[k] === 'string' && q.criteria[k].length <= 300)) fail('option names are plain words, descriptions are strings up to 300 characters');
  if (q.type === 'score' && !q.criteria.every((c) => typeof c === 'string' && c.length <= 300)) fail('score levels are strings up to 300 characters');
  if (q.type === 'noul' && Object.keys(q.criteria).sort().join() !== 'false,true') fail('a yes/no question has criteria true and false');
  const criteria = q.type === 'score' ? Object.freeze(q.criteria.slice()) : Object.freeze(Object.assign({}, q.criteria));
  const keys = q.type === 'noul' ? ['true', 'false'] : q.type === 'choice' ? Object.keys(criteria) : criteria.map((_, i) => String(i));
  return { question: Object.freeze({ type: q.type, instructions: q.instructions, criteria }), keys };
}

function parseExposeTo(rExp) {
  const exposeTo = [];
  if (rExp !== undefined) {
    if (!Array.isArray(rExp)) throw new Error('sysrouter: bad exposeTo');
    for (const e of rExp) { if (!EXPOSE_TO.includes(e)) throw new Error('sysrouter: bad exposeTo ' + e); if (!exposeTo.includes(e)) exposeTo.push(e); }
  }
  return Object.freeze(exposeTo);
}

// The v2 registry: owns streams, commands, capabilities, triggers, routes, and extension install/uninstall (#37).
export function createRegistry(ctx) {
  const { actions, providers, routes, capabilities, triggers, installed, streams, assertOpen, isSealed, getBlockList, registerExtEngine } = ctx;

  function checkCollision(instructions, onMap, fail) {
    for (const rid in routes) {
      const o = routes[rid];
      if (o.question.instructions === instructions && Object.keys(onMap).some((k) => has(o.on, k) && o.on[k] !== onMap[k])) fail('collides with ' + rid);
    }
    for (const cid in capabilities) {
      const c = capabilities[cid], reqMap = c.behavior && c.behavior.request;
      if (!reqMap) continue;
      for (const st of c.steps) {
        if (st.question && st.question.instructions === instructions && Object.keys(onMap).some((k) => has(reqMap, k) && reqMap[k] !== onMap[k])) fail('collides with ' + cid);
      }
    }
  }

  function addStream(rawDecl, who) {
    if (!rawDecl || typeof rawDecl !== 'object') throw new Error('sysrouter: bad stream');
    const decl = snapshot(rawDecl);
    const id = decl.id, rt = decl.types;
    if (!ID.test(id || '')) throw new Error('sysrouter: bad stream id ' + id);
    if (has(streams, id)) throw new Error('sysrouter: stream exists: ' + id);
    const types = dict();
    if (Array.isArray(rt)) { for (const t of rt) if (typeof t === 'string' && KEY.test(t)) types[t] = true; }
    else if (rt && typeof rt === 'object') { for (const t of Object.keys(rt)) if (KEY.test(t) && !(t in Object.prototype)) types[t] = true; }
    if (!Object.keys(types).length) throw new Error('sysrouter: stream ' + id + ' needs types');
    const exposeTo = parseExposeTo(decl.exposeTo);
    streams[id] = { id, tier: who.tier, owner: who.name || '', types, exposeTo, latest: null, watchers: [] };
    return id;
  }

  function addCommand(rawSpec, who) {
    if (!rawSpec || typeof rawSpec !== 'object') throw new Error('sysrouter: bad command');
    const spec = snapshot(rawSpec);
    const id = spec.id, cap = spec.capability, run = spec.run, rArgs = spec.args, rExp = spec.exposeTo;
    const resource = spec.resource ? String(spec.resource) : '', holdMs = +spec.holdMs || 0, cooldownMs = Math.max(0, +spec.cooldownMs || 0), reserved = !!spec.reserved;
    if (!ID.test(id || '')) throw new Error('sysrouter: bad command ' + id);
    if (has(actions, id)) throw new Error('sysrouter: action exists: ' + id);
    if (reserved && isSealed()) throw new Error('sysrouter: reserved actions are registered before seal()');
    if (who.tier !== 'extension') assertOpen();
    if (who.tier === 'extension' && run !== undefined) throw new Error('sysrouter: extension commands cannot carry run functions');
    if (typeof run !== 'function' && (typeof cap !== 'string' || !ID.test(cap))) throw new Error('sysrouter: command ' + id + ' needs capability or run');
    if (typeof run !== 'function' && !has(capabilities, cap)) throw new Error('sysrouter: unknown capability ' + cap);
    const exposeTo = parseExposeTo(rExp);
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
    actions[id] = { id, tier: who.tier, owner: who.name || '', run: typeof run === 'function' ? run : null, capability: typeof cap === 'string' ? cap : '', args, exposeTo, resource, holdMs, cooldownMs, reserved };
    return id;
  }

  function addCapability(rawSpec, who) {
    if (!rawSpec || typeof rawSpec !== 'object') throw new Error('sysrouter: bad capability');
    const spec = snapshot(rawSpec);
    const id = spec.id, rawSteps = spec.steps, rawBeh = spec.behavior;
    const fail = (m) => { throw new Error('sysrouter: capability ' + id + ': ' + m); };
    const capPolicy = spec.policy || 'single', budgetMs = Math.max(20, Math.min(10000, +spec.budgetMs || 1500));
    const rawMode = spec.mode || 'shadow', mode = rawMode === 'parallel' ? 'live' : rawMode;
    const addsRecall = !!spec.addsRecall, agree = typeof spec.agree === 'string' ? spec.agree : '';
    const cooldownMs = Math.max(0, +spec.cooldownMs || 0);
    if (!ID.test(id || '')) throw new Error('sysrouter: bad capability id ' + id);
    if (has(capabilities, id)) throw new Error('sysrouter: capability exists: ' + id);
    if (!MODES.includes(mode) || !POLICIES.includes(capPolicy)) throw new Error('sysrouter: bad mode or policy');
    if (!Array.isArray(rawSteps) || !rawSteps.length || rawSteps.length > 8) throw new Error('sysrouter: capability needs 1-8 steps');
    const steps = [];
    let lastKeys = null, lastQuestion = null, allExact = true;
    for (const st of rawSteps) {
      if (!st || typeof st !== 'object' || !PRIMITIVES.includes(st.primitive)) throw new Error('sysrouter: bad capability step');
      const prim = st.primitive, eng = Array.isArray(st.engines) ? st.engines.slice() : (Array.isArray(st.providers) ? st.providers.slice() : []);
      const sh = Array.isArray(st.shadow) ? st.shadow.slice() : [], pol = st.policy || capPolicy;
      if (!eng.length || eng.length > 4 || sh.length > 4 || !POLICIES.includes(pol)) throw new Error('sysrouter: bad step engines/policy');
      if (pol === 'single' && eng.length !== 1) throw new Error('sysrouter: single takes one engine');
      for (const pid of eng.concat(sh)) {
        if (!has(providers, pid)) throw new Error('sysrouter: unknown provider ' + pid);
        if (!has(providers[pid].primitives, prim) && !providers[pid].types.includes(prim)) throw new Error('sysrouter: ' + pid + ' cannot run ' + prim);
        if (who.grants && !who.grants.providers.includes(pid)) throw new Error('sysrouter: no grant for provider ' + pid);
      }
      if (!eng.every((pid) => providers[pid].exact)) allExact = false;
      let question = null;
      if (TYPES.includes(prim) || prim === 'match') {
        const rq = st.question || { type: prim === 'match' ? 'choice' : prim, instructions: st.instructions, criteria: st.criteria };
        const vq = validateQuestion(rq, fail);
        question = vq.question;
        lastKeys = vq.keys;
        lastQuestion = question;
      }
      steps.push(Object.freeze({ primitive: prim, engines: Object.freeze(eng), shadow: Object.freeze(sh), policy: pol, question, out: st.out && typeof st.out === 'object' && !Array.isArray(st.out) ? st.out : null }));
    }
    if (lastQuestion && (typeof spec.notFor !== 'string' || spec.notFor.trim().length < 12)) fail('notFor is required: say what this capability must NOT fire on (R-REG-5)');
    const beh = { publish: '', publishType: '', request: null, onArgs: dict() };
    if (rawBeh && typeof rawBeh === 'object') {
      if (rawBeh.publish) {
        if (!has(streams, rawBeh.publish)) throw new Error('sysrouter: unknown stream ' + rawBeh.publish);
        if (who.tier === 'extension') {
          const ps = streams[rawBeh.publish];
          if (ps.tier !== 'extension' || ps.owner !== (who.name || '')) throw new Error('sysrouter: extensions can publish only to own streams: ' + rawBeh.publish);
        }
        beh.publish = rawBeh.publish;
        const ts = Object.keys(streams[beh.publish].types);
        beh.publishType = rawBeh.publishType && has(streams[beh.publish].types, rawBeh.publishType) ? rawBeh.publishType : ts[0];
      }
      if (rawBeh.request && typeof rawBeh.request === 'object') {
        const reqMap = dict();
        for (const k of Object.keys(rawBeh.request)) {
          if (lastKeys && !lastKeys.includes(k)) fail('request.' + k + ' is not an answer');
          const entry = rawBeh.request[k], aid = typeof entry === 'string' ? entry : (entry && typeof entry === 'object' && typeof entry.command === 'string' ? entry.command : '');
          if (!aid || !has(actions, aid)) throw new Error('sysrouter: unknown action ' + aid);
          const a = actions[aid];
          if (a.reserved && !(who.tier === 'core' || allExact || addsRecall)) fail('reserved action needs exact providers, or addsRecall:true');
          if (a.reserved && who.tier === 'extension') throw new Error('sysrouter: extensions cannot reach reserved actions');
          if (who.tier === 'extension' && a.tier !== 'extension' && !a.exposeTo.includes('third-party')) throw new Error('sysrouter: command not exposed to third-party: ' + aid);
          if (who.grants && !who.grants.actions.includes(aid)) throw new Error('sysrouter: no grant for action ' + aid);
          reqMap[k] = aid;
          if (entry && typeof entry === 'object' && entry.args !== undefined) beh.onArgs[k] = copyDict(entry.args);
        }
        if (lastQuestion) checkCollision(lastQuestion.instructions, reqMap, fail);
        beh.request = Object.freeze(reqMap);
      }
    }
    capabilities[id] = { id, tier: who.tier, owner: who.name || '', steps: Object.freeze(steps), policy: capPolicy, budgetMs, cooldownMs, mode, notFor: spec.notFor || '', addsRecall, agree, behavior: beh, perMin: who.grants ? who.grants.perMin : 0, maxUsd: who.grants ? who.grants.maxUsd : 0 };
    return id;
  }

  function addTrigger(rawSpec, who) {
    if (!rawSpec || typeof rawSpec !== 'object') throw new Error('sysrouter: bad trigger');
    const spec = snapshot(rawSpec);
    const id = spec.id, ro = spec.on, cmd = spec.command, ra = spec.args;
    const rawMode = spec.mode || 'shadow', mode = rawMode === 'parallel' ? 'live' : rawMode, cooldownMs = Math.max(0, +spec.cooldownMs || 0);
    if (!ID.test(id || '')) throw new Error('sysrouter: bad trigger id ' + id);
    if (has(triggers, id)) throw new Error('sysrouter: trigger exists: ' + id);
    if (!MODES.includes(mode)) throw new Error('sysrouter: bad trigger mode');
    if (!cmd || !has(actions, cmd)) throw new Error('sysrouter: unknown command ' + cmd);
    const a = actions[cmd];
    if (a.reserved && who.tier === 'extension') throw new Error('sysrouter: extensions cannot reach reserved actions');
    if (who.tier === 'extension' && a.tier !== 'extension' && !a.exposeTo.includes('third-party')) throw new Error('sysrouter: command not exposed to third-party: ' + cmd);
    if (who.grants && !who.grants.actions.includes(cmd)) throw new Error('sysrouter: no grant for action ' + cmd);
    if (!ro || typeof ro !== 'object') throw new Error('sysrouter: bad trigger on');
    let onSnap;
    if (ro.stream) {
      if (!has(streams, ro.stream)) throw new Error('sysrouter: unknown stream ' + ro.stream);
      if (who.tier === 'extension' && streams[ro.stream].tier !== 'extension' && !streams[ro.stream].exposeTo.includes('third-party')) throw new Error('sysrouter: stream not exposed to third-party: ' + ro.stream);
      if (who.grants && who.grants.streams && !who.grants.streams.includes(ro.stream)) throw new Error('sysrouter: no grant for stream ' + ro.stream);
      const t = ro.type;
      if (t !== undefined && (typeof t !== 'string' || !has(streams[ro.stream].types, t))) throw new Error('sysrouter: bad trigger stream type ' + t);
      onSnap = { stream: ro.stream, type: t || '' };
    } else if (ro.person === true) {
      if (!a.exposeTo.includes('person')) throw new Error('sysrouter: command not exposed to person: ' + cmd);
      onSnap = { person: true };
    } else if (ro.creature === true) {
      if (!a.exposeTo.includes('creature')) throw new Error('sysrouter: command not exposed to creature: ' + cmd);
      onSnap = { creature: true };
    } else throw new Error('sysrouter: bad trigger on');
    const argsSnap = ra === undefined ? undefined : (ra && typeof ra === 'object' && !Array.isArray(ra) ? copyDict(ra) : ra);
    triggers[id] = { id, tier: who.tier, owner: who.name || '', on: Object.freeze(onSnap), command: cmd, args: argsSnap, mode, cooldownMs, perMin: who.grants ? who.grants.perMin : 0 };
    return id;
  }

  // v1 route registration: thin sugar over the shared validation and unified step/capability model (#26).
  function addRoute(rawSpec, who) {
    if (!rawSpec || typeof rawSpec !== 'object') throw new Error('sysrouter: route ' + (rawSpec && rawSpec.id) + ': bad id');
    const spec = snapshot(rawSpec);
    const fail = (m) => { throw new Error('sysrouter: route ' + spec.id + ': ' + m); };
    if (!ID.test(spec.id || '')) fail('bad id');
    if (has(routes, spec.id)) fail('exists');
    if (who.tier === 'extension') {
      if (!who.grants || !who.grants.streams || !who.grants.streams.includes('speech')) fail('no grant for stream speech');
      if (!streams['speech'].exposeTo.includes('third-party')) fail('stream not exposed to third-party: speech');
    }
    const { question, keys } = validateQuestion(spec.question, fail);
    if (typeof spec.notFor !== 'string' || spec.notFor.trim().length < 12) fail('notFor is required: say what this route must NOT fire on (R-REG-5)');
    const rawMode = spec.mode || 'shadow', mode = rawMode === 'parallel' ? 'live' : rawMode, policy = spec.policy || 'single';
    if (!MODES.includes(mode) || !POLICIES.includes(policy)) fail('bad mode or policy');
    const ps = spec.providers || [], sh = spec.shadow || [];
    if (!Array.isArray(ps) || !Array.isArray(sh) || !ps.length || ps.length > 4 || sh.length > 4) fail('1-4 providers');
    for (const pid of ps.concat(sh)) { if (!has(providers, pid)) fail('unknown provider ' + pid); if (!providers[pid].types.includes(question.type)) fail(pid + ' cannot answer ' + question.type); }
    if (policy === 'single' && ps.length !== 1) fail('single takes one provider');
    const ro = spec.on === undefined ? dict() : spec.on;
    if (!ro || typeof ro !== 'object' || Array.isArray(ro)) fail('bad on');
    const on = dict(), onArgs = dict();
    for (const k of Object.keys(ro)) {
      if (!keys.includes(k)) fail('on.' + k + ' is not an answer');
      const rawEntry = ro[k], aid = typeof rawEntry === 'string' ? rawEntry : (rawEntry && typeof rawEntry === 'object' && typeof rawEntry.command === 'string' ? rawEntry.command : '');
      if (!aid || !has(actions, aid)) fail('unknown action ' + aid);
      on[k] = aid;
      if (rawEntry && typeof rawEntry === 'object' && rawEntry.args !== undefined) onArgs[k] = copyDict(rawEntry.args);
      const a = actions[aid];
      if (a.reserved && !(who.tier === 'core' || ps.every((pid) => providers[pid].exact) || spec.addsRecall === true)) fail('reserved action needs exact providers, or addsRecall:true');
      if (a.reserved && who.tier === 'extension') fail('extensions cannot reach reserved actions');
      if (who.tier === 'extension' && a.tier !== 'extension' && !a.exposeTo.includes('third-party')) fail('command not exposed to third-party: ' + aid);
      if (who.grants && !who.grants.actions.includes(aid)) fail('no grant for action ' + aid);
    }
    if (who.grants) for (const pid of ps.concat(sh)) if (!who.grants.providers.includes(pid)) fail('no grant for provider ' + pid);
    checkCollision(question.instructions, on, fail);
    const unexposed = Array.isArray(spec.unexposed) ? Object.freeze(spec.unexposed.filter((k) => keys.includes(k))) : Object.freeze([]);
    const step = Object.freeze({ primitive: question.type, engines: Object.freeze(ps.slice()), shadow: Object.freeze(sh.slice()), policy, question, out: null });
    routes[spec.id] = {
      id: spec.id, tier: who.tier, owner: who.name || '', question, steps: Object.freeze([step]),
      on: Object.freeze(Object.assign(dict(), on)), onArgs, unexposed, providers: ps.slice(), shadow: sh.slice(), policy, mode, notFor: spec.notFor,
      budgetMs: Math.max(20, Math.min(10000, +spec.budgetMs || 1500)), cooldownMs: Math.max(0, +spec.cooldownMs || 0),
      input: spec.input === 'creature' || spec.input === 'both' ? spec.input : 'person', agree: typeof spec.agree === 'string' ? spec.agree : '',
      perMin: who.grants ? who.grants.perMin : 0, maxUsd: who.grants ? who.grants.maxUsd : 0
    };
    return spec.id;
  }

  function dropRoute(id, who) { const r = routes[id]; if (!r || (who.name || '') !== r.owner || r.tier !== who.tier) return false; delete routes[id]; return true; }

  function normPerms(p) {
    const acts = ((p && (p.commands || p.actions)) || []).slice();
    for (const id of acts) {
      const a = has(actions, id) ? actions[id] : null;
      if (a && a.reserved) throw new Error('sysrouter: extensions cannot be granted reserved actions');
      if (a && a.tier !== 'extension' && !a.exposeTo.includes('third-party')) throw new Error('sysrouter: command not exposed to third-party: ' + id);
    }
    const engs = ((p && (p.engines || p.providers)) || []).slice();
    const strms = ((p && p.streams) || []).slice();
    for (const id of strms) {
      const s = has(streams, id) ? streams[id] : null;
      if (s && s.tier !== 'extension' && !s.exposeTo.includes('third-party')) throw new Error('sysrouter: stream not exposed to third-party: ' + id);
    }
    const perMin = Math.max(1, Math.min(120, +(p && p.perMin) || 20));
    const pMaxUsd = p && p.maxUsd >= 0 ? +p.maxUsd : 0;
    return { actions: acts, providers: engs, streams: strms, perMin, maxUsd: pMaxUsd };
  }

  function uninstall(name) {
    if (!has(installed, name)) return false;
    for (const k in triggers) if (triggers[k].tier === 'extension' && triggers[k].owner === name) delete triggers[k];
    for (const k in routes) if (routes[k].tier === 'extension' && routes[k].owner === name) delete routes[k];
    for (const k in capabilities) if (capabilities[k].tier === 'extension' && capabilities[k].owner === name) delete capabilities[k];
    for (const k in actions) if (actions[k].tier === 'extension' && actions[k].owner === name) delete actions[k];
    for (const k in streams) if (streams[k].tier === 'extension' && streams[k].owner === name) delete streams[k];
    for (const k in providers) if (providers[k].tier === 'extension' && providers[k].owner === name) {
      if (typeof providers[k].terminate === 'function') providers[k].terminate();
      delete providers[k];
    }
    delete installed[name];
    return true;
  }

  async function install(manifest, permissions) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('sysrouter: bad manifest');
    assertJsonData(manifest);
    const blockList = getBlockList();
    const name = manifest.name;
    if (!ID.test(name || '')) throw new Error('sysrouter: bad extension name');
    if (blockList.names.has(name)) throw new Error('sysrouter: blocked extension name ' + name);
    const hash = await sha256Hex(manifest);
    if (blockList.hashes.has(hash)) throw new Error('sysrouter: blocked extension hash ' + hash);
    if (has(installed, name)) throw new Error('sysrouter: extension already installed: ' + name);
    const p = normPerms(permissions);
    const who = { tier: 'extension', name, grants: p };
    const created = { streams: [], engines: [], actions: [], capabilities: [], triggers: [], routes: [] };
    try {
      for (const s of (manifest.streams || [])) {
        if (!p.streams.includes(s && s.id)) throw new Error('sysrouter: no grant for stream ' + (s && s.id));
        created.streams.push(addStream(s, who));
      }
      for (const e of (manifest.engines || [])) {
        if (!e || typeof e !== 'object') throw new Error('sysrouter: bad engine');
        if (!p.providers.includes(e.id)) throw new Error('sysrouter: no grant for provider ' + e.id);
        created.engines.push(await registerExtEngine(e, who));
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
      for (const k of created.engines) { if (providers[k] && typeof providers[k].terminate === 'function') providers[k].terminate(); delete providers[k]; }
      for (const k of created.streams) delete streams[k];
      throw e;
    }
    installed[name] = { name, hash, permissions: p };
    return { name, hash, permissions: JSON.parse(JSON.stringify(p)) };
  }

  return { addStream, addCommand, addCapability, addTrigger, addRoute, dropRoute, normPerms, install, uninstall };
}
