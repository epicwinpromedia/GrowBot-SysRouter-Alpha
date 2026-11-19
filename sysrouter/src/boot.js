// boot.js — wires the router into the app page. Loaded as one module script; everything it
// needs from the page it reads by name and checks first, so the page runs unchanged when
// this file, or any function it looks for, is missing.
//
// OFF BY DEFAULT. It boots only after ?sysrouter=1 (persisted, like ?express=bench), and
// ?sysrouter=0 turns it off again. Once on, every route starts in SHADOW: it decides, writes
// its journal row, and acts on nothing. A route acts only when ?sysroute=<id>:parallel says so.   // AUDIT-PHASE2 B1 (#36): v2 name is `live` (parallel is an alias).
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
import { registerFuzzy, FUZZY } from './fuzzy.js';
import { registerEmote } from './emote.js';

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
  if (mw) { sr.provider('ngram-fuzzy', ngramProvider(mw)); wake.push('ngram-fuzzy'); }
  if (me) { sr.provider('ngram-emote', ngramProvider(me)); express.push('ngram-emote'); }
  // A hosted engine is asked only when the person supplied a lane for it (their own server,
  // or their own OpenRouter key: keys.js) AND asked for it with ?s1=<model>. No lane, no call.
  const hosted = (() => { try { const q = new URLSearchParams(w.location.search).get('s1'); if (q !== null) store.gb_s1 = q; return String(store.gb_s1 || ''); } catch (e) { return ''; } })();
  const send = hosted ? keyring(browserEnv(store), { origin: w.location.origin, fetch: opts.fetch }).sender('systemone') : null;
  let hostedModel = '', explicitHost = '';
  if (send && /^[a-z0-9~_.\/@-]{3,80}$/i.test(hosted)) {
    const at = hosted.indexOf('@');
    hostedModel = at > 0 ? hosted.slice(0, at) : hosted;
    explicitHost = at > 0 ? hosted.slice(at + 1) : '';
    const pinHost = explicitHost || (/^(cloudflare|typesafe)\//.test(hostedModel) ? hostedModel.split('/')[0] : '');
    const extra = pinHost && (send.lane === 'byok' || send.lane === 'house') ? { provider: { only: [pinHost] } } : undefined;
    sr.provider('hosted', httpProvider({ model: hostedModel, send, extra }));
    wake.push('hosted'); express.push('hosted');
  }

  if (wake.length) {
    const run = host.run || {}, r = {};
    for (const k in FUZZY.on) r[k] = typeof host.command === 'function' ? () => host.command(k, 'sysrouter') : (typeof run[k] === 'function' ? run[k] : unwired(k));   // AUDIT-PHASE2 A13 (#28): gives EVERY kind a function, so all eight are always offered/registered whatever the host exposes, and with the proposal's command() four of them log acted while doing nothing. Follow SPEC §9.2 R2: fixed trained question, host declares exposed kinds (run keys / SysRouterHost.commands / default halt,still,follow,unfollow), unexposed picks -> why:'unexposed', did:0.
    registerFuzzy(sr, r, wake);
  }
  if (express.length) registerEmote(sr, typeof host.react === 'function' ? host.react : (fields, id) => unwired(id)(), express);   // AUDIT-PHASE2 A14 (#29): never loads MiniLM or passes embedEngine/headEngine, so the composed emote (plan 2B.2) never ships; load it when model files exist, with a trigger on speech, n-gram as fallback.
  if (gates) {
    const cal = {};
    for (const rk in gates) {
      cal[rk] = Object.assign({}, gates[rk]);
      if (explicitHost && cal[rk]['hosted@' + hostedModel + '@' + explicitHost]) {
        cal[rk]['hosted@' + hostedModel] = cal[rk]['hosted@' + hostedModel + '@' + explicitHost];
      }
    }
    sr.calibrate(cal);
  }
  sr.seal();
  w.SysRouter = sr.port();
  log('sysroute', { why: 'boot', routes: sr.list().map((x) => x.id + ':' + x.mode + ':' + x.providers.join('>')).join(' ') });
  return w.SysRouter;
}

if (typeof window !== 'undefined' && !window.__sysrouterNoAutoBoot) boot(window).catch(() => { window.SysRouter = null; });
