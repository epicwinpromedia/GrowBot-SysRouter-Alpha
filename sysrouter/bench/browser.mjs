// browser.mjs — the shipped path measured in a real browser engine (R-PERF-2, R-TRUST-5).
//   node sysrouter/bench/browser.mjs
// Opens the demo page in headless Chromium (Playwright) and measures, inside the page:
//   • the on-device engines: the n-gram model, and MiniLM on the app's OWN ONNX Runtime Web
//     build (v1.19.2 from growbot.dev/ml, one thread, the settings next.html uses for Silero)
//   • the whole hear() call with both routes registered
//   • what isolating an extension in a Web Worker costs per decision (a postMessage round trip)
// Each is measured at full speed, and again with Chromium's CPU throttle at 4x and 6x.
// WHAT THIS IS NOT: a phone. Throttled desktop Chromium is the usual stand-in for a mid-range
// phone, and it is only a stand-in. R-PERF-1's on-phone numbers remain to be measured (GATHER A5).

import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { serve } from "../tools/serve.mjs";
import { ROOT, dataset } from "./lib.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const server = await serve(0), base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch(), page = await browser.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e.message))); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const lines = dataset("wake").filter((r) => r.split === "held").slice(0, 300).map((r) => r.text);

const t0 = Date.now();
await page.goto(base + "/sysrouter/demo/?embed=1&mode=shadow");
await page.waitForFunction(() => window.__sr, null, { timeout: 120000 });
const loadMs = Date.now() - t0, providers = await page.evaluate(() => window.__sr.providers);

async function measure(rate) {
  // each run appends its own run of spaces: the same words, but new strings, so the embedder's cache cannot answer for the network
  return page.evaluate(async (lines) => {
    const pc = (xs, p) => { const s = xs.slice().sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))] * 1000) / 1000; }, stat = (xs) => ({ p50: pc(xs, 50), p95: pc(xs, 95), p99: pc(xs, 99), n: xs.length });
    const { ngramProvider } = await import("../src/s1-ngram.js"), { FUZZY } = await import("../src/fuzzy.js");
    const out = {}, m = await (await fetch("../models/wake.ngram.json")).json(), ng = ngramProvider(m), Q = FUZZY.question;
    for (let i = 0; i < 50; i++) ng.ask({ state: lines[i], questions: { q: Q } });                       // warm-up
    // performance.now() is coarse in a page (0.1 ms). Time batches of 20 and divide.
    let xs = []; for (let i = 0; i + 20 <= lines.length; i += 20) { const t = performance.now(); for (let k = 0; k < 20; k++) ng.ask({ state: lines[i + k], questions: { q: Q } }); xs.push((performance.now() - t) / 20); }
    out.ngram_ms = stat(xs);
    // MiniLM asked directly: tokenise, run the network, apply the head. Each line is new text, so nothing is served from the cache.
    xs = []; for (const s of lines.slice(130, 230)) { const t = performance.now(); await window.__embed.ask({ state: s, questions: { q: Q } }); xs.push(performance.now() - t); }
    out.minilm_ms = stat(xs);
    xs = []; const sync = [];
    for (const s of lines.slice(0, 120)) { const t = performance.now(), o = window.__sr.sr.hear(s); sync.push(performance.now() - t); await o.done; xs.push(performance.now() - t); }
    out.hear_sync_part_ms = stat(sync); out.hear_until_all_engines_done_ms = stat(xs);
    // a Web Worker that answers at once: the pure cost of the message boundary
    const w = new Worker(URL.createObjectURL(new Blob(["onmessage = (e) => postMessage(e.data);"], { type: "text/javascript" })));
    const rt = () => new Promise((ok) => { const t = performance.now(); w.onmessage = () => ok(performance.now() - t); w.postMessage({ route: "wake", text: "stop following me", answer: { type: "choice", choice: "unfollow", probabilities: { unfollow: 0.97 } } }); });
    for (let i = 0; i < 20; i++) await rt(); xs = []; for (let i = 0; i < 300; i++) xs.push(await rt());
    out.worker_round_trip_ms = stat(xs); w.terminate();
    return out;
  }, lines.map((l) => l + " ".repeat(rate)));
}

const result = { made: new Date().toISOString().slice(0, 10), chromium: browser.version(), onnxruntime_web: "1.19.2 (growbot.dev/ml, numThreads 1)", page_ready_ms_including_23MB_model: loadMs, providers, runs: {} };
const cdp = await page.context().newCDPSession(page);
for (const rate of [1, 4, 6]) { await cdp.send("Emulation.setCPUThrottlingRate", { rate }); result.runs["cpu_" + rate + "x"] = await measure(rate); }
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
// model load on its own, cold, at each rate (a fresh page each time)
result.minilm_cold_load_ms = {};
for (const rate of [1, 4]) {
  const p = await browser.newPage(), c = await p.context().newCDPSession(p); await p.goto(base + "/sysrouter/demo/"); await p.waitForFunction(() => window.__sr); await c.send("Emulation.setCPUThrottlingRate", { rate });
  result.minilm_cold_load_ms["cpu_" + rate + "x"] = await p.evaluate(async () => { await new Promise((ok) => { const s = document.createElement("script"); s.src = "/ml/ort.min.js"; s.onload = ok; document.head.appendChild(s); });
    ort.env.wasm.numThreads = 1; ort.env.wasm.wasmPaths = "/ml/"; const t = performance.now(); await ort.InferenceSession.create("/ml/all-MiniLM-L6-v2.q.onnx"); return Math.round(performance.now() - t); });
  await p.close();
}
result.page_errors = errors;
await browser.close(); server.close();
writeFileSync(ROOT + "results/browser.json", JSON.stringify(result, null, 1) + "\n");
console.log(JSON.stringify(result, null, 1));
process.exit(errors.length ? 1 : 0);
