// mutants.mjs — do the tests have teeth? Each mutant is the router with ONE law deliberately   // AUDIT-PHASE2 B5 (#40): every mutant targets src/sysrouter.js; add the named mutants listed per item in sysrouter/AUDIT-PHASE2.md §4, plus worker-engine.js and boot.js mutants.
// broken. The test suite must FAIL on every one of them. A mutant that survives means a law
// could be broken without anyone noticing, which makes the passing tests worth less.
//   node sysrouter/test/mutants.mjs
// The mutated router is written to a temporary copy; nothing in the repository is changed.

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, symlinkSync, readdirSync, copyFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { ROOT } from "../bench/lib.mjs";
import { check, done } from "./t.mjs";

const SRC = readFileSync(ROOT + "src/sysrouter.js", "utf8");
// [the law that is broken, the exact text to find, what to put instead]
const MUTANTS = [
  ["a shadow route acts", "if (mode === 'shadow') return row(r, 'shadow', x);", ""],
  ["a model with no fitted gate acts", "if (!g) return { d: null, x, why: 'no_gate' };", "if (!g) return { d, x, why: '' };"],
  ["the gate is ignored", "if (d.p < (has(r.on, d.pick) ? g.p : g.pn) || d.p - d.second < g.margin)", "if (false)"],
  ["an option the route never listed is accepted", "if (typeof pick !== 'string' || !has(q.criteria, pick)) return null;", "if (typeof pick !== 'string') return null;"],
  ["probabilities are not range-checked", "const ok = (x) => typeof x === 'number' && x >= 0 && x <= 1;", "const ok = (x) => true;"],
  ["an answer about older words still acts", "fresh = () => seqOf[rid] === my;", "fresh = () => true;"],
  // the kill switch is enforced twice (hear() returns at once, and every route's mode reads "off"), so breaking it takes both edits
  ["the kill switch is ignored", ["if (flags.off) return null;", "if (flags.off || typeof text !== 'string'", "const modeOf = (r) => flags.off ? 'off' : "], ["", "if (typeof text !== 'string'", "const modeOf = (r) => "]],
  ["a probability alone reaches a reserved action", "fail('reserved action needs exact providers, or addsRecall:true');", "void 0;"],
  ["an extension reaches a reserved action", "if (a.reserved && who.tier === 'extension') fail('extensions cannot reach reserved actions');", ""],
  ["an extension uses an action outside its grant", "if (who.grants && !who.grants.actions.includes(aid)) fail('no grant for action ' + aid);", ""],
  ["an extension uses a provider outside its grant", "if (!who.grants.providers.includes(pid)) fail('no grant for provider ' + pid);", "void 0;"],
  ["an extension removes a system route", "if (!r || (who.name || '') !== r.owner || r.tier !== who.tier) return false;", "if (!r) return false;"],
  ["a lower tier pre-empts a higher tier's hold", "if (h && h.until > t && h.tier < tier) return row(r, 'held', x);", ""],
  ["a stop is subject to cooldown and holds", "if (!a.reserved) {\n      if (cd", "if (true) {\n      if (cd"],
  ["a stop does not clear holds", "const clearHolds = () => { for (const k in held) delete held[k]; };", "const clearHolds = () => {};"],
  ["a deterministic stop waits for a promise", "for (; i < r.providers.length && providers[r.providers[i]].sync; i++) {", "for (; false; i++) {"],
  ["a spent budget still asks the next engine", "if (signal.aborted) return skip(whyAbort());", ""],
  ["the rate cap is ignored", "if (++s.n > r.perMin) { row(r, 'rate'); continue; }", ""],
  ["notFor is not required", "if (typeof spec.notFor !== 'string' || spec.notFor.trim().length < 12) fail(", "if (false) fail("],
  ["route collisions are allowed", "fail('collides with ' + rid);", "void 0;"],
  ["an unlimited amount of text is sent to an engine", "raw.length > 600 ? raw.slice(0, 600) : raw", "raw"],
  ["a reserved action can be added after seal()", "if (a.reserved && sealed) throw new Error('sysrouter: reserved actions are registered before seal()');", ""],
  ["an executor that throws escapes", "try { if (a.run) a.run({ route: r.id, pick, tier: r.tier, args: checkedArgs }); } catch (e) { return row(r, 'act_error', x); }", "if (a.run) a.run({ route: r.id, pick, tier: r.tier, args: checkedArgs });"],
  ["a failing engine is asked forever (no circuit breaker)", "if (h.until > t0) return skip('open');", ""],
  ["the spend cap is ignored", "if (paid[pid] && usd >= maxUsd) return skip('budget');", ""],
  ["an action can loop words back into the router without limit", "const hop = activeHop >= 0 ? activeHop + 1 : 0;", "const hop = 0;"],
  ["an option may be named like a built-in object member", "KEY.test(k) && !(k in Object.prototype) && ", "KEY.test(k) && "],
  ["a registered question can be edited afterwards by its author", "Object.freeze(Object.assign({}, q.criteria));", "q.criteria;"],
  ["a registered answer table can be edited afterwards by its author", "on: Object.freeze(Object.assign(dict(), on)),", "on: rawSpec.on,"],
  ["engines still working on older words are not told to stop", "if (flight[rid]) flight[rid].abort('stale');", ""],
  ["an engine's reported name goes into the journal unchecked", ".replace(/[^\\w.\\/:@~-]/g, '')", ""],
  ["a confident \"nothing\" does not end a cascade", "      if (res.d) { finish(res); return true; }", "      if (res.d && has(r.on, res.d.pick)) { finish(res); return true; }"],
  ["a late answer past the budget acts", "return Promise.race([p, aborted]).finally(() => signal.removeEventListener('abort', onAbort)).then(\n      (res) => signal.aborted ? { d: null, x: { p: pid, ms: Math.round(now() - t0) }, why: whyAbort() } : settle(r, pid, res, t0),", "return p.then(\n      (res) => settle(r, pid, res, t0),"],
  ["a race loser trips the breaker", "signal.reason === 'won' ? 'lost'", "signal.reason === 'won' ? 'timeout'"],
  ["an unversioned gate acts", "return g[pid + '@' + model] || null;", "return g[pid + '@' + model] || g[pid] || null;"],
  ["a getter changes `on` after validation", "on: ro === undefined ? dict() : copyDict(ro),", "on: ro,"],
  ["an extension reaches a stop", "if (acts.some((id) => actions[id] && actions[id].reserved)) throw new Error('sysrouter: extensions cannot be granted reserved actions');", ""],
  ["a cost of $1 or more is not counted", "if (Number.isFinite(res.usd) && res.usd >= 0)", "if (typeof res.usd === 'number' && res.usd >= 0 && res.usd < 1)"],
  ["a throwing action keeps its hold", "try { if (a.run) a.run({ route: r.id, pick, tier: r.tier, args: checkedArgs }); } catch (e) { return row(r, 'act_error', x); }\n    last[r.id + '>' + aid] = t;\n    if (a.reserved) clearHolds();                                                        // a stop clears every hold, whoever owns it\n    else if (a.resource && a.holdMs) held[a.resource] = { tier, until: t + a.holdMs };", "last[r.id + '>' + aid] = t;\n    if (a.reserved) clearHolds();                                                        // a stop clears every hold, whoever owns it\n    else if (a.resource && a.holdMs) held[a.resource] = { tier, until: t + a.holdMs };\n    try { if (a.run) a.run({ route: r.id, pick, tier: r.tier, args: checkedArgs }); } catch (e) { return row(r, 'act_error', x); }"],
  ["the system lane registers after seal", "const assertOpen = () => { if (sealed) throw new Error('sysrouter: sealed'); };", "const assertOpen = () => {};"],
  ["the port exposes `route`", "const port = Object.freeze({", "const port = Object.freeze({ route: (spec) => addRoute(spec, { tier: 'system' }),"],
  ["a failed cascade step writes no row", "if (k === rest.length - 1 || res.why !== 'abstain') row(r, res.why, res.x);", "if (k === rest.length - 1) row(r, res.why, res.x);"],
  ["a readers match is requested again", "if (x.p && providers[x.p] && providers[x.p].inFunnel) {", "if (false) {"],
  ["an event past the hop limit is dispatched", "if (hop > maxHops) {", "if (false) {"],
  ["out-of-range args reach the capability", "if (a.args) { const okArgs = checkArgs(a.args, checkedArgs); if (!okArgs) return row(r, 'bad_args', x); checkedArgs = okArgs; }", "if (false) {}"],
  ["a blocked hash installs", "if (blockList.hashes.has(hash)) throw new Error('sysrouter: blocked extension hash ' + hash);", ""],
  ["a creature request reaches an unexposed command", "if (!a.exposeTo.includes(from)) return row({ id: 'request', tier: a.tier, owner: a.owner, mode: 'live' }, 'refused', { act: commandId, from, did: 0 });", ""],
  ["a tick reply writes an agree row", "if (kind === undefined || kind === 'event') {", "if (true) {"]
];

const dir = mkdtempSync(tmpdir() + "/sysrouter-mutants-");
for (const e of readdirSync(ROOT)) if (e !== "src" && e !== "node_modules") symlinkSync(ROOT + e, dir + "/" + e);
mkdirSync(dir + "/src"); for (const f of readdirSync(ROOT + "src")) copyFileSync(ROOT + "src/" + f, dir + "/src/" + f);
// node resolves an imported file to its real path, so the tests must be real files beside the mutated src
rmSync(dir + "/test"); mkdirSync(dir + "/test"); for (const f of readdirSync(ROOT + "test")) if (f.endsWith(".mjs")) copyFileSync(ROOT + "test/" + f, dir + "/test/" + f); else symlinkSync(ROOT + "test/" + f, dir + "/test/" + f);
rmSync(dir + "/bench"); mkdirSync(dir + "/bench"); for (const f of readdirSync(ROOT + "bench")) copyFileSync(ROOT + "bench/" + f, dir + "/bench/" + f);

const SUITE = [["test/test_router.mjs"], ["test/test_providers.mjs"], ["test/fuzz_router.mjs", "8000"]];
const runs = (file) => { for (const [t, ...a] of SUITE) { const r = spawnSync(process.execPath, [dir + "/" + t, ...a], { cwd: dir, encoding: "utf8", timeout: 120000 }); if (r.status !== 0) return t.replace("test/", ""); } return ""; };

writeFileSync(dir + "/src/sysrouter.js", SRC);
check("the unmutated router passes in the temporary copy (the harness itself is sound)", runs() === "");
let killed = 0;
for (const [law, find, put] of MUTANTS) {
  const finds = [].concat(find), puts = [].concat(put);
  if (!finds.every((f) => SRC.includes(f))) { check("mutant applies: " + law, false, "text not found in src/sysrouter.js (the source moved: update this mutant)"); continue; }
  writeFileSync(dir + "/src/sysrouter.js", finds.reduce((src, f, i) => src.replace(f, puts[i]), SRC));
  const by = runs();
  if (check("caught — " + law, by !== "", "SURVIVED: no test noticed")) { killed++; console.log("  caught by " + by.padEnd(22) + " " + law); }
}
rmSync(dir, { recursive: true, force: true });
console.log("  " + killed + " of " + MUTANTS.length + " deliberately broken routers were caught");
done("mutation check");
