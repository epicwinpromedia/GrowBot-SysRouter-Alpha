// test_funnel.mjs — the integration changes nothing the app does today (R-COMPAT-2, MISSION G6).
//   node sysrouter/test/test_funnel.mjs
// Brit's real input funnel, sendTxtFrom, is sliced out of app/v3/next.html twice: once as it
// is, once with the integration's one line added (integration/apply.mjs). Both run in a
// sandbox where every function the funnel calls is a recorder. For every line of the dataset,
// in every state the funnel branches on (idle, thinking, paused), the two recordings must be
// IDENTICAL, call for call and argument for argument, in each of these conditions:
//   • SysRouter is not on the page at all            (the typeof guard)
//   • SysRouter is null                              (booted off, or the kill switch)
//   • SysRouter is on, in shadow, with real routes   (the shipped default)
//   • SysRouter.hear throws                          (the try / catch)
// It also measures what the one line costs per utterance, with real routes registered.

import { readFileSync } from "node:fs";
import vm from "node:vm";
import { patch, HUNKS } from "../integration/apply.mjs";
import { dataset, model, pct, round } from "../bench/lib.mjs";
import { createRouter } from "../src/sysrouter.js";
import { readersProvider, ftPick } from "../src/s1-readers.js";
import { ngramProvider } from "../src/s1-ngram.js";
import { registerWake, WAKE_ROUTE } from "../src/wakeword.js";
import { registerExpress } from "../src/expressive.js";
import { check, done } from "./t.mjs";

const original = readFileSync(new URL("../../app/v3/next.html", import.meta.url), "utf8"), patched = patch(original);
check("the three anchors are found in this snapshot of next.html", patched.missing.length === 0, patched.missing);
check("the change only ADDS lines: every original line is still there, in order", (() => { const a = original.split("\n"), b = patched.text.split("\n"); let i = 0; for (const l of b) if (l === a[i]) i++; return i === a.length; })());
check("every added line is fenced SYSROUTER and guarded by typeof", HUNKS.filter((h) => h.name !== "load").every((h) => h.line.includes("/*SYSROUTER{*/") && h.line.includes("/*}SYSROUTER*/") && h.line.includes('typeof SysRouter!=="undefined"') && /try\{.*\}catch\(_sr\)\{\}/.test(h.line)));

const NEED = ["sendTxtFrom", "_ftWords", "_seekWords", "_queueUser", "_qNorm", "Q_SEGS"];
// slice a top-level function by name: first line where the text so far parses (bench/slice.mjs explains why)
function slice(text, name) {
  const lines = text.split("\n"), at = lines.findIndex((l) => l.startsWith("function " + name + "(") || l.startsWith("var " + name + "="));
  let src = ""; for (let i = at; i < at + 400; i++) { src += lines[i] + "\n"; try { new vm.Script(src); return src; } catch (e) {} }
  throw new Error("cannot slice " + name);
}
const compiled = new Map();   // sliced and compiled once per page text; every case then gets a fresh sandbox
const scripts = (text) => { if (!compiled.has(text)) compiled.set(text, NEED.map((n) => new vm.Script(slice(text, n)))); return compiled.get(text); };

// the sandbox: every outside call the funnel makes is recorded, nothing real happens
function sandbox(text, state, sysrouter) {
  const calls = [], rec = (name) => (...a) => { calls.push(name + "(" + a.map((x) => typeof x === "string" ? JSON.stringify(x) : typeof x === "object" ? JSON.stringify(x) : String(x)).join(",") + ")"); return undefined; };
  const box = { calls, Date: { now: () => 1700000000000 }, String, JSON, Math, Array, Object, RegExp, console,
    paused: state === "paused", inFlight: state === "thinking", coolUntil: 0, pendingUser: "", seekGoal: "", actOn: false, _autoRetryUsed: true, _brainSpeechHush: 0,
    _epUserT: 0, _humanT: 0, _quietWordT: 0, _dreamBootT: 5, _live: { scratch: { pt: 0, dreamAt: 0 } }, window: { _faceTrack: null },
    logEv: rec("logEv"), toast: rec("toast"), setErr: rec("setErr"), _humanAsk: rec("_humanAsk"), clearSeek: rec("clearSeek"), setSeek: rec("setSeek"), _languagePerson: rec("_languagePerson"),
    _clearReplyRetry: rec("_clearReplyRetry"), _bodyHalt: rec("_bodyHalt"), _partsHalt: rec("_partsHalt"), _namedHalt: rec("_namedHalt"), vmInvalidate: rec("vmInvalidate"),
    REDACTNOW: () => true, h8: (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0; return ("0000000" + h.toString(16)).slice(-8); } };
  if (sysrouter !== undefined) box.SysRouter = sysrouter;
  vm.createContext(box);
  for (const sc of scripts(text)) sc.runInContext(box);
  return box;
}
function run(text, said, state, sysrouter) {
  const box = sandbox(text, state, sysrouter);
  try { box.sendTxtFrom(said); } catch (e) { box.calls.push("THREW " + e.message); }
  return box.calls.join("\n") + "\n#" + JSON.stringify([box.pendingUser, box.paused, box.inFlight, box._autoRetryUsed, box._humanT, box._live.scratch, box._brainSpeechHush]);
}

// a real router, as boot.js builds it: readers + the on-device model, both routes, shadow
function realRouter(R) {
  const rows = [], acted = [], sr = createRouter({ log: (e, d) => rows.push(d) });
  sr.provider("readers", readersProvider((t) => ftPick(R(t)))); sr.provider("ngram-wake", ngramProvider(model("wake.ngram"))); sr.provider("ngram-express", ngramProvider(model("express.ngram")));
  registerWake(sr, Object.fromEntries(Object.keys(WAKE_ROUTE.on).map((k) => [k, () => acted.push(k)])), ["readers", "ngram-wake"]);
  registerExpress(sr, (f, id) => acted.push(id), ["ngram-express"]);
  sr.calibrate({ wake: { "ngram-wake": { p: 0.6 } }, express: { "ngram-express": { p: 0.6 } } }); sr.seal();
  return { sr, rows, acted };
}

const lines = [...new Set(dataset("wake").concat(dataset("express")).map((r) => r.text))], ft = sandbox(original, "idle")._ftWords;
const live = realRouter(ft), conds = { "not on the page": undefined, "null (off)": null, "on, in shadow": live.sr, "hear() throws": { hear() { throw new Error("router broke"); } } };
const diff = Object.fromEntries(Object.keys(conds).map((k) => [k, 0])); let n = 0, firstDiff = null, threw = 0;
for (const said of lines) for (const state of ["idle", "thinking", "paused"]) {
  const want = run(original, said, state, undefined); n++;
  if (want.includes("THREW")) threw++;
  for (const k in conds) { const got = run(patched.text, said, state, conds[k]); if (got !== want) { diff[k]++; if (!firstDiff) firstDiff = { k, said, state, want: want.slice(0, 400), got: got.slice(0, 400) }; } }
}
check("the sandbox runs the original funnel without a missing stub", threw === 0, threw);
for (const k in conds) check("SysRouter " + k + ": the funnel's calls are identical for all " + n + " (line, state) pairs", diff[k] === 0, firstDiff);
check("…while the shadow router really did hear and decide (so the comparison is not vacuous)", live.rows.length > lines.length && live.acted.length === 0, [live.rows.length, live.acted.length]);
check("shadow acted on nothing, across " + live.rows.length + " journal rows", live.acted.length === 0);

// what the one line costs: the same funnel call, with and without the router listening
const sample = lines.slice(0, 1500), time = (text, sr) => { const box = sandbox(text, "thinking", sr), ms = []; for (const s of sample) { const t = performance.now(); box.sendTxtFrom(s); ms.push(performance.now() - t); } return ms; };
time(original, undefined); time(patched.text, live.sr);                               // warm-up
const a = time(original, undefined), b = time(patched.text, live.sr), add = b.map((v, i) => v - a[i]);
console.log("  funnel call, ms:  today p50 " + round(pct(a, 50), 3) + " p99 " + round(pct(a, 99), 3) + "   with 2 shadow routes p50 " + round(pct(b, 50), 3) + " p99 " + round(pct(b, 99), 3) + "   added p50 " + round(pct(add, 50), 3) + " p99 " + round(pct(add, 99), 3));
check("the added cost stays under 1 ms at the 99th percentile on this machine", pct(add, 99) < 1, pct(add, 99));
done("funnel integration");
