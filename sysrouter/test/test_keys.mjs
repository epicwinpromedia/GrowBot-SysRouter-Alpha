// test_keys.mjs — the key resolver's guarantees (R-SEC-2, R-SEC-3).
//   node sysrouter/test/test_keys.mjs
// The network is a fake that records every request it is asked to make. The keys are made up.

import { keyring, nodeEnv, browserEnv } from "../src/keys.js";
import { check, done } from "./t.mjs";

const OR = "sk-or-v1-0123456789abcdef0123456789abcdef", TS = "ts_live_abcdefghijklmnop", OWN = "own-proxy-shared-secret";   // made-up values. keyscan: ok
function net(reply) { const calls = []; const f = async (url, o) => { calls.push({ url, headers: o.headers, body: o.body, redirect: o.redirect }); return reply ? reply(url, o) : { ok: true, status: 200, json: async () => ({ answers: {} }) }; }; return { calls, f }; }

// resolution order and host binding
{
  const n = net(), k = keyring(nodeEnv({ OPENROUTER_API_KEY: OR, TYPESAFE_API_KEY: TS }), { fetch: n.f });
  const s = k.sender("systemone"); await s({ model: "x" });
  check("an OpenRouter key goes to openrouter.ai, as a Bearer header, and nowhere else", n.calls.length === 1 && n.calls[0].url === "https://openrouter.ai/api/v1/systemone" && n.calls[0].headers.authorization === "Bearer " + OR && s.lane === "byok" && s.host === "openrouter.ai");
  check("redirects are refused (a redirect could carry the key to another host)", n.calls[0].redirect === "error");
  await k.sender("chat")({});
  check("the chat purpose uses the same key on the same host", n.calls[1].url === "https://openrouter.ai/api/v1/chat/completions");
  check("the TypeSafe key was never sent while the OpenRouter lane was chosen", !JSON.stringify(n.calls).includes(TS));

  const n2 = net(), k2 = keyring(nodeEnv({ TYPESAFE_API_KEY: TS }), { fetch: n2.f });
  await k2.sender("systemone")({});
  check("with only a TypeSafe key: api.typesafe.ai", n2.calls[0].url === "https://api.typesafe.ai/v1/systemone" && n2.calls[0].headers.authorization === "Bearer " + TS);
  check("TypeSafe has no chat lane: no sender, no request", k2.sender("chat") === null);

  const n3 = net(), k3 = keyring(nodeEnv({ SYSROUTER_URL: "https://my-proxy.example.net/s1/", SYSROUTER_KEY: OWN, OPENROUTER_API_KEY: OR }), { fetch: n3.f });
  await k3.sender("systemone")({});
  check("your own server wins over every other lane, and receives only its own key", n3.calls[0].url === "https://my-proxy.example.net/s1/systemone" && n3.calls[0].headers.authorization === "Bearer " + OWN && !JSON.stringify(n3.calls).includes(OR));
  check("no key and no server: no sender", keyring(nodeEnv({})).sender("systemone") === null && keyring(nodeEnv({})).sender("nonsense") === null);
}

// what is refused
{
  const k = keyring(nodeEnv({ SYSROUTER_URL: "http://evil.example.com", SYSROUTER_KEY: OWN }));
  check("a plain-http server that is not this machine is refused", k.sender("systemone") === null);
  check("…localhost over http is allowed (a local proxy)", keyring(nodeEnv({ SYSROUTER_URL: "http://localhost:8787" })).sender("systemone").host === "localhost:8787");
  check("a value that is not an OpenRouter key is not sent to OpenRouter (the app's own rule, byoKey)", keyring(nodeEnv({ OPENROUTER_API_KEY: "sk-ant-not-an-openrouter-key" })).sender("systemone") === null);
  check("a URL that does not parse is refused", keyring(nodeEnv({ SYSROUTER_URL: "not a url" })).sender("systemone") === null);
}

// nothing leaks: describe(), errors, scrub()
{
  const n = net(async () => ({ ok: false, status: 401, text: async () => "bad key " + OR + " for account" }));
  const k = keyring(nodeEnv({ OPENROUTER_API_KEY: OR }), { fetch: n.f });
  let msg = "", status = 0; try { await k.sender("systemone")({}); } catch (e) { msg = e.message; status = e.status; }
  check("a vendor error that echoes the key is scrubbed before it is thrown", status === 401 && msg.includes("401") && !msg.includes(OR) && msg.includes("«key»"), msg);
  const n2 = net(async () => { throw new Error("connect failed to https://x/?k=" + OR); });
  msg = ""; try { await keyring(nodeEnv({ OPENROUTER_API_KEY: OR }), { fetch: n2.f }).sender("systemone")({}); } catch (e) { msg = e.message; }
  check("a network error that echoes the key is scrubbed too", msg.length > 0 && !msg.includes(OR), msg);
  const d = JSON.stringify(k.describe());
  check("describe() shows first 6 and last 3 characters only", !d.includes(OR) && d.includes("sk-or-…def"), d);
  check("scrub() removes a known key from any text", k.scrub("x " + OR + " y") === "x «key» y");
  const s = k.sender("systemone");
  check("a sender carries its lane and host, and no key", !JSON.stringify(Object.assign({}, s)).includes(OR) && !String(s).includes(OR));
}

// the browser reads the same names from the app's existing localStorage keys
{
  const n = net(), store = { pb_byok: OR, pb_s1_url: "" };
  await keyring(browserEnv(store), { fetch: n.f }).sender("systemone")({});
  check("browser: pb_byok (the key the brain lane already uses) reaches OpenRouter", n.calls[0].url === "https://openrouter.ai/api/v1/systemone");
  const n2 = net(), k2 = keyring(browserEnv({ pb_s1_url: "https://home.example.org" }), { fetch: n2.f });
  await k2.sender("systemone")({});
  check("browser: pb_s1_url is the no-key-in-the-page lane", n2.calls[0].url === "https://home.example.org/systemone" && !n2.calls[0].headers.authorization);
  const n3 = net(), k3 = keyring(browserEnv({}), { fetch: n3.f, house: "/api/llm", origin: "https://growbot.dev", device: "dev-123" });
  await k3.sender("systemone")({});
  check("browser: the house lane goes to the page's own origin with the device token, when the server offers it", n3.calls[0].url === "https://growbot.dev/api/llm?target=openrouter-systemone" && n3.calls[0].headers["x-pb-device"] === "dev-123" && !n3.calls[0].headers.authorization);
  check("a storage that throws is treated as empty", keyring(browserEnv(new Proxy({}, { get() { throw new Error("denied"); } }))).sender("systemone") === null);
}
done("key resolver");
