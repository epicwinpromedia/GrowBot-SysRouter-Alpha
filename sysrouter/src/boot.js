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
//   SysRouterHost          { command(kind, by), commands: [...], run: { halt, still, ... }, react(fields, id) }
//                          the executors. Only exposed commands are registered; unexposed picks log why:"unexposed".
//
// <script type="module" src="/sysrouter/boot.js?v=1117"></script>

import { createRouter, readFlags } from './sysrouter.js';
import { readersProvider, ftPick } from './s1-readers.js';
import { ngramProvider } from './s1-ngram.js';
import { embedProvider, headProvider } from './s1-embed.js';
import { httpProvider } from './s1-http.js';
import { keyring, browserEnv } from './keys.js';
import { registerFuzzy, FUZZY } from './fuzzy.js';
import { registerEmote } from './emote.js';

const DEFAULT_COMMAND_KINDS = ['halt', 'still', 'follow', 'unfollow'];

export async function boot(w, opts) {
  opts = opts || {};
  const base = opts.base || new URL('../models/', import.meta.url).href, store = (() => { try { return w.localStorage; } catch (e) { return {}; } })();
  const flags = readFlags(w.location ? w.location.search : '', store);
  if (flags.off || !(opts.defaultOn || store.gb_sysrouter === '1')) { w.SysRouter = null; return null; }
  const log = (e, d) => { try { if (typeof w.logEv === 'function') w.logEv(e, d); } catch (_) {} };
  const sr = createRouter({ log, flags }), host = w.SysRouterHost || {};
  const doFetch = opts.fetch || (typeof w.fetch === 'function' ? w.fetch.bind(w) : null);
  const json = async (name) => { try { if (!doFetch) return null; const r = await doFetch(base + name); return r && r.ok ? await r.json() : null; } catch (e) { return null; } };
  const unwired = (act) => () => log('sysroute', { why: 'unwired', act });

  const wake = [], express = [];
  if (typeof w._ftWords === 'function') { sr.provider('readers', readersProvider((t) => ftPick(w._ftWords(t)))); wake.push('readers'); }
  const [mw, me, eh, gates] = await Promise.all([json('wake.ngram.json'), json('express.ngram.json'), json('express.minilm-head.json'), json('gates.json')]);
  if (mw) { sr.provider('ngram-fuzzy', ngramProvider(mw)); wake.push('ngram-fuzzy'); }
  if (me) { sr.provider('ngram-emote', ngramProvider(me)); express.push('ngram-emote'); }

  // Composed emote (2B.2, #29): load MiniLM + trained head when available, else fall back to n-gram.
  let composedEmote = false;
  if (eh) {
    try {
      let embProv = null;
      if (typeof opts.embed === 'function') {
        embProv = embedProvider({ embed: opts.embed, id: 'all-minilm-l6-v2' });
      } else if (w.ort && doFetch) {
        const mlBase = opts.mlBase || '/ml/';
        const vr = await doFetch(mlBase + 'vocab.txt');
        if (vr && vr.ok) {
          const vocab = await vr.text();
          const session = await w.ort.InferenceSession.create(mlBase + 'all-MiniLM-L6-v2.q.onnx');
          embProv = embedProvider({ ort: w.ort, session, vocab, id: 'all-minilm-l6-v2' });
        }
      }
      if (embProv) {
        sr.provider('embed-minilm', embProv);
        sr.provider('embed-emote', headProvider(eh));
        composedEmote = true;
      }
    } catch (e) {}
  }

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
    const exposed = Array.isArray(host.commands) ? host.commands
      : (typeof host.command === 'function' ? DEFAULT_COMMAND_KINDS : Object.keys(FUZZY.on).filter((k) => typeof run[k] === 'function'));
    for (const k of exposed) {
      if (!(k in FUZZY.on)) continue;
      if (typeof host.command === 'function') r[k] = () => host.command(k, 'sysrouter');
      else if (typeof run[k] === 'function') r[k] = run[k];
    }
    registerFuzzy(sr, r, wake);
  }
  const reactFn = typeof host.react === 'function' ? host.react : (fields, id) => unwired(id)();
  if (composedEmote) registerEmote(sr, reactFn, express, { embedEngine: 'embed-minilm', headEngine: 'embed-emote' });
  else if (express.length) registerEmote(sr, reactFn, express);
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
