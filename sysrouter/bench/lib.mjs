// lib.mjs — shared pieces of the benchmark tools: the .env loader, the dataset loader, the
// provider factory (every arm in arms.json becomes the SAME provider object the app would
// register), and the small maths. Node only; nothing here ships to the browser.

import { readFileSync, existsSync } from "node:fs";
import { keyring, nodeEnv } from "../src/keys.js";
import { readersProvider, ftPick } from "../src/s1-readers.js";
import { httpProvider } from "../src/s1-http.js";
import { chatProvider } from "../src/s1-chat.js";
import { ngramProvider } from "../src/s1-ngram.js";
import { embedProvider, embedder } from "../src/s1-embed.js";
import { WAKE_ROUTE } from "../src/wakeword.js";
import { EXPRESS_ROUTE } from "../src/expressive.js";
import { loadReaders } from "./slice.mjs";

export const ROOT = new URL("..", import.meta.url).pathname;
export const ROUTES = { wake: WAKE_ROUTE, express: EXPRESS_ROUTE };
export const NONE = { wake: "none", express: "calm" };          // the option that triggers nothing

// One secrets convention (R-SEC-1): a `.env` at the repo root, never committed. Lines are
// NAME=value; quotes optional; # starts a comment. Real environment variables win.
export function loadEnv() {
  const env = {};
  for (const p of [ROOT + "../.env", ROOT + "../.env.local"]) if (existsSync(p)) for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line); if (m && !line.trim().startsWith("#")) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return Object.assign(env, process.env);
}

export const jsonl = (p) => existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
export const dataset = (route) => jsonl(ROOT + "data/v1/" + route + ".jsonl");
export const arms = () => JSON.parse(readFileSync(ROOT + "bench/arms.json", "utf8"));
export const model = (name) => { const p = ROOT + "models/" + name + ".json"; return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; };

let _embed = null;
export async function getEmbed() {   // the on-device embedding model, loaded once. The file is fetched by tools/get-models.mjs.
  if (_embed) return _embed;
  const dir = ROOT + "models/cache/";
  if (!existsSync(dir + "all-MiniLM-L6-v2.q.onnx")) throw new Error("missing model file: run  node sysrouter/tools/get-models.mjs");
  const ort = (await import("onnxruntime-node")).default;
  const session = await ort.InferenceSession.create(dir + "all-MiniLM-L6-v2.q.onnx", { intraOpNumThreads: 1 });   // one thread: a phone gives a page about that much
  return (_embed = embedder(ort, session, readFileSync(dir + "vocab.txt", "utf8")));
}

// arm name + route -> the provider object. Returns null when the arm cannot run here (no key, no model file).
export async function makeProvider(name, route) {
  const a = arms().arms[name]; if (!a) throw new Error("unknown arm " + name);
  if (a.kind === "readers") { const R = loadReaders(); return readersProvider((text) => route === "wake" ? ftPick(R._ftWords(text)) : ""); }
  if (a.kind === "ngram") { const m = model(route + ".ngram"); return m ? ngramProvider(m) : null; }
  if (a.kind === "embed") { const head = a.head ? model(route + ".minilm-head") : null; if (a.head && !head) return null; return embedProvider({ embed: await getEmbed(), head }); }
  const keys = keyring(nodeEnv(loadEnv())), send = keys.sender(a.kind === "http" ? "systemone" : "chat");
  if (!send) return null;
  const cfg = { model: a.model, send, usdPerMTok: a.usdPerMTok, extra: Object.assign({}, a.extra, a.provider ? { provider: Object.assign({ allow_fallbacks: false }, a.provider) } : null) };
  return a.kind === "http" ? httpProvider(cfg) : chatProvider(cfg);
}

export const pct = (xs, p) => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };
export const round = (x, n) => x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 10 ** (n || 0)) / 10 ** (n || 0);

// run fn over items with at most `n` in flight; keeps order
export async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { for (;;) { const k = i++; if (k >= items.length) return; out[k] = await fn(items[k], k); } }));
  return out;
}
