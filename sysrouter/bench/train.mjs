// train.mjs — fits the two trained on-device arms on the TUNING split only (GATHER W3):
//   <route>.ngram        linear model over hashed n-grams      (src/s1-ngram.js runs it)
//   <route>.minilm-head  one linear layer over MiniLM vectors  (src/s1-embed.js runs it)
//   node sysrouter/bench/train.mjs wake        node sysrouter/bench/train.mjs express
// Writes models/<route>.<arm>.json and results/raw/<route>.<arm>.oof.jsonl.
//
// The .oof file is the honest part. A model scores its own training rows too confidently,
// so a gate fitted on those scores would be too loose. Each tuning row is therefore scored
// by a model that never saw it (5 folds, split by the ORIGINAL line so a line and its
// transcribed variants stay together), and report.mjs fits the gate on those scores.
// Deterministic: fixed seed, fixed order.

import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { ROOT, ROUTES, dataset, getEmbed } from "./lib.mjs";
import { features } from "../src/s1-ngram.js";

const route = process.argv[2];
if (!ROUTES[route]) { console.error("usage: train.mjs <wake|express>"); process.exit(2); }
const classes = Object.keys(ROUTES[route].question.criteria), C = classes.length, DIM = 16384, FOLDS = 5;
// GoEmotions rows are Reddit comments, a transfer check, not training data: the on-device models learn from in-domain lines only
const tune = dataset(route).filter((r) => r.split === "tune" && r.kind !== "goemotions");
const foldOf = (r) => parseInt(createHash("sha1").update("fold:" + (r.of || r.text)).digest("hex").slice(0, 8), 16) % FOLDS;

// multinomial logistic regression, plain SGD, class-balanced, L2. x: { idx, val } sparse rows.
function fit(X, y, dim, epochs, lr, l2) {
  const W = Array.from({ length: C }, () => new Float32Array(dim)), b = new Float32Array(C), n = new Array(C).fill(0);
  for (const c of y) n[c]++;
  const wt = n.map((k) => k ? X.length / (C * k) : 0);
  let seed = 12345; const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const order = X.map((_, i) => i);
  for (let ep = 0; ep < epochs; ep++) {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const step = lr / (1 + ep * 0.15);
    for (const i of order) {
      const x = X[i], p = logits(W, b, x); softmax(p);
      for (let c = 0; c < C; c++) {
        const g = (p[c] - (y[i] === c ? 1 : 0)) * wt[y[i]], w = W[c];
        for (let k = 0; k < x.idx.length; k++) { const j = x.idx[k]; w[j] -= step * (g * x.val[k] + l2 * w[j]); }
        b[c] -= step * g;
      }
    }
  }
  return { W, b };
}
function logits(W, b, x) { const z = new Array(C); for (let c = 0; c < C; c++) { let s = b[c]; const w = W[c]; for (let k = 0; k < x.idx.length; k++) s += w[x.idx[k]] * x.val[k]; z[c] = s; } return z; }
function softmax(z) { const m = Math.max(...z); let s = 0; for (let c = 0; c < C; c++) { z[c] = Math.exp(z[c] - m); s += z[c]; } for (let c = 0; c < C; c++) z[c] /= s; return z; }
// the temperature that minimises log loss of the out-of-fold logits
function temperature(Z, y) { let best = 1, bl = Infinity; for (let t = 0.05; t <= 5; t *= 1.08) { let l = 0; for (let i = 0; i < Z.length; i++) l -= Math.log(softmax(Z[i].map((v) => v / t))[y[i]] + 1e-12); if (l < bl) { bl = l; best = t; } } return Math.round(best * 1000) / 1000; }

async function run(arm, X, dim, hp, pack) {
  const y = tune.map((r) => classes.indexOf(r.label)), fold = tune.map(foldOf), Z = new Array(tune.length);
  for (let f = 0; f < FOLDS; f++) {
    const tr = tune.map((_, i) => i).filter((i) => fold[i] !== f), m = fit(tr.map((i) => X[i]), tr.map((i) => y[i]), dim, hp.epochs, hp.lr, hp.l2);
    tune.forEach((_, i) => { if (fold[i] === f) Z[i] = logits(m.W, m.b, X[i]); });
  }
  const temp = temperature(Z, y), m = fit(X, y, dim, hp.epochs, hp.lr, hp.l2);
  let hit = 0;
  const oof = tune.map((r, i) => { const p = softmax(Z[i].map((v) => v / temp)), k = p.indexOf(Math.max(...p)); if (k === y[i]) hit++;
    return JSON.stringify({ id: r.id, pick: classes[k], pr: Object.fromEntries(classes.map((c, j) => [c, Math.round(p[j] * 1e4) / 1e4])), ms: 0 }); });
  mkdirSync(ROOT + "models", { recursive: true }); mkdirSync(ROOT + "results/raw", { recursive: true });
  writeFileSync(ROOT + "results/raw/" + route + "." + arm + ".oof.jsonl", oof.join("\n") + "\n");
  const file = ROOT + "models/" + route + "." + (arm === "ngram" ? "ngram" : "minilm-head") + ".json", json = JSON.stringify(pack(m, temp));
  writeFileSync(file, json + "\n");
  console.log(arm.padEnd(12) + " rows " + tune.length + "  out-of-fold accuracy " + (hit / tune.length).toFixed(3) + "  temp " + temp + "  " + (json.length / 1024).toFixed(0) + " kB");
}

const stamp = { route, classes, trained_on: "data/v1 tuning split, " + tune.length + " rows", trained: new Date().toISOString().slice(0, 10) };

// 1. hashed n-grams. Weights go to int8 with one scale per class.
await run("ngram", tune.map((r) => features(r.text, DIM)), DIM, { epochs: 30, lr: 0.6, l2: 2e-5 }, (m, temp) => {
  const bytes = new Int8Array(C * DIM), scale = [];
  for (let c = 0; c < C; c++) { let mx = 0; for (const v of m.W[c]) mx = Math.max(mx, Math.abs(v)); const s = (mx || 1) / 127; scale.push(s); for (let j = 0; j < DIM; j++) bytes[c * DIM + j] = Math.round(m.W[c][j] / s); }
  return Object.assign({ id: route + ".ngram-v1", dim: DIM, temp, b: Array.from(m.b, (v) => Math.round(v * 1e5) / 1e5), scale, w: Buffer.from(bytes.buffer).toString("base64") }, stamp);
});

// 2. a linear head on sentence embeddings (dense 384-wide rows)
const embed = await getEmbed(), E = [];
for (const r of tune) { const v = await embed(r.text); E.push({ idx: Array.from(v.keys()), val: Array.from(v) }); }
await run("minilm-head", E, 384, { epochs: 60, lr: 1.0, l2: 1e-5 }, (m, temp) =>
  Object.assign({ id: route + ".minilm-head-v1", base: "all-MiniLM-L6-v2 (quantized ONNX)", temp, b: Array.from(m.b, (v) => Math.round(v * 1e5) / 1e5), W: m.W.map((w) => Array.from(w, (v) => Math.round(v * 1e4) / 1e4)) }, stamp));
