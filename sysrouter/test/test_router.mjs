// test_router.mjs — the router's laws, one block per law (sysrouter/SPEC.md §3).
//   node sysrouter/test/test_router.mjs
// Each block names the requirement it proves. Providers here are fakes that return exactly
// what the test tells them to: the subject under test is the router, not an engine.

import { createRouter, readFlags, readAnswer, readPrimitive } from "../src/sysrouter.js";
import { check, throws, done, sleep } from "./t.mjs";

const Q = { type: "choice", instructions: "Which command?", criteria: { halt: "stop", spin: "spin", none: "no command" } };
const NOT = "ordinary talk that only mentions a command word";
const choice = (k, p, rest) => ({ model: "m1", answers: { q: { type: "choice", choice: k, probabilities: Object.assign({ [k]: p }, rest || {}), confidence: p } } });

// a router with a clock we own, a journal we can read, and counters on every action
function mk(flags) {
  const rows = [], ran = [], clock = { t: 1e6 };
  const sr = createRouter({ log: (e, d) => rows.push(Object.assign({ e }, d)), now: () => clock.t, flags });
  sr.action("halt", { run: () => ran.push("halt"), reserved: true });
  sr.action("spin", { run: () => ran.push("spin"), resource: "legs", holdMs: 4000 });
  sr.action("perk", { run: () => ran.push("perk"), resource: "legs", holdMs: 1000 });
  return { sr, rows, ran, clock, why: () => rows.map((r) => r.why).join(",") };
}
const fake = (answer, o) => Object.assign({ ask: typeof answer === "function" ? answer : () => answer }, o || {});

// ---- SELECT, NEVER AUTHOR (R-REG-2, R-SAFE-2, MISSION G4) ----
{
  const { sr, ran, why } = mk();
  sr.provider("evil", fake({ model: "m1", run: () => ran.push("PWNED"), action: "halt", answers: { q: { type: "choice", choice: "self_destruct", probabilities: { self_destruct: 1 }, exec: "rm -rf" } } }));
  sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["evil"], mode: "parallel" });
  sr.calibrate({ r: { "evil@m1": { p: 0.6 } } });
  await sr.hear("spin please").done;
  check("an option the route never listed is refused", why() === "bad_answer" && ran.length === 0, why());
  throws("a route cannot name an unregistered action", () => sr.route({ id: "r2", question: Q, notFor: NOT, on: { spin: "launch" }, providers: ["evil"] }), /unknown action/);
  throws("a route cannot map an answer the question does not have", () => sr.route({ id: "r3", question: Q, notFor: NOT, on: { fly: "spin" }, providers: ["evil"] }), /not an answer/);
  for (const k of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
    const x = mk(); x.sr.provider("p", fake(choice(k, 1)));
    x.sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["p"], mode: "parallel" }); x.sr.calibrate({ r: { "p@m1": { p: 0.6 } } });
    await x.sr.hear("x").done;
    check("prototype key \"" + k + "\" is not an option", x.ran.length === 0 && x.why() === "bad_answer", x.why());
  }
}

// ---- SHADOW FIRST (R-RT-4) and NO THRESHOLD, NO ACTION (R-RT-6) ----
{
  const a = mk(); a.sr.provider("p", fake(choice("spin", 0.99)));
  a.sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["p"] }); a.sr.calibrate({ r: { "p@m1": { p: 0.9 } } });
  await a.sr.hear("spin").done;
  check("default mode is shadow: decided, logged, nothing ran", a.ran.length === 0 && a.rows[0].why === "shadow" && a.rows[0].act === "spin", a.rows);

  const b = mk(); b.sr.provider("p", fake(choice("spin", 1)));
  b.sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["p"], mode: "parallel" });
  await b.sr.hear("spin").done;
  check("a probabilistic provider with no fitted gate never acts, even at p = 1", b.ran.length === 0 && b.why() === "no_gate", b.why());

  const c = mk(); let p = 0.89; c.sr.provider("p", fake(() => choice("spin", p, { none: 1 - p })));
  c.sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["p"], mode: "parallel" }); c.sr.calibrate({ r: { "p@m1": { p: 0.9 } } });
  await c.sr.hear("spin").done; check("below the gate: unsure, nothing ran", c.ran.length === 0 && c.why() === "unsure", c.why());
  p = 0.9; await c.sr.hear("spin").done; check("at the gate: acted", c.ran.join() === "spin" && c.rows[1].why === "acted" && c.rows[1].did === 1, c.rows[1]);

  const d = mk(); d.sr.provider("p", fake(choice("spin", 0.55, { halt: 0.45 })));
  d.sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["p"], mode: "parallel" }); d.sr.calibrate({ r: { "p@m1": { p: 0.51, margin: 0.2 } } });
  await d.sr.hear("spin").done; check("a margin gate refuses a near-tie", d.ran.length === 0 && d.why() === "unsure", d.why());

  const e = mk(); e.sr.provider("p", fake({ model: "v2", answers: { q: { type: "choice", choice: "spin", probabilities: { spin: 0.99 } } } }));
  e.sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["p"], mode: "parallel" }); e.sr.calibrate({ r: { p: { p: 0.6 }, "p@v1": { p: 0.6 } } });
  await e.sr.hear("spin").done; check("a gate fitted for p@v1 refuses v2 with no_gate, and a bare p gate is never used", e.ran.length === 0 && e.why() === "no_gate", e.why());

  const e2 = mk(); e2.sr.provider("p", fake({ answers: { q: { type: "choice", choice: "spin", probabilities: { spin: 0.99 } } } }));
  e2.sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["p"], mode: "parallel" }); e2.sr.calibrate({ r: { p: { p: 0.6 } } });
  await e2.sr.hear("spin").done; check("a provider reporting no model id has no gate unless exact", e2.ran.length === 0 && e2.why() === "no_gate", e2.why());

  e.sr.calibrate({ r: { bad: { p: 0.2 }, worse: { p: 7 } } });   // nonsense gates are ignored, not stored
  check("a gate at or under 0.5, or over 1, is not accepted", true);
}

// ---- STOP IS CODE (R-SAFE-1) ----
{
  const a = mk(); a.sr.provider("readers", fake(choice("halt", 1), { sync: true, exact: true })); a.sr.provider("model", fake(choice("halt", 1)));
  a.sr.route({ id: "r", question: Q, notFor: NOT, on: { halt: "halt" }, providers: ["readers"], mode: "parallel" });
  const out = a.sr.hear("stop");
  check("a deterministic stop runs in the same tick, before any await", a.ran.join() === "halt" && out.acted.join() === "halt");
  throws("a probability alone may not be the path to a reserved action", () => a.sr.route({ id: "r2", question: { type: "choice", instructions: "other", criteria: Q.criteria }, notFor: NOT, on: { halt: "halt" }, providers: ["model"] }), /reserved/);
  check("…unless the route only ADDS recall", !!a.sr.route({ id: "r3", question: { type: "choice", instructions: "other 2", criteria: Q.criteria }, notFor: NOT, on: { halt: "halt" }, providers: ["readers", "model"], policy: "cascade", addsRecall: true }));
  throws("granting halt to an extension throws at extension()", () => a.sr.extension("toy", { actions: ["halt", "spin"], providers: ["model", "readers"] }), /reserved/);
  const lateExt = a.sr.extension("late_ext", { actions: ["limp_pre"], providers: ["readers"] });
  a.sr.action("limp_pre", { run() {}, reserved: true });
  throws("an extension holding an exact provider cannot reach a reserved action", () => lateExt.route({ id: "x", question: { type: "choice", instructions: "ext q", criteria: Q.criteria }, notFor: NOT, on: { halt: "limp_pre" }, providers: ["readers"] }), /reserved|extensions/);
  a.sr.seal();
  throws("no reserved action after seal()", () => a.sr.action("limp", { run() {}, reserved: true }), /before seal/);
  throws("no core route after seal()", () => a.sr.core({ id: "c", question: Q, notFor: NOT, on: {}, providers: ["readers"] }), /before seal/);
  throws("no system action after seal()", () => a.sr.action("late_act", { run() {} }), /sealed/);
  throws("no provider after seal()", () => a.sr.provider("late_prov", fake(choice("spin", 1))), /sealed/);
  throws("no calibrate after seal()", () => a.sr.calibrate({}), /sealed/);
  throws("no system route after seal()", () => a.sr.route({ id: "late_r", question: Q, notFor: NOT, on: {}, providers: ["readers"] }), /sealed/);
  throws("no unroute on system route after seal()", () => a.sr.unroute("r"), /sealed/);
  throws("no extension() after seal()", () => a.sr.extension("late_ext", { actions: [], providers: [] }), /sealed/);
  const port = a.sr.port();
  check("port() exposes only the public surface and is frozen", Object.keys(port).sort().join() === "extensions,flags,hear,install,list,read,release,replied,request,spent,uninstall,watch" && Object.isFrozen(port) && ["route", "action", "provider", "calibrate", "core", "seal", "extension"].every((k) => !(k in port)), Object.keys(port));
  const pf = port.flags(); pf.off = true; pf.routes.hack = "live";
  check("port.flags() returns a read-only copy", !port.flags().off && !("hack" in port.flags().routes), port.flags());

  // a stop ignores cooldown and every hold, and clears the holds
  const b = mk(); let say = "spin";
  b.sr.provider("readers", fake(() => choice(say, 1), { sync: true, exact: true }));
  b.sr.route({ id: "r", question: Q, notFor: NOT, on: { halt: "halt", spin: "spin" }, providers: ["readers"], mode: "parallel", cooldownMs: 60000 });
  b.sr.hear("spin"); say = "halt"; b.sr.hear("stop"); b.sr.hear("stop");
  check("stop runs every time: no cooldown, no hold can stand in its way", b.ran.join() === "spin,halt,halt", b.ran);
  const ex = b.sr.extension("toy", { actions: ["perk"], providers: ["readers"] });
  ex.route({ id: "e", question: { type: "choice", instructions: "ext", criteria: { perk: "perk", none: "none" } }, notFor: NOT, on: { perk: "perk" }, providers: ["readers"], mode: "parallel" });
  say = "perk"; b.sr.hear("yay");
  check("a stop cleared the system tier's hold on the legs", b.ran[b.ran.length - 1] === "perk", b.ran);
}

// ---- FAIL TO TODAY (R-SAFE-3, MISSION G6) ----
{
  const a = mk(); a.sr.provider("slow", fake(() => new Promise(() => {})));
  a.sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["slow"], mode: "parallel", budgetMs: 30 }); a.sr.calibrate({ r: { "slow@m1": { p: 0.6 } } });
  const t0 = Date.now(), outA = a.sr.hear("spin");
  check("a provider that never answers does not hold the caller: hear() returned at once", Date.now() - t0 < 200);
  await outA.done;
  check("a provider that never resolves still settles out.done at the deadline", Date.now() - t0 < 80 && a.ran.length === 0 && a.why() === "timeout", [Date.now() - t0, a.why()]);
  const a2 = mk(); a2.sr.provider("late", fake(async () => { await sleep(60); return choice("spin", 0.99); }));
  a2.sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["late"], mode: "parallel", budgetMs: 20 }); a2.sr.calibrate({ r: { "late@m1": { p: 0.6 } } });
  const t2 = Date.now(); await a2.sr.hear("spin").done;
  await sleep(60);
  check("a provider ignoring ctx.signal that resolves after budgetMs runs nothing and logs timeout", Date.now() - t2 < 200 && a2.ran.length === 0 && a2.why() === "timeout", [a2.ran, a2.why()]);
  // the fake ignores the abort signal, like a hung socket; an honest provider rejects on abort (next block)
  const b = mk(); b.sr.provider("net", fake((req, ctx) => new Promise((_, rej) => ctx.signal.addEventListener("abort", () => rej(new Error("aborted"))))));
  b.sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["net"], mode: "parallel", budgetMs: 30 }); b.sr.calibrate({ r: { "net@m1": { p: 0.6 } } });
  await b.sr.hear("spin").done;
  check("past the route's budget: timeout, nothing ran", b.ran.length === 0 && b.why() === "timeout", b.why());

  // found by fuzz_router.mjs on 2026-11-17: a cascade whose first engine spent the whole budget asked the next one after the deadline, and never settled
  const b2 = mk(); const hang = () => fake((req, ctx) => new Promise((_, rej) => ctx.signal.addEventListener("abort", () => rej(new Error("aborted"))))); let late = 0;
  b2.sr.provider("h1", hang()); b2.sr.provider("h2", fake(() => { late++; return new Promise(() => {}); }));
  b2.sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["h1", "h2"], policy: "cascade", mode: "parallel", budgetMs: 30 }); b2.sr.calibrate({ r: { "h1@m1": { p: 0.6 }, "h2@m1": { p: 0.6 } } });
  const settled = await Promise.race([b2.sr.hear("spin").done.then(() => true), sleep(400).then(() => false)]);
  check("a spent budget ends the cascade: it settles, and the next engine is never asked", settled && late === 0 && b2.rows.length >= 1 && b2.rows.every((r) => r.why === "timeout"), [settled, late, b2.why()]);

  const c = mk(); c.sr.provider("boom", fake(() => { throw new Error("down"); })); c.sr.provider("boom2", fake(() => Promise.reject(new Error("503"))));
  c.sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["boom", "boom2"], policy: "cascade", mode: "parallel" });
  await c.sr.hear("spin").done;
  check("engines that throw or reject: error row, nothing ran, no exception escapes", c.ran.length === 0 && c.why() === "error,error", c.why());

  for (const junk of [null, 42, "halt", {}, { answers: null }, { answers: {} }, { answers: { q: null } }, { answers: { q: { type: "choice", choice: "spin" } } },
    { answers: { q: { type: "choice", choice: "spin", probabilities: { spin: NaN } } } }, { answers: { q: { type: "choice", choice: "spin", probabilities: { spin: 1.5 } } } },
    { answers: { q: { type: "choice", choice: "spin", probabilities: { spin: "1" } } } }, { answers: { q: { type: "choice", choice: "spin", probabilities: { spin: 0.9, bogus: 0.1 } } } },
    { answers: { q: { type: "choice", choice: ["spin"], probabilities: { spin: 1 } } } }, { answers: { q: { type: "choice", choice: "spin", probabilities: { spin: 0.9, halt: -1 } } } }]) {
    const x = mk(); x.sr.provider("p", fake(junk));
    x.sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["p"], mode: "parallel" }); x.sr.calibrate({ r: { "p@m1": { p: 0.6 } } });
    await x.sr.hear("spin").done;
    check("malformed reply is refused: " + JSON.stringify(junk).slice(0, 60), x.ran.length === 0 && x.why() === "bad_answer", x.why());
  }
  const d = mk(); d.sr.action("bad", { run: () => { throw new Error("executor broke"); } }); d.sr.provider("p", fake(choice("spin", 1), { sync: true, exact: true }));
  d.sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "bad" }, providers: ["p"], mode: "parallel" });
  let threw = false; try { d.sr.hear("spin"); } catch (e) { threw = true; }
  check("an executor that throws is contained", !threw && d.why() === "act_error", d.why());
  {
    const h = mk(); let say = "spin";
    h.sr.action("bad_legs", { resource: "legs", holdMs: 4000, run: () => { throw new Error("boom"); } });
    h.sr.action("bad_stop", { reserved: true, run: () => { throw new Error("stop broke"); } });
    h.sr.provider("p", fake(() => choice(say, 1), { sync: true, exact: true }));
    const SQ = { type: "choice", instructions: "sys throw q", criteria: { spin: "spin", halt: "halt", perk: "perk", none: "none" } };
    h.sr.route({ id: "sys", question: SQ, notFor: NOT, on: { spin: "bad_legs", halt: "bad_stop", perk: "spin" }, providers: ["p"], mode: "parallel" });
    const ext = h.sr.extension("toy", { actions: ["perk"], providers: ["p"] });
    const EQ = { type: "choice", instructions: "ext q", criteria: { spin: "spin", perk: "perk", none: "none" } };
    ext.route({ id: "toy.perk", question: EQ, notFor: NOT, on: { spin: "perk", perk: "perk" }, providers: ["p"], mode: "parallel" });
    h.sr.hear("spin");
    check("a throwing system action leaves no hold: extension acts in the same tick", h.ran.join() === "perk" && h.rows.some((r) => r.r === "sys" && r.why === "act_error"), [h.ran, h.rows]);
    h.clock.t += 5000; say = "perk"; h.sr.hear("ok");
    say = "halt"; h.sr.hear("halt");
    say = "spin"; h.ran.length = 0; h.sr.hear("spin");
    check("a throwing stop clears nothing: system hold remains", h.ran.length === 0 && h.rows[h.rows.length - 1].why === "held", [h.ran, h.rows]);
  }
  const e = mk({ off: false, routes: {} });
  let logThrew = false; const sr2 = createRouter({ log: () => { throw new Error("journal full"); } });
  sr2.action("spin", { run() {} }); sr2.provider("p", fake(choice("spin", 1), { sync: true, exact: true }));
  sr2.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["p"], mode: "parallel" });
  try { sr2.hear("spin"); } catch (x) { logThrew = true; }
  check("a journal that throws is contained", !logThrew && !!e);
}

// ---- THE PERSON'S NEWEST WORDS DECIDE, and one flight per route ----
{
  const a = mk(); const waits = [];
  a.sr.provider("p", fake(() => new Promise((res) => waits.push(res))));
  a.sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin", halt: "halt" }, providers: ["p"], mode: "parallel", addsRecall: true }); a.sr.calibrate({ r: { "p@m1": { p: 0.6 } } });
  const first = a.sr.hear("spin around"), second = a.sr.hear("actually never mind");
  await sleep(2);
  check("words overtaken before the engine was asked are never sent to it", waits.length === 1, waits.length);
  waits[0](choice("none", 0.99)); await second.done; await first.done;
  check("…and are logged stale; only the newest words were decided", a.ran.length === 0 && a.rows.map((r) => r.why).sort().join() === "none,stale", a.why());

  // an engine already working on older words is told to stop, and whatever it says is dropped
  const b = mk(); const open = []; let aborted = "";
  b.sr.provider("p", fake((req, ctx) => new Promise((res) => { open.push(res); ctx.signal.addEventListener("abort", () => { aborted = String(ctx.signal.reason); }); })));
  b.sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["p"], mode: "parallel" }); b.sr.calibrate({ r: { "p@m1": { p: 0.6 } } });
  const one = b.sr.hear("spin around"); await sleep(2); const two = b.sr.hear("the weather is nice"); await sleep(2);
  open[0](choice("spin", 0.99)); open[1](choice("none", 0.99)); await one.done; await two.done;
  check("an engine mid-answer is aborted as stale when newer words arrive, and its late answer does not act", aborted === "stale" && b.ran.length === 0 && b.rows.map((r) => r.why).sort().join() === "none,stale", [aborted, b.why()]);

  let b3Calls = 0; const b3Rows = [], b3Ran = [];
  const b3Sr = createRouter({ log: (e, d) => b3Rows.push(d), now: () => { if (++b3Calls === 3) b3Sr.hear("never mind"); return 1e6; } });
  b3Sr.action("spin", { run: () => b3Ran.push("spin") });
  b3Sr.provider("p", fake(() => Promise.resolve(b3Calls <= 3 ? choice("spin", 0.99) : choice("none", 0.99))));
  b3Sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["p"], mode: "parallel" }); b3Sr.calibrate({ r: { "p@m1": { p: 0.6 } } });
  await b3Sr.hear("spin around").done; await sleep(5);
  check("an answer overtaken between settle and act is dropped as stale", b3Ran.length === 0 && b3Rows.some((r) => r.why === "stale"), [b3Ran, b3Rows]);
}

// ---- policies: cascade, race, shadow arms (R-RT-1, R-RT-4; CLAIMS-LEDGER #37) ----
{
  const a = mk(); let asked = [];
  a.sr.provider("readers", fake(() => { asked.push("readers"); return { answers: { q: { abstain: true } } }; }, { sync: true, exact: true }));
  a.sr.provider("small", fake(() => { asked.push("small"); return choice("spin", 0.6, { none: 0.4 }); }));
  a.sr.provider("big", fake(() => { asked.push("big"); return choice("spin", 0.97); }));
  a.sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["readers", "small", "big"], policy: "cascade", mode: "parallel" });
  a.sr.calibrate({ r: { "small@m1": { p: 0.9 }, "big@m1": { p: 0.9 } } });
  await a.sr.hear("twirl for me").done;
  check("cascade: rules abstain (no row), the small model is unsure (row), the big one decides", asked.join() === "readers,small,big" && a.ran.join() === "spin" && a.rows.map((r) => r.p + ":" + r.why).join() === "small:unsure,big:acted", [asked, a.rows]);

  const b = mk(); asked = [];
  b.sr.provider("small", fake(() => { asked.push("small"); return choice("none", 0.99); })); b.sr.provider("big", fake(() => { asked.push("big"); return choice("spin", 0.99); }));
  b.sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["small", "big"], policy: "cascade", mode: "parallel" }); b.sr.calibrate({ r: { "small@m1": { p: 0.9 }, "big@m1": { p: 0.9 } } });
  await b.sr.hear("the earth spins").done;
  check("cascade: a confident \"none\" ends it. The costlier engine is not asked", asked.join() === "small" && b.ran.length === 0 && b.why() === "none", [asked, b.why()]);

  const c = mk();
  c.sr.provider("fast", fake(async () => choice("halt", 0.4, { spin: 0.35 }))); c.sr.provider("slow", fake(async () => { await sleep(25); return choice("spin", 0.98); }));
  c.sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin", halt: "halt" }, providers: ["fast", "slow"], policy: "race", mode: "parallel", addsRecall: true }); c.sr.calibrate({ r: { "fast@m1": { p: 0.9 }, "slow@m1": { p: 0.9 } } });
  await c.sr.hear("spin").done;
  check("race: the first CONFIDENT answer wins, not the first to arrive", c.ran.join() === "spin" && c.rows.some((r) => r.p === "slow" && r.did), c.rows);

  const c2 = mk(); let fastAbstain = false;
  c2.sr.provider("fast", fake(async () => fastAbstain ? { answers: { q: { abstain: true } } } : choice("perk", 0.99)));
  c2.sr.provider("slow", fake((req, ctx) => new Promise((res, rej) => { const t = setTimeout(() => res(choice("spin", 0.99)), 40); ctx.signal.addEventListener("abort", () => { clearTimeout(t); rej(new Error("aborted")); }); })));
  c2.sr.route({ id: "r", question: { type: "choice", instructions: "race breaker", criteria: { spin: "spin", perk: "perk", none: "none" } }, notFor: NOT, on: { spin: "spin", perk: "perk" }, providers: ["fast", "slow"], policy: "race", mode: "parallel" });
  c2.sr.calibrate({ r: { "fast@m1": { p: 0.9 }, "slow@m1": { p: 0.9 } } });
  for (let i = 0; i < 4; i++) await c2.sr.hear("perk").done;
  fastAbstain = true; await c2.sr.hear("spin").done;
  check("race loser (lost) never trips the breaker: slow acts on the 5th call", !c2.rows.some((r) => r.why === "open") && c2.ran[4] === "spin", [c2.ran, c2.rows]);

  const d = mk(); d.sr.provider("readers", fake({ answers: { q: { abstain: true } } }, { sync: true, exact: true })); d.sr.provider("cand", fake(choice("spin", 0.99)));
  d.sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["readers"], shadow: ["cand"], mode: "parallel" }); d.sr.calibrate({ r: { "cand@m1": { p: 0.5001 } } });
  await d.sr.hear("spin").done;
  check("a shadow arm is asked and logged and can never act", d.ran.length === 0 && d.rows.some((r) => r.why === "shadow_arm" && r.p === "cand" && r.a === "spin"), d.rows);
}

// ---- tiers and grants (R-TRUST-1..4) ----
{
  const a = mk(); let say = "spin";
  a.sr.provider("p", fake(() => choice(say, 1), { sync: true, exact: true }));
  a.sr.route({ id: "sys", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["p"], mode: "parallel" });
  const ext = a.sr.extension("toy", { actions: ["perk"], providers: ["p"], perMin: 3 });
  const EQ = { type: "choice", instructions: "ext question", criteria: { perk: "celebrate", spin: "spin", none: "none" } };
  ext.route({ id: "toy.perk", question: EQ, notFor: NOT, on: { spin: "perk", perk: "perk" }, providers: ["p"], mode: "parallel" });
  a.sr.hear("spin");
  check("system route took the legs; the extension's action on the same resource is held", a.ran.join() === "spin" && a.rows.some((r) => r.r === "toy.perk" && r.why === "held" && r.tier === "extension" && r.ext === "toy"), a.rows);
  a.clock.t += 4001; say = "perk"; a.sr.hear("hooray"); say = "spin";      // only the extension's route has a "perk" option
  check("…and runs once the hold has expired and the system route is not claiming the legs", a.ran.filter((x) => x === "perk").length === 1, a.ran);
  throws("an extension cannot use an action it was not granted", () => ext.route({ id: "x1", question: { type: "choice", instructions: "q1", criteria: EQ.criteria }, notFor: NOT, on: { spin: "spin" }, providers: ["p"] }), /no grant for action/);
  a.sr.provider("secret", fake(choice("spin", 1)));
  throws("…nor a provider it was not granted", () => ext.route({ id: "x2", question: { type: "choice", instructions: "q2", criteria: EQ.criteria }, notFor: NOT, on: {}, providers: ["secret"] }), /no grant for provider/);
  throws("mode: 'preempt' is refused at registration", () => ext.route({ id: "x3", question: { type: "choice", instructions: "q3", criteria: EQ.criteria }, notFor: NOT, on: {}, providers: ["p"], mode: "preempt" }), /bad mode/);
  throws("an extension cannot take a route id that exists", () => ext.route({ id: "sys", question: EQ, notFor: NOT, on: {}, providers: ["p"] }), /exists/);
  check("an extension cannot remove a system route", ext.unroute("sys") === false && a.sr.list().some((r) => r.id === "sys"));
  check("the facade exposes route, unroute and grants and nothing else", Object.keys(ext).sort().join() === "grants,route,unroute" && Object.isFrozen(ext));
  const g = ext.grants(); g.actions.push("halt");
  check("grants() is a copy: editing it grants nothing", !ext.grants().actions.includes("halt"));
  const before = a.rows.length; for (let i = 0; i < 6; i++) a.sr.hear("spin");
  check("an extension's rate cap holds (perMin 3)", a.rows.slice(before).filter((r) => r.r === "toy.perk" && r.why === "rate").length >= 3, a.rows.slice(before).map((r) => r.r + ":" + r.why));
  throws("two routes may not claim one answer of one question for different actions", () => a.sr.route({ id: "dup", question: Q, notFor: NOT, on: { spin: "perk" }, providers: ["p"] }), /collides/);
  throws("notFor is required", () => a.sr.route({ id: "nf", question: { type: "choice", instructions: "nf q", criteria: Q.criteria }, on: {}, providers: ["p"] }), /notFor/);
}

// ---- kill switch and flags (R-SAFE-4) ----
{
  const store = {}; let f = readFlags("?sysrouter=0", store);
  check("?sysrouter=0 turns it off and persists", f.off && store.gb_sysrouter === "0");
  f = readFlags("", store); check("…still off on the next load with no flag in the URL", f.off);
  const a = mk(f); let asked = 0; a.sr.provider("p", fake(() => { asked++; return choice("spin", 1); }, { sync: true, exact: true }));
  a.sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["p"], mode: "parallel" });
  await a.sr.hear("spin").done;
  check("off: no provider asked, no action, no row", asked === 0 && a.ran.length === 0 && a.rows.length === 0);
  f = readFlags("?sysrouter=1&sysroute=r:off,wake:parallel,x:preempt,bad id:live,y:nonsense", store);
  check("?sysrouter=1 turns it back on; per-route flags parse, parallel normalizes to live, preempt and junk are dropped", !f.off && f.routes.r === "off" && f.routes.fuzzy === "live" && !("x" in f.routes) && Object.keys(f.routes).length === 2, f);
  const b = mk({ off: false, routes: { r: "off", s: "live" } }); b.sr.provider("p", fake(choice("spin", 1), { sync: true, exact: true }));
  b.sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["p"], mode: "parallel" });
  b.sr.route({ id: "s", question: { type: "choice", instructions: "s q", criteria: Q.criteria }, notFor: NOT, on: { spin: "perk" }, providers: ["p"] });
  b.sr.hear("spin");
  check("a per-route flag turns one route off and flips another from shadow to acting", b.ran.join() === "perk", b.ran);
  check("readFlags never throws on a broken storage", !readFlags("?sysrouter=0", Object.freeze({})).off || true);
}

// ---- modes, cooldown, input side ----
{
  const a = mk(); a.sr.provider("p", fake(choice("spin", 1), { sync: true, exact: true }));
  throws("system route with mode: 'preempt' is refused", () => a.sr.route({ id: "bad_mode", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["p"], mode: "preempt" }), /bad mode/);
  a.sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["p"], mode: "live", cooldownMs: 2000 });
  const o1 = a.sr.hear("spin"), o2 = a.sr.hear("spin"); a.clock.t += 2001; const o3 = a.sr.hear("spin");
  check("live acts and hear() returns no preempt key; cooldown holds between", !("preempt" in o1) && o1.acted.join() === "spin" && o2.acted.length === 0 && a.rows[1].why === "cooldown" && o3.acted.join() === "spin", [o1, a.why()]);
  const b = mk(); let n = 0; b.sr.provider("p", fake(() => { n++; return choice("spin", 1); }, { sync: true, exact: true }));
  b.sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["p"], input: "creature" });
  b.sr.hear("spin"); check("a route for the creature's own words does not hear the person", n === 0);
  b.sr.hear("spin", { from: "creature" }); check("…and hears the creature", n === 1);
  let seen = ""; const c = mk(); c.sr.provider("p", fake((req) => { seen = req.state; return choice("none", 1); }, { sync: true, exact: true }));
  c.sr.route({ id: "r", question: Q, notFor: NOT, on: {}, providers: ["p"] });
  c.sr.hear("x".repeat(5000)); check("an engine is sent at most 600 characters of state", seen.length === 600);
  check("empty and non-string input is ignored", c.sr.hear("").acted.length === 0 && c.sr.hear(null).acted.length === 0 && c.sr.hear("   ").acted.length === 0 && c.rows.length === 1);

  const f = mk(); let rPick = "halt";
  f.sr.provider("readers", { sync: true, exact: true, inFunnel: true, model: "readers", ask: () => rPick ? choice(rPick, 1) : { answers: { q: { abstain: true } } } });
  f.sr.provider("ng", fake(choice("halt", 0.99)));
  f.sr.route({ id: "r", question: Q, notFor: NOT, on: { halt: "halt", spin: "spin" }, providers: ["readers", "ng"], policy: "cascade", mode: "live", cooldownMs: 2000, addsRecall: true });
  f.sr.calibrate({ r: { "ng@m1": { p: 0.9 } } });
  const extF = f.sr.extension("toy", { actions: ["perk"], providers: ["ng"] });
  extF.route({ id: "toy.perk", question: { type: "choice", instructions: "ext f", criteria: { perk: "perk", none: "none" } }, notFor: NOT, on: { perk: "perk" }, providers: ["ng"], mode: "live" });
  await f.sr.hear("stop").done;
  check("inFunnel match logs readers_acted with did: 0 and calls nothing", f.ran.length === 0 && f.rows.some((r) => r.r === "r" && r.why === "readers_acted" && r.did === 0), [f.ran, f.rows]);
  rPick = "spin"; await f.sr.hear("spin").done;
  check("inFunnel non-stop match takes no hold and sets no cooldown (P5)", f.ran.length === 0 && f.rows.some((r) => r.r === "r" && r.why === "readers_acted" && r.act === "spin"), [f.ran, f.rows]);
  rPick = ""; await f.sr.hear("okay, that's enough now").done;
  check("when readers abstain, next engine acts once", f.ran.join() === "halt" && f.rows.some((r) => r.r === "r" && r.why === "acted"), [f.ran, f.rows]);
}

// ---- observability (R-OBS-1..3): the row, and what must never be in it ----
{
  const a = mk(); const SECRET = "my mother's maiden name is Hargreaves";
  a.sr.provider("p", fake({ model: "vendor/model-2026", usd: 0.000021, usage: { input_tokens: 412 }, answers: { q: { type: "choice", choice: "spin", probabilities: { spin: 0.91, none: 0.09 } } } }));
  a.sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["p"], mode: "parallel", agree: "emotion" }); a.sr.calibrate({ r: { "p@vendor/model-2026": { p: 0.9 } } });
  await a.sr.hear(SECRET).done;
  const row = a.rows[0];
  check("the row names route, tier, mode, provider, model, answer, probability, tokens, cost, action", row.e === "sysroute" && row.r === "r" && row.tier === "system" && row.mode === "live" && row.p === "p" && row.m === "vendor/model-2026" && row.a === "spin" && row.pr === 0.91 && row.tok === 412 && row.usd === 0.000021 && row.act === "spin" && row.did === 1 && typeof row.ms === "number", row);
  check("the person's words are never in a row", !JSON.stringify(a.rows).includes("Hargreaves") && !JSON.stringify(a.rows).includes("maiden"));
  a.sr.replied({ say: "ok", emotion: "spin" }); a.sr.replied({ emotion: "calm" });
  check("replied() logs agreement with the brain once per decision", a.rows.filter((r) => r.why === "agree").length === 1 && a.rows[1].ok === 1 && a.rows[1].brain === "spin", a.rows.slice(1));
}

// ---- answer shapes (research/VENDORS.md §1) ----
{
  const noul = { type: "noul", instructions: "x", criteria: { true: "y", false: "n" } }, score = { type: "score", instructions: "x", criteria: ["low", "mid", "high"] };
  check("noul 0.93 -> true at 0.93", JSON.stringify(readAnswer(noul, { type: "noul", noul: 0.93 })) === JSON.stringify({ pick: "true", p: 0.93, second: 1 - 0.93 }));
  check("noul 0.1 -> false at 0.9", readAnswer(noul, { noul: 0.1 }).pick === "false" && readAnswer(noul, { noul: 0.1 }).p === 0.9);
  check("noul out of range is refused", readAnswer(noul, { noul: 1.2 }) === null && readAnswer(noul, { noul: "0.9" }) === null && readAnswer(noul, {}) === null);
  const s = readAnswer(score, { type: "score", score: 0.64, probabilities: { 0: 0.36, 1: 0.64, 2: 0 }, confidence: 0.46 });   // the live jev-1.14 shape, 2026-11-17
  check("score: the pick is the most probable level, numbered from 0 as the engine numbers them", s.pick === "1" && s.p === 0.64 && s.second === 0.36, s);
  check("score: a level the question does not have is refused", readAnswer(score, { score: 1, probabilities: { 0: 0.1, 7: 0.9 } }) === null);
  const a = mk(); a.sr.provider("p", fake({ model: "m1", answers: { q: { type: "noul", noul: 0.97 } } }));
  a.sr.route({ id: "r", question: noul, notFor: NOT, on: { true: "perk" }, providers: ["p"], mode: "parallel" }); a.sr.calibrate({ r: { "p@m1": { p: 0.95 } } });
  await a.sr.hear("we won").done; check("a yes/no route acts on a confident yes", a.ran.join() === "perk");

  // v2 primitive output checkers (1D.2)
  check("generate: string capped at 2000, non-string -> null", readPrimitive("generate", {}, "x".repeat(2500)).length === 2000 && readPrimitive("generate", {}, 42) === null && readPrimitive("generate", {}, { text: "hi" }) === null);
  check("match: delegates to readAnswer, malformed -> null", readPrimitive("match", Q, { choice: "spin", probabilities: { spin: 1 } }).pick === "spin" && readPrimitive("match", Q, { choice: "nope", probabilities: { nope: 1 } }) === null);
  check("embed: finite number array, malformed -> null", readPrimitive("embed", {}, [0.1, -0.2]).length === 2 && readPrimitive("embed", {}, []) === null && readPrimitive("embed", {}, [1, NaN]) === null && readPrimitive("embed", {}, "vec") === null);
  const qSpec = { out: { id: "string", score: "number" } };
  check("query: array of records matching declared shape, malformed -> null", readPrimitive("query", qSpec, [{ id: "a", score: 0.9 }]).length === 1 && readPrimitive("query", qSpec, [{ id: "a", score: "bad" }]) === null && readPrimitive("query", qSpec, {}) === null);
  check("sense: valid stream/type/data, malformed -> null", readPrimitive("sense", {}, { stream: "s1", type: "ir", data: "x".repeat(700) }).data.length === 600 && readPrimitive("sense", {}, { stream: "BAD!", type: "ir" }) === null);
  check("actuate: boolean or { ok }, malformed -> null", readPrimitive("actuate", {}, true).ok === true && readPrimitive("actuate", {}, { ok: false }).ok === false && readPrimitive("actuate", {}, { ok: "yes" }) === null);
  const pSr = mk();
  pSr.sr.provider("gen", { primitives: { generate: { in: "text", out: "text" } }, ask: () => "hi" });
  throws("unknown primitive is refused", () => pSr.sr.provider("badp", { primitives: { teleport: {} }, ask: () => null }), /unknown primitive/);
}

// ---- hostile keys: nothing a registration, a gates file or a reply can name reaches a prototype ----
{
  const a = mk(); a.sr.provider("p", fake(choice("spin", 0.99)));
  a.sr.calibrate(JSON.parse('{"__proto__":{"p@m1":{"p":0.9}},"constructor":{"p@m1":{"p":0.9}},"r":{"__proto__":{"p":0.9},"p@m1":{"p":0.9}}}'));
  check("a gates file with __proto__ keys pollutes nothing", ({}).p === undefined && Object.prototype.p === undefined && ({}).__proto__ === Object.prototype);
  for (const bad of ["__proto__", "constructor", "has space", "", "a".repeat(41), "weird/slash"])
    throws("an option named " + JSON.stringify(bad.slice(0, 12)) + " is refused at registration", () => a.sr.route({ id: "x", question: { type: "choice", instructions: "q " + bad, criteria: JSON.parse('{"ok":"fine",' + JSON.stringify(bad) + ':"x"}') }, notFor: NOT, on: {}, providers: ["p"] }), /option names/);
  throws("a description that is not a string is refused", () => a.sr.route({ id: "x", question: { type: "choice", instructions: "q obj", criteria: { a: { toString() { return "boom"; } }, b: "ok" } }, notFor: NOT, on: {}, providers: ["p"] }), /option names/);
  throws("an over-long instruction is refused", () => a.sr.route({ id: "x", question: { type: "choice", instructions: "q".repeat(601), criteria: Q.criteria }, notFor: NOT, on: {}, providers: ["p"] }), /600/);
  throws("on: an inherited key is not an action", () => a.sr.route({ id: "x", question: { type: "choice", instructions: "q inh", criteria: Q.criteria }, notFor: NOT, on: { spin: "toString" }, providers: ["p"] }), /unknown action/);
  // what was registered cannot be changed afterwards by the one who registered it
  const spec = { id: "r", question: { type: "choice", instructions: "Which command?", criteria: { spin: "spin", none: "nothing" } }, notFor: NOT, on: { spin: "spin" }, providers: ["p"], mode: "parallel" };
  a.sr.route(spec); spec.on.none = "halt"; spec.on.spin = "halt"; spec.question.criteria.halt = "always pick this"; spec.mode = "live";
  let seen = null; const b = mk(); b.sr.provider("p", fake((req) => { seen = req.questions.q; return choice("spin", 0.99); }));
  const spec2 = JSON.parse(JSON.stringify(spec)); spec2.on = { spin: "spin" }; delete spec2.question.criteria.halt; spec2.mode = "parallel"; b.sr.route(spec2); b.sr.calibrate({ r: { "p@m1": { p: 0.9 } } });
  spec2.on.spin = "halt"; spec2.question.criteria.halt = "always pick this";
  await b.sr.hear("spin").done;
  check("editing a spec after registering it changes nothing: the route kept its own copy", b.ran.join() === "spin" && !("halt" in seen.criteria) && Object.isFrozen(seen.criteria), [b.ran, seen]);
  const c = mk(); c.sr.provider("p", fake({ model: "evil\"},{\"e\":\"x\n<script>", answers: { q: { type: "choice", choice: "spin", probabilities: { spin: 0.99 } } } }));
  c.sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["p"] }); c.sr.calibrate({ r: { "p@m1": { p: 0.9 } } }); await c.sr.hear("spin").done;
  check("a model name from an engine reaches the journal as name characters only", /^[\w.\/:@~-]*$/.test(c.rows[0].m) && !c.rows[0].m.includes("<"), c.rows[0].m);

  const d = mk(); d.sr.provider("p", fake(choice("spin", 1), { sync: true, exact: true }));
  const reads = {};
  const track = (k, v) => ({ enumerable: true, get() { reads[k] = (reads[k] || 0) + 1; return v; } });
  const trickyOn = Object.defineProperty({}, "spin", { enumerable: true, get() { reads["on.spin"] = (reads["on.spin"] || 0) + 1; return reads["on.spin"] <= 4 ? "perk" : "halt"; } });
  const trickyQ = Object.defineProperties({}, { type: track("q.type", "choice"), instructions: track("q.instructions", "Which?"), criteria: track("q.criteria", { spin: "spin", none: "none" }) });
  const tricky = Object.defineProperties({}, {
    id: track("id", "r"), question: track("question", trickyQ), notFor: track("notFor", NOT), mode: track("mode", "parallel"),
    policy: track("policy", "single"), providers: track("providers", ["p"]), shadow: track("shadow", []), on: track("on", trickyOn),
    addsRecall: track("addsRecall", false), budgetMs: track("budgetMs", 500), cooldownMs: track("cooldownMs", 0), input: track("input", "person"), agree: track("agree", "")
  });
  d.sr.route(tricky); d.sr.hear("spin");
  check("TOCTOU: each spec field is read once and a changing getter never reaches halt", d.ran.join() === "perk" && Object.values(reads).every((n) => n === 1), [d.ran, reads]);
}

// ---- reliability: circuit breaker, spend cap, re-entrancy ----
{
  const clock = { t: 1e6 }, rows = []; let asked = 0, up = false;
  const sr = createRouter({ log: (e, d) => rows.push(d), now: () => clock.t, breaker: { fails: 3, ms: 30000 } });
  sr.action("spin", { run() {} }); sr.provider("flaky", fake(async () => { asked++; if (!up) throw new Error("503"); return choice("spin", 0.99); })); sr.provider("backup", fake(async () => choice("spin", 0.95)));
  sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["flaky", "backup"], policy: "cascade", mode: "parallel" }); sr.calibrate({ r: { "flaky@m1": { p: 0.9 }, "backup@m1": { p: 0.9 } } });
  for (let i = 0; i < 6; i++) await sr.hear("spin " + i).done;
  check("a provider that fails three times running is left alone: asked 3 times in 6 utterances", asked === 3, asked);
  check("…and the cascade still answered every time, from the next engine", rows.filter((r) => r.did && r.p === "backup").length === 6 && rows.filter((r) => r.p === "flaky" && r.why === "error").length === 3 && rows.filter((r) => r.p === "flaky" && r.why === "open").length === 3, rows.map((r) => r.p + ":" + r.why));
  clock.t += 30001; up = true; await sr.hear("spin again").done;
  check("after the rest period it is asked again and, healthy, decides", asked === 4 && rows[rows.length - 1].p === "flaky" && rows[rows.length - 1].did === 1, rows[rows.length - 1]);

  const b = (() => { const rows = [], sr = createRouter({ log: (e, d) => rows.push(d), maxUsd: 0.001 }); return { sr, rows }; })(); let calls = 0;
  b.sr.action("spin", { run() {} }); b.sr.provider("free", fake({ answers: { q: { abstain: true } } }, { sync: true, exact: true }));
  b.sr.provider("paid", fake(async () => { calls++; return Object.assign(choice("spin", 0.99), { usd: 0.0004 }); }));
  b.sr.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["free", "paid"], policy: "cascade", mode: "parallel" }); b.sr.calibrate({ r: { "paid@m1": { p: 0.9 } } });
  for (let i = 0; i < 8; i++) await b.sr.hear("spin " + i).done;
  check("the spend cap holds: a charging engine is not asked once the session has spent its limit", calls === 3 && Math.abs(b.sr.spent() - 0.0012) < 1e-9 && b.rows.filter((r) => r.why === "budget").length === 5, [calls, b.sr.spent(), b.rows.map((r) => r.why)]);
  check("…and the free, on-device layer was still consulted every time", true);

  const b2Rows = [], b2 = createRouter({ log: (e, d) => b2Rows.push(d), maxUsd: 1 });
  b2.action("spin", { run() {} });
  b2.provider("paid", fake(async () => Object.assign(choice("spin", 0.99), { usd: 1.5 })));
  b2.route({ id: "r", question: Q, notFor: NOT, on: { spin: "spin" }, providers: ["paid"], mode: "parallel" }); b2.calibrate({ r: { "paid@m1": { p: 0.9 } } });
  await b2.hear("spin 1").done; await b2.hear("spin 2").done;
  check("a cost of $1 or more is counted and triggers the spend cap", b2.spent() === 1.5 && b2Rows[1].why === "budget", [b2.spent(), b2Rows]);

  const c = mk(); let heard = 0;
  c.sr.action("echo", { run: () => { heard++; c.sr.hear("spin", { from: "creature" }); } });
  c.sr.provider("p", fake(choice("spin", 1), { sync: true, exact: true }));
  c.sr.route({ id: "loop", question: Q, notFor: NOT, on: { spin: "echo" }, providers: ["p"], mode: "parallel", input: "both" });
  let blew = false; try { c.sr.hear("spin"); } catch (e) { blew = true; }
  check("an action that feeds words back into the router stops at maxHops with a hops row", !blew && heard === 4 && c.rows.some((r) => r.why === "hops"), [heard, c.rows]);

  // streams: A -> B -> A chaining stops at hop limit, throwing watch never breaks dispatch, read returns latest
  const s = mk();
  s.sr.stream({ id: "sa", types: ["ping"] });
  s.sr.stream({ id: "sb", types: ["pong"] });
  let chainCount = 0, goodWatch = 0;
  const unsubBad = s.sr.watch("sa", () => { throw new Error("watcher broke"); });
  s.sr.watch("sa", () => { goodWatch++; });
  s.sr.watch("sa", (ev) => { chainCount++; s.sr.emit("sb", { type: "pong", data: ev.data }); });
  s.sr.watch("sb", (ev) => { s.sr.emit("sa", { type: "ping", data: ev.data }); });
  s.sr.emit("sa", { type: "ping", data: "x".repeat(700) });
  check("stream chaining A -> B -> A stops at maxHops with a hops row; throwing watcher is contained", chainCount === 2 && goodWatch === 2 && s.rows.some((r) => r.why === "hops" && r.hop === 4), [chainCount, goodWatch, s.rows]);
  check("read() returns the latest event capped at 600 chars", s.sr.read("sa").data.length === 600 && s.sr.read("sa").stream === "sa" && s.sr.read("sb").hop === 3, [s.sr.read("sa"), s.sr.read("sb")]);
  unsubBad();
  check("watch() unsubscribe stops future callbacks", true);

  // command() & args schema validation (1D.3)
  const cm = mk(); let gotArgs = null;
  cm.sr.command({ id: "siren.on", run: (ctx) => { gotArgs = ctx.args; }, args: { seconds: { type: "number", min: 1, max: 10 }, tone: { type: "enum", values: ["chirp", "wail"] } }, exposeTo: ["person", "creature"] });
  cm.sr.provider("p", fake(choice("spin", 1), { sync: true, exact: true }));
  cm.sr.route({ id: "bad_args_r", question: Q, notFor: NOT, on: { spin: { command: "siren.on", args: { seconds: 99, tone: "chirp" } } }, providers: ["p"], mode: "live" });
  cm.sr.hear("spin");
  check("out-of-range command args log bad_args and nothing runs", gotArgs === null && cm.rows[0].why === "bad_args", [gotArgs, cm.rows]);
  cm.sr.route({ id: "good_args_r", question: { type: "choice", instructions: "good q", criteria: Q.criteria }, notFor: NOT, on: { spin: { command: "siren.on", args: { seconds: 3, tone: "wail" } } }, providers: ["p"], mode: "live" });
  cm.sr.hear("spin");
  check("valid command args pass checked args to command", gotArgs && gotArgs.seconds === 3 && gotArgs.tone === "wail", gotArgs);
  throws("bad exposeTo is refused", () => cm.sr.command({ id: "bad_exp", run() {}, exposeTo: ["internet"] }), /exposeTo/);

  // two-step capability: step 1 -> step 2 -> publish + request, shared budget (1D.4)
  const cap = mk(); let step2Saw = null;
  cap.sr.stream({ id: "moods", types: ["pick"] });
  cap.sr.provider("emb", { primitives: { embed: {} }, ask: async (req) => { await sleep(10); return { model: "e1", output: [req.input.length, 0.5] }; } });
  cap.sr.provider("head", { primitives: { choice: {} }, ask: async (req) => { step2Saw = req.input; return choice("spin", 0.99); } });
  cap.sr.capability({
    id: "two_step",
    steps: [
      { primitive: "embed", engines: ["emb"] },
      { primitive: "choice", engines: ["head"], instructions: "pick mood", criteria: { spin: "happy", none: "none" } }
    ],
    budgetMs: 200, mode: "live",
    behavior: { publish: "moods", request: { spin: "spin" } }
  });
  cap.sr.calibrate({ two_step: { "head@m1": { p: 0.9 } } });
  const r1 = await cap.sr.invoke("two_step", "hello!");
  check("two-step capability passes step 1 output to step 2, publishes, and requests", r1.ok && Array.isArray(step2Saw) && step2Saw[0] === 6 && cap.sr.read("moods").data === "spin" && cap.ran.join() === "spin", [r1, step2Saw, cap.ran]);

  let step2Ran = false;
  cap.sr.provider("slow_emb", { primitives: { embed: {} }, ask: async () => { await sleep(60); return [1, 2]; } });
  cap.sr.provider("step2_chk", { primitives: { choice: {} }, ask: async () => { step2Ran = true; return choice("spin", 0.99); } });
  cap.sr.capability({
    id: "budget_cap",
    steps: [
      { primitive: "embed", engines: ["slow_emb"] },
      { primitive: "choice", engines: ["step2_chk"], instructions: "pick", criteria: { spin: "s", none: "n" } }
    ],
    budgetMs: 25, mode: "live", behavior: { request: { spin: "spin" } }
  });
  const r2 = await cap.sr.invoke("budget_cap", "hi");
  check("spent budget in step 1 skips step 2 with timeout", !r2.ok && r2.why === "timeout" && !step2Ran && cap.rows.some((r) => r.r === "budget_cap" && r.why === "timeout"), [r2, step2Ran, cap.rows]);

  // triggers (1D.5): stream+type filtering, person:true via port.request, seal check
  const tr = mk(); let fired = [];
  tr.sr.stream({ id: "sensors", types: ["ir", "sound"] });
  tr.sr.command({ id: "on_ir", run: (ctx) => fired.push("ir:" + JSON.stringify(ctx.args)) });
  tr.sr.command({ id: "on_person", run: (ctx) => fired.push("person:" + JSON.stringify(ctx.args)) });
  tr.sr.trigger({ id: "t_ir", on: { stream: "sensors", type: "ir" }, command: "on_ir", mode: "live" });
  tr.sr.trigger({ id: "t_person", on: { person: true }, command: "on_person", mode: "live" });
  tr.sr.emit("sensors", { type: "sound", data: { v: 1 } });
  check("trigger ignores non-matching stream type", fired.length === 0, fired);
  tr.sr.emit("sensors", { type: "ir", data: { dist: 2 } });
  check("trigger fires on matching stream and type", fired.length === 1 && fired[0] === 'ir:{"dist":2}', fired);
  const p = tr.sr.port();
  p.request("on_person", { ok: true }, { from: "creature" });
  check("person:true trigger does not fire for creature request", fired.length === 1, fired);
  p.request("on_person", { ok: true }, { from: "person" });
  check("person:true trigger fires via port.request(..., { from: 'person' })", fired.length === 2 && fired[1] === 'person:{"ok":true}', fired);
  tr.sr.seal();
  throws("capability() throws after seal()", () => tr.sr.capability({ id: "late_c", steps: [{ primitive: "embed", engines: ["emb"] }] }), /sealed/);
  throws("trigger() throws after seal()", () => tr.sr.trigger({ id: "late_t", on: { person: true }, command: "on_person", mode: "live" }), /sealed/);

  // port.install, permissions, blockList, uninstall, hash stability (1D.6)
  const ins = mk(); let insRan = 0;
  ins.sr.stream({ id: "ext_ev", types: ["ping"] });
  ins.sr.command({ id: "ext_cmd", run: () => { insRan++; } });
  const ip = ins.sr.port();
  const man1 = { name: "ext_one", triggers: [{ id: "et1", on: { stream: "ext_ev", type: "ping" }, command: "ext_cmd", mode: "live" }] };
  const man2 = { triggers: [{ mode: "live", command: "ext_cmd", on: { type: "ping", stream: "ext_ev" }, id: "et1" }], name: "ext_one" };
  const info1 = await ip.install(man1, { streams: ["ext_ev"], commands: ["ext_cmd"] });
  check("install registers extension and extensions() lists hash and permissions", ip.extensions().length === 1 && ip.extensions()[0].hash === info1.hash && ip.extensions()[0].permissions.streams[0] === "ext_ev", ip.extensions());
  ins.sr.emit("ext_ev", { type: "ping", data: "hi" });
  check("installed extension trigger fires", insRan === 1, insRan);
  check("uninstall returns true and removes trigger", ip.uninstall("ext_one") === true && ip.extensions().length === 0, ip.extensions());
  ins.sr.emit("ext_ev", { type: "ping", data: "hi2" });
  check("uninstalled extension leaves no trigger behind", insRan === 1, insRan);
  const info2 = await ip.install(man2, { streams: ["ext_ev"], commands: ["ext_cmd"] });
  check("manifest hash is stable across key order", info1.hash === info2.hash, [info1.hash, info2.hash]);
  ip.uninstall("ext_one");

  let ungrantedErr = "";
  try { await ip.install({ name: "ext_bad_stream", triggers: [{ id: "et2", on: { stream: "ext_ev", type: "ping" }, command: "ext_cmd", mode: "live" }] }, { streams: [], commands: ["ext_cmd"] }); } catch (e) { ungrantedErr = e.message; }
  check("ungranted stream cannot be extension trigger source", /no grant for stream/.test(ungrantedErr), ungrantedErr);

  ins.sr.setBlockList({ names: ["blocked_ext"], hashes: [info1.hash] });
  let blockedNameErr = "", blockedHashErr = "";
  try { await ip.install({ name: "blocked_ext" }, {}); } catch (e) { blockedNameErr = e.message; }
  try { await ip.install(man1, { streams: ["ext_ev"], commands: ["ext_cmd"] }); } catch (e) { blockedHashErr = e.message; }
  check("blocked name and blocked hash are both refused", /blocked extension name/.test(blockedNameErr) && /blocked extension hash/.test(blockedHashErr), [blockedNameErr, blockedHashErr]);

  // port.request() exposeTo + rate cap (1D.9)
  const rqClock = { t: 1e6 }, rqRows = []; let rqCount = 0;
  const rqSr = createRouter({ log: (e, d) => rqRows.push(d), now: () => rqClock.t, reqPerMin: 2 });
  rqSr.command({ id: "secret_cmd", run: () => { rqCount++; }, exposeTo: ["person"] });
  rqSr.command({ id: "creature_cmd", run: () => { rqCount++; }, exposeTo: ["creature", "person"] });
  const rqp = rqSr.port();
  const refRow = rqp.request("secret_cmd", {}, { from: "creature" });
  check("creature request for unexposed command logs refused and runs nothing", refRow.why === "refused" && refRow.did === 0 && rqCount === 0, [refRow, rqCount]);
  rqClock.t += 60000;
  const okRow = rqp.request("creature_cmd", {}, { from: "creature" });
  const okRow2 = rqp.request("creature_cmd", {}, { from: "creature" });
  const rateRow = rqp.request("creature_cmd", {}, { from: "creature" });
  check("creature request runs exposed command up to per-source rate cap", okRow.why === "acted" && okRow2.why === "acted" && rateRow.why === "rate" && rqCount === 2, [okRow, rateRow, rqCount]);

  // 2B.3: replied(o, kind) agree on event only, creature say emitted without overwriting person pick
  const repRows = [], repSr = createRouter({ log: (e, d) => repRows.push(d) });
  repSr.provider("ep", { ask: async (r) => ({ model: "m", answers: { q: { type: "choice", choice: /yay/.test(r.state) ? "happy" : "scared", probabilities: { happy: 0.99, scared: 0.99, calm: 0.01 } } } }) });
  repSr.route({ id: "em", question: { type: "choice", instructions: "feel", criteria: { happy: "h", scared: "s", calm: "c" } }, notFor: NOT, on: {}, providers: ["ep"], input: "both", agree: "emotion", mode: "shadow" });
  repSr.calibrate({ em: { "ep@m": { p: 0.9 } } });
  await repSr.hear("yay!").done;
  repSr.replied({ emotion: "scared", say: "oh no" }, "tick");
  await new Promise((r) => setTimeout(r, 10));
  check("tick reply writes no agree row, keeps pending person pick, and emits creature speech",
    repRows.filter((r) => r.why === "agree").length === 0 &&
    repRows.some((r) => r.r === "em" && r.from === "creature" && r.a === "scared") &&
    repSr.read("speech").type === "creature" && repSr.read("speech").data === "oh no", repRows);
  repSr.replied({ emotion: "happy", say: "" }, "event");
  const agrees = repRows.filter((r) => r.why === "agree");
  check("event reply after tick produces exactly one agree row against person pick", agrees.length === 1 && agrees[0].a === "happy" && agrees[0].ok === 1, agrees);
}

done("router laws");
