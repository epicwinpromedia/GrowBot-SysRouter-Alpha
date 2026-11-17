// test_readers_regression.mjs — Brit's readers stay exactly as they are (R-EVAL-4, MISSION G1).
//   node sysrouter/test/test_readers_regression.mjs            check
//   node sysrouter/test/test_readers_regression.mjs --pin      re-pin after a new app/ snapshot
// Three things are proved, against the readers sliced live from app/v3/next.html:
//   1. every case his code comments document still reads the way the comment says;
//   2. his readers' answer for every line of the dataset equals the pinned golden file, so a
//      new snapshot that changes any reading is seen at once (and re-pinned on purpose);
//   3. a router with the readers first gives the SAME deterministic decision as the readers
//      alone, for every line, whatever engine sits behind them in the cascade. An engine can
//      add a decision where the readers abstain. It can never change or delay one of theirs.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadReaders } from "../bench/slice.mjs";
import { dataset, ROOT } from "../bench/lib.mjs";
import { BRIT_FT, BRIT_SEEK } from "../data/authored.mjs";
import { createRouter } from "../src/sysrouter.js";
import { readersProvider, ftPick } from "../src/s1-readers.js";
import { WAKE_ROUTE } from "../src/wakeword.js";
import { check, done, rng } from "./t.mjs";

const R = loadReaders(), GOLD = ROOT + "test/golden/readers.json";
const read = (t) => { const w = R._ftWords(t), s = R._seekWords(t); return ftPick(w) + "|" + Object.keys(w).filter((k) => w[k]).sort().join("+") + "|" + (s.clear ? "clear" : "") + "|" + (s.goal || ""); };

// 1. the documented cases
for (const c of BRIT_FT) { const w = R._ftWords(c.t), got = Object.keys(w).filter((k) => w[k] && k !== "again").sort().join("+"); check("comment at next.html:" + c.src + " — \"" + c.t + "\"", got === c.want.slice().sort().join("+"), got); }
for (const c of BRIT_SEEK) { const s = R._seekWords(c.t); check("comment at next.html:" + c.src + " — \"" + c.t + "\"", s.clear === c.clear && s.goal === c.goal, s); }

// 2. the golden file: one reading per dataset line
const lines = [...new Set(dataset("wake").concat(dataset("express")).map((r) => r.text))].sort();
const now = Object.fromEntries(lines.map((t) => [t, read(t)]));
if (process.argv.includes("--pin") || !existsSync(GOLD)) { writeFileSync(GOLD, JSON.stringify({ next_html_sha256: R.sha256, lines: now }, null, 0) + "\n"); console.log("pinned " + lines.length + " readings to test/golden/readers.json"); }
const gold = JSON.parse(readFileSync(GOLD, "utf8"));
let drift = 0, missing = 0; const first = [];
for (const t of lines) { if (!(t in gold.lines)) { missing++; continue; } if (gold.lines[t] !== now[t]) { drift++; if (first.length < 5) first.push({ t, was: gold.lines[t], is: now[t] }); } }
check("the readers read all " + (lines.length - missing) + " pinned lines as they did when pinned", drift === 0, first);
if (missing) console.log("  note: " + missing + " dataset lines are newer than the golden file (run with --pin after reviewing)");
if (gold.next_html_sha256 !== R.sha256) console.log("  note: app/v3/next.html changed since the pin (" + gold.next_html_sha256.slice(0, 12) + " -> " + R.sha256.slice(0, 12) + ")");

// 3. readers-first routing never changes a reader's decision. The engine behind them here is
//    adversarial: it answers every line with a random confident option, as fast as it can.
const rand = rng(20261117), opts = Object.keys(WAKE_ROUTE.question.criteria);
function routed(policy) {
  const ran = [], sr = createRouter({});
  for (const k of ["halt", "still"]) sr.action(k, { run: () => ran.push(k), reserved: true });
  for (const k of opts) if (k !== "none" && k !== "halt" && k !== "still") sr.action(k, { run: () => ran.push(k) });
  sr.provider("readers", readersProvider((t) => ftPick(R._ftWords(t))));
  sr.provider("chaos", { ask: async () => { const k = opts[Math.floor(rand() * opts.length)]; return { model: "chaos", answers: { q: { type: "choice", choice: k, probabilities: { [k]: 1 } } } }; } });
  sr.route(Object.assign({}, WAKE_ROUTE, { providers: ["readers", "chaos"], policy, mode: "parallel", cooldownMs: 0 }));
  sr.calibrate({ wake: { chaos: { p: 0.9 } } });
  return { sr, ran };
}
for (const policy of ["cascade"]) {
  const { sr, ran } = routed(policy); let same = 0, added = 0, wrong = 0, late = 0;
  for (const t of lines) {
    ran.length = 0;
    const want = ftPick(R._ftWords(t)), out = sr.hear(t), inTick = ran.slice();
    await out.done;
    if (want) { if (inTick.length === 1 && inTick[0] === want && ran.length === 1) same++; else if (inTick[0] !== want) { late++; } else wrong++; }
    else if (ran.length) added++;
  }
  check(policy + ": every reader decision ran unchanged, in the same tick, exactly once", wrong === 0 && late === 0 && same > 0, { same, wrong, late });
  check(policy + ": the engine only ever acted where the readers abstained", added > 0, { added });
  console.log("  " + policy + ": " + same + " reader decisions preserved, " + added + " lines where only the engine acted, over " + lines.length + " lines");
}
done("readers regression");
