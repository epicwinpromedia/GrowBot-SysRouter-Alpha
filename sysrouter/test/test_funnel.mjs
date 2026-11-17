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
import { registerFuzzy, FUZZY } from "../src/fuzzy.js";
import { registerEmote } from "../src/emote.js";
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
  registerFuzzy(sr, Object.fromEntries(Object.keys(FUZZY.on).map((k) => [k, () => acted.push(k)])), ["readers", "ngram-wake"]);
  registerEmote(sr, (f, id) => acted.push(id), ["ngram-express"]);
  sr.calibrate({ fuzzy: { "ngram-wake@wake.ngram-v1": { p: 0.6 } }, emote: { "ngram-express@express.ngram-v1": { p: 0.6 } } }); sr.seal();
  return { sr, rows, acted };
}

const lines = [...new Set(dataset("wake").concat(dataset("express")).map((r) => r.text))], ft = sandbox(original, "idle")._ftWords;
const live = realRouter(ft), conds = { "not on the page": undefined, "null (off)": null, "on, in shadow": live.sr.port(), "hear() throws": { hear() { throw new Error("router broke"); } } };
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

// reply-handler slice (2C.1, #11): replied(o, kind) runs on both mood and no-mood turns, for event and tick
{
  const pLines = patched.text.split("\n"), idx = pLines.findIndex((l) => l.includes("if(!(o.scratchpad&&o.scratchpad.mood)){"));
  const block = pLines.slice(idx - 2, idx + 3).join("\n");
  const seen = [];
  for (const hasMood of [false, true]) for (const kind of ["event", "tick"]) {
    const box = { o: { scratchpad: hasMood ? { mood: { v: 0.2, e: 0.5 } } : {}, emotion: "happy", say: "hi" }, kind, _live: { scratch: {} }, EMO2MOOD: { happy: { v: 0.5, e: 0.6 } }, emotion: "happy",
      SysRouter: { replied: (o, k) => seen.push([hasMood, k, o.emotion]) } };
    vm.runInNewContext(block, box);
  }
  check("reply-handler slice calls SysRouter.replied(o, kind) on mood and no-mood turns for event and tick", seen.length === 4 && JSON.stringify(seen.map((x) => x.slice(0, 2))) === '[[false,"event"],[false,"tick"],[true,"event"],[true,"tick"]]', seen);
}

// fireReflex slice (2C.2, --with-sensors): calls SysRouter.sense(trig) with zero change to fireReflex's calls
{
  const withS = patch(original, { withSensors: true });
  check("--with-sensors finds all 4 anchors", withS.missing.length === 0, withS.missing);
  const fOrig = slice(original, "fireReflex"), fPatched = slice(withS.text, "fireReflex");
  const runF = (src, trig, sr) => {
    const calls = [], box = { calls, Date: { now: () => 1700000005000 }, paused: false, dreaming: false, recording: false, document: { hidden: false },
      speakingUntil: 0, _motion: null, lastReflexSoundT: 0, _live: { scratch: { reflexes: [{ on: trig, sound: "chirp" }] } },
      playSound: (s) => calls.push("playSound:" + s), logEv: (e) => calls.push("logEv:" + e) };
    if (sr) box.SysRouter = sr;
    vm.runInNewContext(src + "; fireReflex(" + JSON.stringify(trig) + ");", box);
    return calls.join();
  };
  const port = live.sr.port();
  let same = true;
  for (const trig of ["loud", "fall", "poke"]) {
    if (runF(fOrig, trig, undefined) !== runF(fPatched, trig, port)) same = false;
  }
  check("--with-sensors keeps fireReflex calls identical and publishes to body.sense", same && port.read("body.sense").data === "poke", [same, port.read("body.sense")]);
}

// apply-command proposal slice (2C.4): 0-diff vs original sendTxtFrom across all lines/states, with null and mock _faceTrack
{
  const prop = patch(original, { proposal: "apply-command" });
  check("--proposal apply-command finds all anchors", prop.missing.length === 0, prop.missing);
  const propScripts = NEED.concat(["_applyCommand"]).map((n) => new vm.Script(slice(prop.text, n)));
  const mkBox = (text, isProp, state, hasFt) => {
    const calls = [], rec = (name) => (...a) => { calls.push(name + "(" + a.map((x) => typeof x === "string" ? JSON.stringify(x) : typeof x === "object" ? JSON.stringify(x) : String(x)).join(",") + ")"); return undefined; };
    const ftObj = hasFt ? { owns: true, disable: rec("ft.disable"), personFollow: rec("ft.personFollow") } : null;
    const box = { calls, Date: { now: () => 1700000000000 }, String, JSON, Math, Array, Object, RegExp, console,
      paused: state === "paused", inFlight: state === "thinking", coolUntil: 0, pendingUser: "", seekGoal: "", actOn: false, _autoRetryUsed: true, _brainSpeechHush: 0,
      _epUserT: 0, _humanT: 0, _quietWordT: 0, _dreamBootT: 5, _live: { scratch: { pt: 0, dreamAt: 0 } }, window: { _faceTrack: ftObj },
      _getupBrainOn: () => true, _gsLive: () => false, _namedHandOff: rec("_namedHandOff"), _recHandOff: rec("_recHandOff"),
      logEv: rec("logEv"), toast: rec("toast"), setErr: rec("setErr"), _humanAsk: rec("_humanAsk"), clearSeek: rec("clearSeek"), setSeek: rec("setSeek"), _languagePerson: rec("_languagePerson"),
      _clearReplyRetry: rec("_clearReplyRetry"), _bodyHalt: () => true, _partsHalt: rec("_partsHalt"), _namedHalt: rec("_namedHalt"), vmInvalidate: rec("vmInvalidate"),
      REDACTNOW: () => true, h8: (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0; return ("0000000" + h.toString(16)).slice(-8); } };
    vm.createContext(box);
    for (const sc of (isProp ? propScripts : scripts(text))) sc.runInContext(box);
    return (said) => {
      box.calls.length = 0; box.paused = state === "paused"; box.inFlight = state === "thinking"; box.coolUntil = 0; box.pendingUser = ""; box.seekGoal = ""; box.actOn = false;
      box._autoRetryUsed = true; box._brainSpeechHush = 0; box._epUserT = 0; box._humanT = 0; box._quietWordT = 0; box._dreamBootT = 5;
      box._live.scratch.pt = 0; box._live.scratch.dreamAt = 0;
      box.sendTxtFrom(said);
      return box.calls.join("\n") + "\n#" + JSON.stringify([box.pendingUser, box.paused, box.inFlight, box._autoRetryUsed, box._humanT, box._live.scratch, box._brainSpeechHush]);
    };
  };
  let propDiff = 0, propFirst = null;
  for (const hasFt of [false, true]) {
    for (const state of ["idle", "thinking", "paused"]) {
      const wantFn = mkBox(original, false, state, hasFt), gotFn = mkBox(prop.text, true, state, hasFt);
      for (const said of lines) {
        const want = wantFn(said), got = gotFn(said);
        if (got !== want) { propDiff++; if (!propFirst) propFirst = { hasFt, said, state, want: want.slice(0, 300), got: got.slice(0, 300) }; }
      }
    }
  }
  check("--proposal apply-command has 0 diff across all " + (lines.length * 6) + " (line, state, faceTrack) runs", propDiff === 0, propFirst);
}
done("funnel integration");
