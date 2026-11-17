// keys.js — one key resolver for every GrowBot component, same interface in the browser and
// in Node (R-SEC-2). A component asks for a SENDER by purpose ("systemone", "chat") and gets
// a function. It never gets the key.
//
// What this guarantees (R-SEC-3), and sysrouter/test/test_keys.mjs proves:
//   • a key is sent to the ONE host its lane names, over https, and nowhere else;
//   • a key is never returned, logged, or left in an error message (errors are scrubbed);
//   • describe() shows a key as its first 6 and last 3 characters only.
//
// Lanes, tried in this order. The first one that is configured wins:
//   1. own      your own server or local proxy (tools/proxy.mjs). The page holds NO key.
//               Node: SYSROUTER_URL (+ optional SYSROUTER_KEY)      browser: pb_s1_url (+ pb_s1_key)
//   2. byok     your own OpenRouter key, straight to openrouter.ai. One key reaches Jev, Clef
//               and the small models (research/VENDORS.md §4).
//               Node: OPENROUTER_API_KEY                             browser: pb_byok (the key the brain lane already uses)
//   3. typesafe TypeSafe direct (Jev only, "systemone" only).        Node: TYPESAFE_API_KEY
//   4. house    the site's own proxy, on the house credits, when the server offers it.
//               browser only: opts.house = '/api/llm'  (needs a server route; off until then)
// Lane 1 is the answer for anyone who does not want a key in a browser at all (R-SEC-5).
//
// Usage:
//   const keys = keyring(browserEnv(localStorage));        // or nodeEnv(process.env)
//   const send = keys.sender('systemone');                 // null when no lane is configured
//   const json = await send({ model, state, questions }, signal);

export const nodeEnv = (env) => ({ get: (k) => env[k] || '' });
// the browser reads the same names from localStorage, under the app's existing keys where one exists
const BROWSER = { SYSROUTER_URL: 'pb_s1_url', SYSROUTER_KEY: 'pb_s1_key', OPENROUTER_API_KEY: 'pb_byok' };
export const browserEnv = (storage) => ({ get: (k) => { try { return (BROWSER[k] && storage[BROWSER[k]]) || ''; } catch (e) { return ''; } } });

const PATHS = { systemone: { own: '/systemone', byok: '/api/v1/systemone', typesafe: '/v1/systemone', house: '?target=openrouter-systemone' },
                chat: { own: '/chat/completions', byok: '/api/v1/chat/completions', house: '?target=openrouter' } };

export function keyring(env, opts) {
  opts = opts || {};
  const doFetch = opts.fetch || ((u, o) => fetch(u, o)), secrets = [];
  const val = (k) => { const v = String(env.get(k) || '').trim(); if (v && secrets.indexOf(v) < 0) secrets.push(v); return v; };
  function lanes(purpose) {
    const out = [], P = PATHS[purpose]; if (!P) return out;
    const own = String(env.get('SYSROUTER_URL') || '').trim().replace(/\/+$/, '');
    if (own && P.own) { let u = null; try { u = new URL(own + P.own); } catch (e) {} if (u && (u.protocol === 'https:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname))) out.push({ lane: 'own', url: u.href, host: u.host, key: val('SYSROUTER_KEY') }); }
    const or = val('OPENROUTER_API_KEY');
    if (or && P.byok && (/^sk-or-/.test(or) || opts.anyKeyShape)) out.push({ lane: 'byok', url: 'https://openrouter.ai' + P.byok, host: 'openrouter.ai', key: or });   // the app accepts only sk-or- keys too (byoKey, next.html)
    const ts = val('TYPESAFE_API_KEY');
    if (ts && P.typesafe) out.push({ lane: 'typesafe', url: 'https://api.typesafe.ai' + P.typesafe, host: 'api.typesafe.ai', key: ts });
    if (opts.house && P.house && opts.origin) out.push({ lane: 'house', url: opts.origin + opts.house + P.house, host: new URL(opts.origin).host, key: '', device: opts.device || '' });
    return out;
  }
  // every known key value is cut out of any text that leaves this module
  const scrub = (s) => { s = String(s); for (const k of secrets) if (k.length >= 8) s = s.split(k).join('«key»'); return s; };
  const mask = (k) => !k ? '' : k.length < 12 ? '…' : k.slice(0, 6) + '…' + k.slice(-3);

  function sender(purpose) {
    const L = lanes(purpose)[0];
    if (!L) return null;
    const send = async (body, signal) => {
      const u = new URL(L.url);
      if (u.host !== L.host) throw new Error('keys: host mismatch');                       // the binding, checked at the moment of sending
      const headers = { 'content-type': 'application/json' };
      if (L.key) headers.authorization = 'Bearer ' + L.key;
      if (L.device) headers['x-pb-device'] = L.device;
      let r;
      try { r = await doFetch(u.href, { method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'error' }); }   // a redirect could carry the key to another host: refuse it
      catch (e) { throw new Error(scrub('keys: ' + L.lane + ' request failed: ' + (e && e.message || e))); }
      if (!r.ok) { let t = ''; try { t = (await r.text()).slice(0, 200); } catch (e) {} const err = new Error(scrub('keys: ' + L.lane + ' ' + r.status + ' ' + t)); err.status = r.status; throw err; }
      return r.json();
    };
    send.lane = L.lane; send.host = L.host;
    return send;
  }
  return { sender, scrub,
    describe: () => Object.keys(PATHS).map((p) => ({ purpose: p, lanes: lanes(p).map((l) => ({ lane: l.lane, host: l.host, key: mask(l.key) })) })) };
}
