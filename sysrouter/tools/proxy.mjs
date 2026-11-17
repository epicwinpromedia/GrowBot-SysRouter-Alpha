// proxy.mjs — your keys stay on your own machine (R-SEC-5), and a live shadow tap (GATHER W6).
//   node sysrouter/tools/proxy.mjs [port]            default 8787
// Reads keys from the repo's .env (see env.example at the repo root). The app page is given only this
// server's address, never a key:
//   System One:  localStorage.pb_s1_url  = "http://localhost:8787"       (src/keys.js, lane "own")
//   the brain:   the app's existing local-server door, pb_llm_url = "http://localhost:8787"
//                (llmCfg, next.html: any OpenAI-style /chat/completions)
// A page served over https can reach http://localhost on the same device. From a phone, put
// this behind an https tunnel, as the app's local-server door already requires.
//
//   POST /systemone          -> the decision engine, with your key added here
//   POST /chat/completions   -> the chat model, with your key added here. With SHADOW=1 it
//                               also asks the System One routes about the person's last line
//                               and appends what they decided to shadow.jsonl. The reply the
//                               app gets is the real model's, untouched: nothing is acted on.
// It forwards to ONE upstream host, fixed at start from the key it found. Request bodies are
// never written to disk; shadow.jsonl holds a hash of the words, never the words.
// Zero dependencies.

import { createServer } from "node:http";
import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { keyring, nodeEnv } from "../src/keys.js";
import { loadEnv, ROUTES, ROOT } from "../bench/lib.mjs";

const env = loadEnv(), keys = keyring(nodeEnv(Object.assign({}, env, { SYSROUTER_URL: "" })));       // never forward to ourselves
const s1 = keys.sender("systemone"), chat = keys.sender("chat"), PORT = +process.argv[2] || +env.SYSROUTER_PROXY_PORT || 8787;
const ALLOW = (env.SYSROUTER_ALLOW_ORIGIN || "https://growbot.dev,http://localhost:8765,http://127.0.0.1:8765").split(",").map((s) => s.trim());
const SHADOW = env.SHADOW === "1", SHADOW_MODEL = env.SHADOW_MODEL || "cloudflare/clef-flash", SECRET = env.SYSROUTER_KEY || "";

const read = (req) => new Promise((ok, no) => { let n = 0; const parts = []; req.on("data", (c) => { n += c.length; if (n > 2e6) { no(new Error("too large")); req.destroy(); } else parts.push(c); }); req.on("end", () => { try { ok(JSON.parse(Buffer.concat(parts).toString("utf8"))); } catch (e) { no(new Error("bad json")); } }); req.on("error", no); });
const lastUserLine = (body) => { const m = (body.messages || []).filter((x) => x.role === "user").pop(); const c = m && (typeof m.content === "string" ? m.content : (m.content || []).map((p) => p.text || "").join(" ")); return String(c || "").slice(-600); };

async function shadow(text) {
  for (const id in ROUTES) { const t0 = Date.now(); let row = { t: t0, r: id, m: SHADOW_MODEL, h: createHash("sha1").update(text).digest("hex").slice(0, 10) };
    try { const r = await s1({ model: SHADOW_MODEL, state: text, questions: { q: ROUTES[id].question } }), a = r.answers.q; row = Object.assign(row, { a: a.choice, pr: a.probabilities && a.probabilities[a.choice], ms: Date.now() - t0 }); }
    catch (e) { row.err = keys.scrub(e.message).slice(0, 80); }
    appendFileSync(ROOT + "results/shadow.jsonl", JSON.stringify(row) + "\n"); }
}

createServer(async (req, res) => {
  const origin = req.headers.origin || "", cors = ALLOW.includes(origin) ? { "access-control-allow-origin": origin, "access-control-allow-headers": "content-type, authorization", "access-control-allow-methods": "POST, OPTIONS", vary: "origin" } : {};
  const end = (code, obj) => res.writeHead(code, Object.assign({ "content-type": "application/json" }, cors)).end(JSON.stringify(obj));
  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
  if (origin && !ALLOW.includes(origin)) return end(403, { error: "origin not allowed" });            // a page from anywhere else cannot spend your key
  if (SECRET && req.headers.authorization !== "Bearer " + SECRET) return end(401, { error: "unauthorized" });
  const path = new URL(req.url, "http://x").pathname.replace(/\/+$/, ""), send = path.endsWith("/systemone") ? s1 : path.endsWith("/chat/completions") ? chat : null;
  if (req.method !== "POST" || !send) return end(404, { error: "POST /systemone or /chat/completions" });
  try {
    const body = await read(req);
    if (body.stream) return end(400, { error: "streaming is not proxied: set ?stream=0 in the app" });
    if (SHADOW && send === chat && s1) shadow(lastUserLine(body)).catch(() => {});                    // beside the real call, never in front of it
    end(200, await send(body));
  } catch (e) { end(e.status || 502, { error: keys.scrub(e.message).slice(0, 300) }); }
}).listen(PORT, "127.0.0.1", () => {
  console.log("sysrouter proxy on http://localhost:" + PORT + "  upstream: " + (s1 ? s1.host + " (" + s1.lane + ")" : "NONE: put a key in .env") + (SHADOW ? "  shadow: " + SHADOW_MODEL + " -> sysrouter/results/shadow.jsonl" : ""));
  console.log("allowed page origins: " + ALLOW.join(", ") + (SECRET ? "  (bearer secret required)" : ""));
});
