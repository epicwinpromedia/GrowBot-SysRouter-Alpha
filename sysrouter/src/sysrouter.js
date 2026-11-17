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

const TIERS = { core: 0, system: 1, extension: 2 };          // lower number = higher priority
const MODES = ['shadow', 'parallel', 'preempt'], POLICIES = ['single', 'cascade', 'race'], TYPES = ['noul', 'choice', 'score'];
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const ID = /^[a-z][a-z0-9_.-]{0,39}$/, KEY = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/, GATE = /^[a-z][A-Za-z0-9_.@\/:~-]{0,95}$/;
const dict = () => Object.create(null);   // no prototype: a key named __proto__ or constructor is just a key (test_router "hostile keys")

// Kill switch and per-route modes, the codebase's way: read from the URL, persisted to
// localStorage, so a link turns it off and it stays off (?bodysnd=0, ?stream=0 do the same).
//   ?sysrouter=0            everything off          ?sysrouter=1   back on
//   ?sysroute=wake:parallel,express:off             per route: off | shadow | parallel | preempt
export function readFlags(search, storage) {
  const f = { off: false, routes: {} };
  try {
    const q = new URLSearchParams(search || ''), a = q.get('sysrouter'), b = q.get('sysroute');
    if (a === '0' || a === '1') storage.gb_sysrouter = a;
    if (b !== null) storage.gb_sysroute = b;
    f.off = storage.gb_sysrouter === '0';
    for (const part of String(storage.gb_sysroute || '').split(',')) {
      const [id, m] = part.split(':');
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

export function createRouter(opts) {
  opts = opts || {};
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const now = opts.now || (() => Date.now());
  const flags = opts.flags || { off: false, routes: {} };
  const actions = dict(), providers = dict(), routes = dict(), gates = dict(), held = dict(), last = dict(), seqOf = dict(), spend = dict(), lastPick = dict(), flight = dict(), health = dict(), paid = dict();
  // reliability limits, all overridable: a provider that fails BREAK.fails times in a row is left alone for BREAK.ms; hosted engines stop being asked once the session has spent maxUsd
  const BREAK = { fails: Math.max(1, +(opts.breaker && opts.breaker.fails) || 3), ms: Math.max(0, +(opts.breaker && opts.breaker.ms) || 30000) }, maxUsd = opts.maxUsd >= 0 ? +opts.maxUsd : 0.25;
  let sealed = false, seq = 0, depth = 0, usd = 0;

  function row(r, why, x) {   // one journal row per decision (R-OBS-1). Never the words: the funnel's own "user" row holds their hash.
    const o = { r: r.id, tier: r.tier, mode: modeOf(r), why };
    if (r.owner) o.ext = r.owner;
    if (x) for (const k in x) if (x[k] !== undefined && x[k] !== null && x[k] !== '') o[k] = x[k];
    if (r.agree && o.a && why !== 'agree' && why !== 'shadow_arm') lastPick[r.id] = o.a;
    try { log('sysroute', o); } catch (e) {}
    return o;
  }
  const modeOf = (r) => flags.off ? 'off' : (flags.routes && has(flags.routes, r.id) ? flags.routes[r.id] : r.mode);
  const gateOf = (r, pid, model) => { const g = gates[r.id] || dict(); return g[pid + '@' + model] || g[pid] || null; };

  function action(id, a) {
    if (!ID.test(id) || !a || typeof a.run !== 'function') throw new Error('sysrouter: bad action ' + id);
    if (has(actions, id)) throw new Error('sysrouter: action exists: ' + id);
    if (a.reserved && sealed) throw new Error('sysrouter: reserved actions are registered before seal()');
    actions[id] = { run: a.run, resource: a.resource || '', holdMs: +a.holdMs || 0, reserved: !!a.reserved };
  }
  function provider(id, p) {
    if (!ID.test(id) || !p || typeof p.ask !== 'function') throw new Error('sysrouter: bad provider ' + id);
    if (has(providers, id)) throw new Error('sysrouter: provider exists: ' + id);
    providers[id] = { ask: p.ask, sync: !!p.sync, exact: !!p.exact, model: String(p.model || ''), types: p.types || TYPES };
  }
  function calibrate(table) {   // { routeId: { 'providerId' or 'providerId@model': { p, pn, margin } } }
    if (!table || typeof table !== 'object') return;
    for (const rid of Object.keys(table)) { if (!ID.test(rid) || !table[rid] || typeof table[rid] !== 'object') continue; gates[rid] = gates[rid] || dict();
      for (const k of Object.keys(table[rid])) { const g = table[rid][k]; if (GATE.test(k) && g && g.p > 0.5 && g.p <= 1) gates[rid][k] = { p: +g.p, pn: g.pn > 0.5 && g.pn <= 1 ? +g.pn : +g.p, margin: +g.margin || 0 }; } }
  }

  // Registration is DATA: no function crosses this line, so the same call works from a Worker
  // or an iframe by message (R-TRUST-5). `who` is set by the loader, never read from the spec.
  function addRoute(spec, who) {
    const fail = (m) => { throw new Error('sysrouter: route ' + (spec && spec.id) + ': ' + m); };
    if (!spec || !ID.test(spec.id || '')) fail('bad id');
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
    const mode = spec.mode || 'shadow', policy = spec.policy || 'single';
    if (!MODES.includes(mode) || !POLICIES.includes(policy)) fail('bad mode or policy');
    const ps = spec.providers || [], sh = spec.shadow || [];
    if (!ps.length || ps.length > 4 || sh.length > 4) fail('1-4 providers');
    for (const pid of ps.concat(sh)) { if (!has(providers, pid)) fail('unknown provider ' + pid); if (!providers[pid].types.includes(q.type)) fail(pid + ' cannot answer ' + q.type); }
    if (policy === 'single' && ps.length !== 1) fail('single takes one provider');
    const on = spec.on || {}, keys = q.type === 'noul' ? ['true', 'false'] : q.type === 'choice' ? Object.keys(q.criteria) : q.criteria.map((_, i) => String(i));
    for (const k of Object.keys(on)) {
      if (!keys.includes(k)) fail('on.' + k + ' is not an answer');
      if (typeof on[k] !== 'string' || !has(actions, on[k])) fail('unknown action ' + on[k]);
      const a = actions[on[k]];
      // a reserved action (stop, halt) is reachable only through an exact provider chain: a probability may never be the only thing between words and a stop, in either direction (R-SAFE-1)
      if (a.reserved && !(who.tier === 'core' || ps.every((pid) => providers[pid].exact) || spec.addsRecall === true)) fail('reserved action needs exact providers, or addsRecall:true');
      if (a.reserved && spec.addsRecall && who.tier === 'extension') fail('extensions cannot reach reserved actions');
      if (who.grants && !who.grants.actions.includes(on[k])) fail('no grant for action ' + on[k]);
    }
    if (who.grants) for (const pid of ps.concat(sh)) if (!who.grants.providers.includes(pid)) fail('no grant for provider ' + pid);
    if (who.grants && mode === 'preempt') fail('extensions cannot pre-empt the brain');
    for (const rid in routes) {   // collisions (R-REG-5): two acting routes may not both claim one answer of one identical question
      const o = routes[rid]; if (o.question.instructions === q.instructions && Object.keys(on).some((k) => has(o.on, k) && o.on[k] !== on[k])) fail('collides with ' + rid);
    }
    routes[spec.id] = { id: spec.id, tier: who.tier, owner: who.name || '', question: Object.freeze({ type: q.type, instructions: q.instructions, criteria }),
      on: Object.freeze(Object.assign(dict(), on)), providers: ps.slice(), shadow: sh.slice(), policy, mode, notFor: spec.notFor,
      budgetMs: Math.max(20, Math.min(10000, +spec.budgetMs || 1500)), cooldownMs: Math.max(0, +spec.cooldownMs || 0),
      input: spec.input === 'creature' || spec.input === 'both' ? spec.input : 'person', agree: typeof spec.agree === 'string' ? spec.agree : '', perMin: who.grants ? who.grants.perMin : 0 };
    return spec.id;
  }
  function dropRoute(id, who) { const r = routes[id]; if (!r || (who.name || '') !== r.owner || r.tier !== who.tier) return false; delete routes[id]; return true; }

  // The loader hands an extension this facade and nothing else (R-TRUST-1..4): it can add and
  // remove ITS OWN routes, over the actions and providers it was granted, at its own rate cap.
  function extension(name, grants) {
    if (!ID.test(name)) throw new Error('sysrouter: bad extension name');
    const who = { tier: 'extension', name, grants: { actions: (grants && grants.actions || []).slice(), providers: (grants && grants.providers || []).slice(), perMin: Math.max(1, Math.min(120, +(grants && grants.perMin) || 20)) } };
    return Object.freeze({ route: (spec) => addRoute(spec, who), unroute: (id) => dropRoute(id, who), grants: () => JSON.parse(JSON.stringify(who.grants)) });
  }

  function act(r, pick, x) {
    const aid = has(r.on, pick) ? r.on[pick] : '', mode = modeOf(r);
    if (!aid) return row(r, 'none', x);
    const a = actions[aid], t = now(), tier = TIERS[r.tier];
    x.act = aid;
    if (mode === 'shadow') return row(r, 'shadow', x);
    if (!a.reserved) {
      if (r.cooldownMs && t - (last[r.id + '>' + aid] || -1e15) < r.cooldownMs) return row(r, 'cooldown', x);   // per action: a debounce against the same thing twice, never a block on a different command
      const h = a.resource && held[a.resource];
      if (h && h.until > t && h.tier < tier) return row(r, 'held', x);                 // a lower tier never pre-empts what a higher tier holds (R-TRUST-2)
    }
    last[r.id + '>' + aid] = t;
    if (a.reserved) for (const k in held) delete held[k];                               // a stop clears every hold, whoever owns it
    else if (a.resource && a.holdMs) held[a.resource] = { tier, until: t + a.holdMs };
    try { a.run({ route: r.id, pick, tier: r.tier }); } catch (e) { return row(r, 'act_error', x); }
    x.did = 1;
    return row(r, mode === 'preempt' ? 'preempt' : 'acted', x);
  }

  // Ask one provider. Sync providers answer in the same tick: a deterministic stop is never
  // behind a promise. Returns { d, x } where d is the checked decision or null.
  function settle(r, pid, res, t0) {
    const P = providers[pid], x = { p: pid, ms: Math.round(now() - t0) };
    if (!res || typeof res !== 'object' || !res.answers) return { d: null, x, why: 'bad_answer' };
    if (res.model) x.m = String(res.model).replace(/[^\w.\/:@~-]/g, '').slice(0, 48);
    if (typeof res.usd === 'number' && res.usd >= 0 && res.usd < 1) { x.usd = res.usd; usd += res.usd; if (res.usd > 0) paid[pid] = true; }
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
    const mark = (res) => { if (res.why === 'error' || res.why === 'timeout' || res.why === 'bad_answer') { if (++h.fails >= BREAK.fails) { h.fails = 0; h.until = now() + BREAK.ms; } } else if (res.why !== 'stale') h.fails = 0; return res; };
    let onAbort;
    const aborted = new Promise((_, rej) => { onAbort = () => rej(new Error('aborted')); signal.addEventListener('abort', onAbort, { once: true }); });
    const p = Promise.resolve().then(() => providers[pid].ask(req, { signal, route: r.id }));
    p.catch(() => {});
    return Promise.race([p, aborted]).finally(() => signal.removeEventListener('abort', onAbort)).then(
      (res) => signal.aborted ? { d: null, x: { p: pid, ms: Math.round(now() - t0) }, why: whyAbort() } : settle(r, pid, res, t0),
      () => ({ d: null, x: { p: pid, ms: Math.round(now() - t0) }, why: signal.aborted ? whyAbort() : 'error' })
    ).then(mark);
  }

  function hear(text, meta) {
    meta = meta || {};
    const out = { acted: [], preempt: false, done: null }, waits = [], from = meta.from === 'creature' ? 'creature' : 'person';
    if (flags.off || typeof text !== 'string' || !text.trim() || depth > 1) { out.done = Promise.resolve(out); return out; }   // depth: an action that makes the creature speak may be heard once, never in a loop
    const state = text.length > 600 ? text.slice(0, 600) : text, my = ++seq;
    depth++;
    try { for (const rid in routes) {
      const r = routes[rid];
      if (modeOf(r) === 'off' || (r.input !== 'both' && r.input !== from)) continue;
      if (r.perMin) { const m = Math.floor(now() / 60000), s = spend[r.owner] = spend[r.owner] && spend[r.owner].m === m ? spend[r.owner] : { m, n: 0 }; if (++s.n > r.perMin) { row(r, 'rate'); continue; } }
      seqOf[rid] = my;
      const req = { state, questions: { q: r.question } }, fresh = () => seqOf[rid] === my;
      const finish = (res) => { const o = act(r, res.d.pick, res.x); if (o.did) { out.acted.push(o.act); if (o.why === 'preempt') out.preempt = true; } };
      // 1. the leading sync providers, in order, in this tick
      let i = 0, decided = false;
      for (; i < r.providers.length && providers[r.providers[i]].sync; i++) {
        const t0 = now(); let res;
        try { res = settle(r, r.providers[i], providers[r.providers[i]].ask(req, { route: rid }), t0); } catch (e) { res = { d: null, x: { p: r.providers[i] }, why: 'error' }; }
        if (res.d) { finish(res); decided = true; break; }
        if (r.policy === 'single' || i === r.providers.length - 1) row(r, res.why, res.x);
      }
      const rest = decided ? [] : r.providers.slice(i);
      // 2. the async providers, outside the brain's single flight (R-RT-5), under the route's budget
      if (rest.length || r.shadow.length) {
        if (flight[rid]) flight[rid].abort('stale');                                         // one flight per route: the engines still working on older words are told to stop
        const ctl = flight[rid] = new AbortController(), sctl = new AbortController(), timer = setTimeout(() => { ctl.abort('timeout'); sctl.abort('timeout'); }, r.budgetMs);
        const sh = r.shadow.map((pid) => askAsync(r, pid, req, sctl.signal).then((res) => { row(r, 'shadow_arm', Object.assign(res.x, { arm: res.why || 'ok' })); }));
        let main;
        if (r.policy === 'race') main = new Promise((done) => { let left = rest.length, won = false; if (!left) done();
          rest.forEach((pid) => askAsync(r, pid, req, ctl.signal).then((res) => { if (res.d && !won) { won = true; if (fresh()) finish(res); else row(r, 'stale', res.x); ctl.abort('won'); } else if (!res.d && !won && left === 1) row(r, res.why, res.x); if (!--left || won) done(); })); });   // first CONFIDENT answer wins, not first to arrive
        else main = rest.reduce((chain, pid, k) => chain.then((got) => got ? got : askAsync(r, pid, req, ctl.signal).then((res) => {
          if (!fresh()) { row(r, 'stale', res.x); return true; }
          if (res.d) { finish(res); return true; }
          if (k === rest.length - 1) row(r, res.why, res.x);                              // the last word of a cascade is logged with why it did not act
          return false; })), Promise.resolve(false));
        const end = () => { clearTimeout(timer); if (flight[rid] === ctl) delete flight[rid]; };
        waits.push(Promise.all([main].concat(sh)).then(end, end));
      }
    } } finally { depth--; }
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

  return {
    action, provider, calibrate, extension, hear, replied,
    route: (spec) => addRoute(spec, { tier: 'system' }),
    core: (spec) => { if (sealed) throw new Error('sysrouter: core routes are registered before seal()'); return addRoute(spec, { tier: 'core' }); },
    unroute: (id) => { const r = routes[id]; if (!r || r.tier === 'extension' || (r.tier === 'core' && sealed)) return false; delete routes[id]; return true; },
    seal: () => { sealed = true; },
    release: (resource) => { delete held[resource]; },
    spent: () => usd,                                                                    // what hosted engines have cost this session, for the page to show                                   // the page says a hold ended early (motion finished, person took over)
    list: () => Object.keys(routes).map((id) => ({ id, tier: routes[id].tier, owner: routes[id].owner, mode: modeOf(routes[id]), providers: routes[id].providers.slice(), on: Object.assign({}, routes[id].on) }))
  };
}
