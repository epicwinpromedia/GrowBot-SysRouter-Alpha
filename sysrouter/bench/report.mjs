// report.mjs — turns the raw answers into the numbers (R-EVAL-3). Reads results/raw/, writes
// results/results.json, results/TABLES.md and models/gates.json. No network, no randomness:
// the same raw files give the same report.
//   node sysrouter/bench/report.mjs
//
// How each number is made:
//   GATE       per (route, arm): the lowest probability at which the arm may act such that, on
//              the TUNING split, its bad acts (acting where nothing was asked, or with the
//              wrong action) are at most TARGET of all tuning lines. Trained on-device arms
//              are gated on out-of-fold scores (train.mjs).
//   HELD-OUT   every reported accuracy number is from lines the gate and the models never saw.
//   recall     of the lines that ARE a command (or a feeling), the share where the arm acted and picked the right one
//   wrong      the share of those where it acted and picked a different one
//   false trigger  of the lines that should trigger nothing, the share where it acted at all
//   HYBRIDS    are not simulated by formula: the recorded answers are replayed through the
//              real router (src/sysrouter.js) with the fitted gates, and what it ran is counted.

import { writeFileSync, existsSync, readdirSync } from "node:fs";
import { ROOT, ROUTES, NONE, arms, dataset, jsonl, pct, round } from "./lib.mjs";
import { createRouter } from "../src/sysrouter.js";

const TARGET = { wake: 0.005, express: 0.02 };      // bad acts allowed when fitting a gate: this share of all tuning lines
const MISS = 0.02;                                   // real asks a confident "nothing" may dismiss when fitting pn: this share of tuning lines that ask
const A = arms(), out = { made: new Date().toISOString().slice(0, 10), target_bad_acts_on_tuning: TARGET, target_dismissed_asks_on_tuning: MISS, routes: {} }, gates = {};
const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

function load(route, arm) {
  const f = ROOT + "results/raw/" + route + "." + arm + ".jsonl"; if (!existsSync(f)) return null;
  const all = jsonl(f), by = new Map(); let failed = 0;
  for (const r of all) { if (r.err) { failed++; if (!by.has(r.id)) by.set(r.id, r); } else by.set(r.id, r); }
  const oof = new Map(jsonl(ROOT + "results/raw/" + route + "." + arm + ".oof.jsonl").map((r) => [r.id, r]));
  return { by, oof, asked: all.length, failed };
}
const topP = (a) => a && a.pr && a.pick ? a.pr[a.pick] : 0;

// p:  the lowest gate at which the arm's BAD ACTS on the tuning split (acting where nothing was asked, or acting with the
//     wrong action) stay within target x all tuning lines. 1.01 = this arm may never act.
// pn: how sure a "nothing was asked" must be before a cascade stops on it: the lowest value at which the arm confidently
//     dismisses at most MISS of the tuning lines that DID ask for something.
function fitGate(rows, ans, none, target, exact) {
  if (exact) return { p: 0, pn: 0 };
  const bad = rows.map((r) => [r, ans(r)]).filter(([r, a]) => a && a.pick && a.pick !== none && a.pick !== r.label).map(([, a]) => topP(a)).sort((x, y) => y - x);
  const cut = (xs, allowed) => xs.length <= allowed ? 0.5001 : xs[allowed] >= 1 ? 1.01 : Math.min(1.01, Math.round((xs[allowed] + 1e-4) * 1e4) / 1e4);
  const pos = rows.filter((r) => r.label !== none), miss = pos.map((r) => ans(r)).filter((a) => a && a.pick === none).map(topP).sort((x, y) => y - x);
  return { p: cut(bad, Math.floor(target * rows.length)), pn: cut(miss, Math.floor(MISS * pos.length)) };
}

function score(rows, ans, none, gate) {
  const pos = rows.filter((r) => r.label !== none), neg = rows.filter((r) => r.label === none);
  const acts = (r) => { const a = ans(r); return a && a.pick && a.pick !== none && !a.abstain && topP(a) >= gate ? a.pick : ""; };
  let hit = 0, wrong = 0, ft = 0;
  for (const r of pos) { const k = acts(r); if (k === r.label) hit++; else if (k) wrong++; }
  for (const r of neg) if (acts(r)) ft++;
  return { n_should_act: pos.length, n_should_not: neg.length, recall: pos.length ? hit / pos.length : null, wrong: pos.length ? wrong / pos.length : null,
    false_trigger: neg.length ? ft / neg.length : null, precision: hit + wrong + ft ? hit / (hit + wrong + ft) : null, acted: hit + wrong + ft };
}
// expected calibration error of the top probability, 10 bins, ungated
function ece(rows, ans) {
  const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, ok: 0 })); let n = 0;
  for (const r of rows) { const a = ans(r); if (!a || !a.pick) continue; const p = topP(a), b = bins[Math.min(9, Math.floor(p * 10))]; b.n++; b.p += p; b.ok += a.pick === r.label ? 1 : 0; n++; }
  return n ? bins.reduce((s, b) => s + (b.n ? Math.abs(b.ok / b.n - b.p / b.n) * b.n / n : 0), 0) : null;
}
const fmt = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" && !Number.isInteger(v) ? round(v, 4) : v]));

for (const route in ROUTES) {
  const rows = dataset(route), none = NONE[route], R = out.routes[route] = { rows: rows.length, arms: {}, hybrids: {} };
  const inDomain = (r) => r.kind !== "goemotions", tune = rows.filter((r) => r.split === "tune" && inDomain(r)), held = rows.filter((r) => r.split === "held");
  const kinds = [...new Set(held.map((r) => r.kind))].sort(), loaded = {};
  gates[route] = {};
  for (const arm in A.arms) {
    const L = load(route, arm); if (!L) continue; loaded[arm] = L;
    const exact = A.arms[arm].kind === "readers", heldAns = (r) => L.by.get(r.id), tuneAns = (r) => L.oof.get(r.id) || L.by.get(r.id);
    const got = held.filter((r) => { const a = heldAns(r); return a && !a.err; });
    if (got.length < held.length * 0.5) { R.arms[arm] = { incomplete: got.length + "/" + held.length }; continue; }
    const G = fitGate(tune, tuneAns, none, TARGET[route], exact), gate = G.p, ok = [...L.by.values()].filter((r) => !r.err);
    const lat = jsonl(ROOT + "results/raw/" + route + "." + arm + ".latency.jsonl").filter((r) => !r.err).map((r) => r.ms), ms = lat.length >= 50 ? lat : ok.map((r) => r.ms);
    const sh = jsonl(ROOT + "results/raw/" + route + "." + arm + ".shuffle.jsonl").filter((r) => !r.err), shBy = {};
    for (const r of sh) (shBy[r.id] = shBy[r.id] || []).push(r.pick);
    const stable = Object.entries(shBy).filter(([id, p]) => p.length === 3 && L.by.get(id) && !L.by.get(id).err);
    const heldIn = held.filter(inDomain);
    R.arms[arm] = {
      kind: A.arms[arm].kind, model: (ok.find((r) => r.m) || {}).m || undefined, gate: gate > 1 ? "never" : gate, gate_nothing: G.pn > 1 ? "never" : G.pn,
      held: fmt(score(heldIn, heldAns, none, gate)), ungated_accuracy: round(mean(heldIn.map((r) => { const a = heldAns(r); return a && !a.abstain && a.pick === r.label ? 1 : 0; })), 4),
      by_kind: Object.fromEntries(kinds.map((k) => [k, fmt(score(held.filter((r) => r.kind === k), heldAns, none, gate))])),
      by_label: Object.fromEntries([...new Set(heldIn.map((r) => r.label))].filter((l) => l !== none).sort().map((l) => { const s = score(heldIn.filter((r) => r.label === l || r.label === none), heldAns, none, gate); return [l, round(s.recall, 4)]; })),
      ece: exact ? null : round(ece(heldIn, heldAns), 4),
      latency_ms: { p50: round(pct(ms, 50), 2), p95: round(pct(ms, 95), 2), p99: round(pct(ms, 99), 2), n: ms.length, measured: lat.length >= 50 ? "one call at a time" : "6 calls in flight" },
      usd_per_1000: ok.some((r) => r.usd > 0) ? round(mean(ok.filter((r) => r.usd >= 0).map((r) => r.usd)) * 1000, 5) : 0,
      tokens_per_call: ok.some((r) => r.tok) ? Math.round(mean(ok.filter((r) => r.tok).map((r) => r.tok))) : 0,
      failed: L.failed, asked: L.asked,
      order_stable: stable.length ? round(mean(stable.map(([id, p]) => p.every((x) => x === L.by.get(id).pick) ? 1 : 0)), 4) : null, order_n: stable.length,
      probabilities: ok.some((r) => r.lp === 0) ? "not returned by this host (p = 1)" : undefined
    };
    if (!exact && gate <= 1) gates[route][arm] = { p: gate, pn: Math.min(1, G.pn) };
  }

  // hybrids: replay the recorded answers through the real router
  for (const name in A.hybrids) {
    const chain = A.hybrids[name]; if (!chain.every((a) => loaded[a] && !R.arms[a].incomplete)) continue;
    const ran = [], sr = createRouter({}), q = ROUTES[route].question; let cur = null, asked = {};
    for (const k of Object.keys(ROUTES[route].on)) sr.action(ROUTES[route].on[k], { run: () => ran.push(k), reserved: false });
    for (const a of chain) sr.provider(a.replace(/[^a-z0-9.-]/g, "-"), { sync: true, exact: A.arms[a].kind === "readers", model: a, ask: () => { asked[a] = (asked[a] || 0) + 1; cur.path.push(a); const x = loaded[a].by.get(cur.id);
      if (!x || x.err) throw new Error("no answer"); if (x.abstain) return { answers: { q: { abstain: true } } }; return { model: a, answers: { q: { type: "choice", choice: x.pick, probabilities: x.pr } } }; } });
    sr.route({ id: "h", question: q, notFor: ROUTES[route].notFor, on: ROUTES[route].on, providers: chain.map((a) => a.replace(/[^a-z0-9.-]/g, "-")), policy: "cascade", mode: "parallel" });
    sr.calibrate({ h: Object.fromEntries(chain.filter((a) => gates[route][a]).map((a) => [a.replace(/[^a-z0-9.-]/g, "-") + "@" + a, gates[route][a]])) });
    const picks = new Map(), paths = new Map();
    for (const r of held.filter(inDomain)) { cur = { id: r.id, path: [] }; ran.length = 0; sr.hear(r.text); picks.set(r.id, ran[0] || ""); paths.set(r.id, cur.path); }
    const heldIn = held.filter(inDomain), ans = (r) => picks.get(r.id) ? { pick: picks.get(r.id), pr: { [picks.get(r.id)]: 1 } } : { pick: none, pr: { [none]: 1 } };
    const last = chain[chain.length - 1], hosted = A.arms[last].kind === "http" || A.arms[last].kind === "chat";
    const lat = heldIn.map((r) => paths.get(r.id).reduce((s, a) => s + ((loaded[a].by.get(r.id) || {}).ms || 0), 0)), usd = heldIn.map((r) => paths.get(r.id).reduce((s, a) => s + ((loaded[a].by.get(r.id) || {}).usd || 0), 0));
    R.hybrids[name] = { held: fmt(score(heldIn, ans, none, 0)), by_kind: Object.fromEntries(kinds.filter((k) => k !== "goemotions").map((k) => [k, fmt(score(held.filter((r) => r.kind === k), ans, none, 0))])),
      reached_last_engine: round(mean(heldIn.map((r) => paths.get(r.id).includes(last) ? 1 : 0)), 4), last_engine_is_hosted: hosted,
      latency_ms: { p50: round(pct(lat, 50), 2), p95: round(pct(lat, 95), 2), p99: round(pct(lat, 99), 2), note: "sum of the recorded times of the engines actually asked for that line" },
      usd_per_1000: round(mean(usd) * 1000, 5) };
  }
}

// ---- write: results.json, the gates the app loads, and the tables ----
writeFileSync(ROOT + "results/results.json", JSON.stringify(out, null, 1) + "\n");
// gates.json is keyed by v2 route id and "<engine id>@<model id>" (with @<host> for non-default hosts)
const V2_ROUTE = { wake: "fuzzy", express: "emote" };
const boot = {};
for (const route in gates) {
  const v2 = V2_ROUTE[route] || route;
  boot[v2] = {};
  for (const arm in gates[route]) {
    const m = out.routes[route].arms[arm].model;
    if (arm === "ngram" && m) boot[v2]["ngram-" + v2 + "@" + m] = gates[route][arm];
    else if ((arm === "minilm-head" || arm === "minilm-zeroshot") && m) boot[v2]["embed-" + v2 + "@" + m] = gates[route][arm];
    else if (A.arms[arm].kind === "http" && m) {
      const at = arm.indexOf("@");
      const key = at > 0 ? "hosted@" + m + "@" + arm.slice(at + 1) : "hosted@" + m;
      boot[v2][key] = Object.assign({ arm }, gates[route][arm]);
    }
  }
}
writeFileSync(ROOT + "models/gates.json", JSON.stringify(boot, null, 1) + "\n");

const pc = (x) => x === null || x === undefined ? "–" : (x * 100).toFixed(1) + "%", num = (x, d) => x === null || x === undefined ? "–" : x.toFixed(d === undefined ? 0 : d);
let md = "<!-- generated by bench/report.mjs on " + out.made + ". Do not edit: re-run the report. -->\n";
for (const route in out.routes) {
  const R = out.routes[route], none = NONE[route];
  md += "\n## Route `" + route + "` — held-out, in-domain lines\n\nGate fitted on the tuning split so that bad acts (a false trigger or a wrong action) stay within " + pc(TARGET[route]) + " of all tuning lines. The option that triggers nothing: `" + none + "`. \"Ungated\" is plain accuracy with no gate, for reference.\n\n";
  md += "| Arm | Ungated | Gate | Recall | Wrong action | False trigger | Precision | ECE | p50 ms | p95 ms | p99 ms | $ / 1,000 | Failed | Order-stable |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n";
  for (const arm in R.arms) { const a = R.arms[arm]; if (a.incomplete) { md += "| " + arm + " | incomplete " + a.incomplete + " |\n"; continue; }
    md += "| " + arm + " | " + pc(a.ungated_accuracy) + " | " + (a.gate === 0 ? "exact" : a.gate) + " | " + pc(a.held.recall) + " | " + pc(a.held.wrong) + " | " + pc(a.held.false_trigger) + " | " + pc(a.held.precision) + " | " + (a.ece === null ? "–" : a.ece.toFixed(3)) + " | " + num(a.latency_ms.p50, a.latency_ms.p50 < 10 ? 3 : 0) + " | " + num(a.latency_ms.p95, a.latency_ms.p95 < 10 ? 3 : 0) + " | " + num(a.latency_ms.p99, a.latency_ms.p99 < 10 ? 3 : 0) + " | " + (a.usd_per_1000 ? "$" + a.usd_per_1000.toFixed(4) : "$0") + " | " + a.failed + "/" + a.asked + " | " + (a.order_stable === null ? "–" : pc(a.order_stable)) + " |\n"; }
  if (Object.keys(R.hybrids).length) { md += "\n**Cascades, replayed through the real router**\n\n| Cascade | Recall | Wrong action | False trigger | Precision | Lines reaching the last engine | p50 ms | p95 ms | $ / 1,000 |\n|---|---|---|---|---|---|---|---|---|\n";
    for (const h in R.hybrids) { const a = R.hybrids[h]; md += "| " + h.replace(/>/g, " → ") + " | " + pc(a.held.recall) + " | " + pc(a.held.wrong) + " | " + pc(a.held.false_trigger) + " | " + pc(a.held.precision) + " | " + pc(a.reached_last_engine) + " | " + num(a.latency_ms.p50, a.latency_ms.p50 < 10 ? 3 : 0) + " | " + num(a.latency_ms.p95, a.latency_ms.p95 < 10 ? 3 : 0) + " | $" + a.usd_per_1000.toFixed(4) + " |\n"; } }
  const kinds = [...new Set(Object.values(R.arms).flatMap((a) => Object.keys(a.by_kind || {})))].sort();
  md += "\n**By kind of line** (recall where the kind has lines that should act, false trigger where it has lines that should not)\n\n| Arm | " + kinds.join(" | ") + " |\n|---|" + kinds.map(() => "---").join("|") + "|\n";
  const cell = (s) => !s ? "–" : (s.n_should_act ? "R " + pc(s.recall) : "") + (s.n_should_act && s.n_should_not ? " · " : "") + (s.n_should_not ? "FT " + pc(s.false_trigger) : "");
  for (const arm in R.arms) if (!R.arms[arm].incomplete) md += "| " + arm + " | " + kinds.map((k) => cell(R.arms[arm].by_kind[k])).join(" | ") + " |\n";
  for (const h in R.hybrids) md += "| " + h.replace(/>/g, " → ") + " | " + kinds.map((k) => cell(R.hybrids[h].by_kind[k])).join(" | ") + " |\n";
  const labels = [...new Set(Object.values(R.arms).flatMap((a) => Object.keys(a.by_label || {})))].sort();
  md += "\n**Recall by label**\n\n| Arm | " + labels.join(" | ") + " |\n|---|" + labels.map(() => "---").join("|") + "|\n";
  for (const arm in R.arms) if (!R.arms[arm].incomplete) md += "| " + arm + " | " + labels.map((l) => pc(R.arms[arm].by_label[l])).join(" | ") + " |\n";
}
writeFileSync(ROOT + "results/TABLES.md", md);
console.log(md);
