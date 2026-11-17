// boot.js — wires the router into the app page. Loaded as one module script; everything it
// needs from the page it reads by name and checks first, so the page runs unchanged when
// this file, or any function it looks for, is missing.
//
// OFF BY DEFAULT. It boots only after ?sysrouter=1 (persisted, like ?express=bench), and
// ?sysrouter=0 turns it off again. Once on, every route starts in SHADOW: it decides, writes
// its journal row, and acts on nothing. A route acts only when ?sysroute=<id>:parallel says so.
//
// What the page provides (all optional, all existing functions):
//   logEv(e, d)            the journal                  -> rows named "sysroute"
//   _ftWords(t)            the face-following reader    -> the "readers" provider
//   SysRouterHost          { run: { halt, still, follow, ... }, react(fields, id), play: { beep, ... } }
//                          the executors. Until the page defines it, an action that would
//                          run logs why:"unwired" instead (it cannot be reached in shadow).
//
// <script type="module" src="/sysrouter/boot.js?v=1117"></script>

import { createRouter, readFlags } from './sysrouter.js';
import { readersProvider, ftPick } from './s1-readers.js';
import { ngramProvider } from './s1-ngram.js';
import { httpProvider } from './s1-http.js';
import { keyring, browserEnv } from './keys.js';
import { registerWake, WAKE_ROUTE } from './wakeword.js';
import { registerExpress } from './expressive.js';

export async function boot(w, opts) {
  opts = opts || {};
  const base = opts.base || new URL('../models/', import.meta.url).href, store = (() => { try { return w.localStorage; } catch (e) { return {}; } })();
  const flags = readFlags(w.location ? w.location.search : '', store);
  if (flags.off || !(opts.defaultOn || store.gb_sysrouter === '1')) { w.SysRouter = null; return null; }
  const log = (e, d) => { try { if (typeof w.logEv === 'function') w.logEv(e, d); } catch (_) {} };
  const sr = createRouter({ log, flags }), host = w.SysRouterHost || {}, json = async (name) => { try { const r = await (opts.fetch || w.fetch.bind(w))(base + name); return r.ok ? await r.json() : null; } catch (e) { return null; } };
  const unwired = (act) => () => log('sysroute', { why: 'unwired', act });

  const wake = [], express = [];
  if (typeof w._ftWords === 'function') { sr.provider('readers', readersProvider((t) => ftPick(w._ftWords(t)))); wake.push('readers'); }
  const [mw, me, gates] = await Promise.all([json('wake.ngram.json'), json('express.ngram.json'), json('gates.json')]);
  if (mw) { sr.provider('ngram-wake', ngramProvider(mw)); wake.push('ngram-wake'); }
  if (me) { sr.provider('ngram-express', ngramProvider(me)); express.push('ngram-express'); }
  // A hosted engine is asked only when the person supplied a lane for it (their own server,
  // or their own OpenRouter key: keys.js) AND asked for it with ?s1=<model>. No lane, no call.
  const hosted = (() => { try { const q = new URLSearchParams(w.location.search).get('s1'); if (q !== null) store.gb_s1 = q; return String(store.gb_s1 || ''); } catch (e) { return ''; } })();
  const send = hosted ? keyring(browserEnv(store), { origin: w.location.origin }).sender('systemone') : null;
  if (send && /^[a-z0-9~_.\/-]{3,64}$/i.test(hosted)) { sr.provider('hosted', httpProvider({ model: hosted, send })); wake.push('hosted'); express.push('hosted'); }

  if (wake.length) { const run = host.run || {}, r = {}; for (const k in WAKE_ROUTE.on) r[k] = typeof run[k] === 'function' ? run[k] : unwired(k); registerWake(sr, r, wake); }
  if (express.length) registerExpress(sr, typeof host.react === 'function' ? host.react : (fields, id) => unwired(id)(), express);
  if (gates) sr.calibrate(gates);
  sr.seal();
  w.SysRouter = sr;
  log('sysroute', { why: 'boot', routes: sr.list().map((x) => x.id + ':' + x.mode + ':' + x.providers.join('>')).join(' ') });
  return sr;
}

if (typeof window !== 'undefined' && !window.__sysrouterNoAutoBoot) boot(window).catch(() => { window.SysRouter = null; });
