// collect.mjs — asks every arm the route's question for every dataset row and keeps the raw
// answer (GATHER W1). Nothing is scored here: report.mjs reads these files, so a number in
// the report can always be traced back to the reply that produced it.
//   node sysrouter/bench/collect.mjs wake jev            one arm
//   node sysrouter/bench/collect.mjs express             every arm that can run here
//   node sysrouter/bench/collect.mjs wake jev --shuffle  option-order stability pass (R-EVAL-3)
//   node sysrouter/bench/collect.mjs wake jev --latency  120 calls, one at a time, for clean latency
// Resumable: rows already in the output file are skipped. Hosted arms need a key (.env.example).

import { appendFileSync, mkdirSync } from "node:fs";
import { ROOT, ROUTES, arms, dataset, jsonl, makeProvider, pool } from "./lib.mjs";

const [route, only, ...flags] = process.argv.slice(2).filter((a) => !a.startsWith("--")).concat(process.argv.filter((a) => a.startsWith("--")));
const shuffle = flags.includes("--shuffle"), latency = flags.includes("--latency");
if (!ROUTES[route]) { console.error("usage: collect.mjs <wake|express> [arm] [--shuffle|--latency]"); process.exit(2); }
mkdirSync(ROOT + "results/raw", { recursive: true });

// a fixed permutation of the option order, different per pass, the same on every run
function permuted(q, pass) {
  const keys = Object.keys(q.criteria), out = {};
  let s = 1234567 + pass * 7919; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; }
  for (const k of keys) out[k] = q.criteria[k];
  return Object.assign({}, q, { criteria: out });
}

async function ask(p, q, text) {
  const t0 = performance.now(), ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await p.ask({ state: text, questions: { q } }, { signal: ctl.signal }), a = r.answers.q, ms = performance.now() - t0;
    if (a.abstain) return { abstain: 1, ms };
    return { pick: a.choice, pr: Object.fromEntries(Object.entries(a.probabilities).map(([k, v]) => [k, Math.round(v * 1e4) / 1e4])), ms, tok: r.usage && r.usage.input_tokens, usd: r.usd, m: r.model, lp: r.logprobs === false ? 0 : undefined };
  } catch (e) { return { err: String(e && e.message || e).slice(0, 120), ms: performance.now() - t0 }; }
  finally { clearTimeout(timer); }
}

const A = arms().arms, rows = dataset(route);
for (const name of only ? [only] : Object.keys(A)) {
  const p = await makeProvider(name, route);
  if (!p) { console.log(name.padEnd(18) + " skipped (no key or no model file)"); continue; }
  const hosted = A[name].kind === "http" || A[name].kind === "chat", q = ROUTES[route].question;
  const file = ROOT + "results/raw/" + route + "." + name + (shuffle ? ".shuffle" : latency ? ".latency" : "") + ".jsonl";
  const done = new Set(jsonl(file).filter((r) => !r.err).map((r) => r.id + "|" + (r.pass || 0)));
  let todo = rows.map((r) => ({ r, pass: 0 }));
  if (shuffle) todo = rows.filter((r) => r.split === "held" && (r.kind === "authored" || r.kind === "trap")).slice(0, 150).flatMap((r) => [1, 2, 3].map((pass) => ({ r, pass })));
  if (latency) todo = rows.filter((r) => r.split === "held").slice(0, 120).map((r) => ({ r, pass: 0 }));
  todo = todo.filter((x) => !done.has(x.r.id + "|" + x.pass));
  let n = 0, errs = 0; const t0 = Date.now();
  await pool(todo, hosted && !latency ? 6 : 1, async ({ r, pass }) => {
    let res = await ask(p, pass ? permuted(q, pass) : q, r.text);
    if (res.err && hosted) res = await ask(p, pass ? permuted(q, pass) : q, r.text);          // one retry; a second failure is recorded as a failure (reliability, R-EVAL-3)
    if (res.err) errs++;
    appendFileSync(file, JSON.stringify(Object.assign({ id: r.id, pass: pass || undefined }, res, { ms: Math.round(res.ms * 100) / 100 })) + "\n");
    if (++n % 400 === 0) console.log("  " + name + " " + n + "/" + todo.length);
  });
  console.log(name.padEnd(18) + " " + n + " asked, " + errs + " failed, " + ((Date.now() - t0) / 1000).toFixed(1) + " s -> " + file.replace(ROOT, "sysrouter/"));
}
