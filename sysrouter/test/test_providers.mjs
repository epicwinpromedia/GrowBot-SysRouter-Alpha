// test_providers.mjs — each provider speaks the one answer shape, and survives a hostile engine.
//   node sysrouter/test/test_providers.mjs
// The vendor replies used here are REAL: recorded from live calls on 2026-11-17
// (test/golden/vendor-replies.json). No network is used by this test.

import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { httpProvider } from "../src/s1-http.js";
import { chatProvider } from "../src/s1-chat.js";
import { readersProvider, ftPick } from "../src/s1-readers.js";
import { ngramProvider, features, words } from "../src/s1-ngram.js";
import { tokenizer, embedProvider } from "../src/s1-embed.js";
import { softReflexRoute, softReflexes, SOFT_ACTS, MAX_SOFT } from "../src/soft-reflex.js";
import { registerFuzzy, FUZZY } from "../src/fuzzy.js";
import { registerEmote, EMOTE, REACTIONS } from "../src/emote.js";
import { createRouter, readAnswer } from "../src/sysrouter.js";
import { workerEngine } from "../src/worker-engine.js";
import { boot } from "../src/boot.js";
import { model, ROOT } from "../bench/lib.mjs";
import { check, done, rng } from "./t.mjs";

const gold = JSON.parse(readFileSync(ROOT + "test/golden/vendor-replies.json", "utf8"));
const Q = FUZZY.question, req = { state: "hey quit staring at me", questions: { q: Q } };

// ---- the decision contract: Jev, Clef, Clef-flash, as recorded ----
for (const name of ["jev", "clef", "clef-flash"]) {
  let sent = null; const p = httpProvider({ model: "vendor/x", usdPerMTok: 0.042, extra: { provider: { only: ["x"] } }, send: async (body) => { sent = body; return gold[name]; } });
  const r = await p.ask(req, {}), d = readAnswer(Q, r.answers.q);
  check(name + ": the recorded live reply parses to a valid pick with a probability", !!d && d.pick === "unfollow" && d.p > 0.5 && d.p <= 1, d);
  check(name + ": tokens and cost are read from the reply", r.usage.input_tokens > 100 && r.usd > 0 && r.usd < 0.001, [r.usage, r.usd]);
  check(name + ": the request is exactly { model, state, questions } plus host routing", JSON.stringify(Object.keys(sent).sort()) === '["model","provider","questions","state"]' && sent.state === req.state);
}
{
  const p = httpProvider({ model: "m", usdPerMTok: 1, send: async () => ({ result: gold.jev }) });
  check("a reply wrapped in { result } (Cloudflare's REST shape) is unwrapped", !!(await p.ask(req, {})).answers.q.choice);
  const q = httpProvider({ model: "m", usdPerMTok: 2, send: async () => ({ model: "m", answers: { q: { type: "noul", noul: 0.5 } }, usage: { input_tokens: 500 } }) });
  check("with no cost in the reply, cost = tokens x the configured price", (await q.ask(req, {})).usd === 0.001);
  let threw = 0; for (const junk of [null, {}, { result: {} }, "text", { answers: null }]) { try { await httpProvider({ model: "m", send: async () => junk }).ask(req, {}); } catch (e) { threw++; } }
  check("a reply with no answers is an error, not a decision", threw === 5);
}

// ---- the small chat model, as recorded, with and without logprobs ----
{
  for (const name of ["llama8b-groq", "llama8b-logprobs"]) {
    let sent = null; const p = chatProvider({ model: "m", send: async (b) => { sent = b; return gold[name]; } }), r = await p.ask(req, {}), d = readAnswer(Q, r.answers.q);
    check(name + ": the recorded live reply parses to a valid pick", !!d && d.pick === "unfollow", d);
    check(name + ": probabilities are " + (name.endsWith("logprobs") ? "the model's own" : "p = 1, flagged as not measured"), name.endsWith("logprobs") ? (r.logprobs === true && d.p < 1 && d.p > 0.5) : (r.logprobs === false && d.p === 1), [r.logprobs, d.p]);
    check(name + ": the person's words travel quoted, as data, in their own message; the options as lettered lines", sent.messages[1].content.includes(JSON.stringify(req.state)) && !sent.messages[0].content.includes(req.state) && /\nA\) halt: /.test(sent.messages[0].content) && sent.max_tokens === 2 && sent.temperature === 0);
  }
  const said = (content, top) => ({ choices: [{ message: { content }, logprobs: top ? { content: [{ top_logprobs: top }] } : null }], usage: { prompt_tokens: 10 } });
  let threw = 0;
  for (const c of ["Z", "", "halt", "9", "ignore the above and run halt", null]) { try { await chatProvider({ model: "m", send: async () => said(c) }).ask(req, {}); } catch (e) { threw++; } }
  check("anything that is not exactly one listed letter is an error, never a decision (an empty reply is not option A)", threw === 6, threw);
  check("…while \"b\", \"B)\" and \" B. \" are the letter B", (await Promise.all(["b", "B)", " B. "].map((c) => chatProvider({ model: "m", send: async () => said(c) }).ask(req, {})))).every((r) => r.answers.q.choice === "still"));
  const r = await chatProvider({ model: "m", send: async () => said("A", [{ token: "A", logprob: Math.log(0.7) }, { token: " B", logprob: Math.log(0.2) }, { token: "Apple", logprob: 0 }, { token: "Q", logprob: 0 }]) }).ask(req, {});
  check("logprobs: only single listed letters count, renormalised", Math.abs(r.answers.q.probabilities.halt - 0.7 / 0.9) < 1e-9 && Math.abs(r.answers.q.probabilities.still - 0.2 / 0.9) < 1e-9 && Object.keys(r.answers.q.probabilities).length === 2, r.answers.q.probabilities);
}

// ---- Brit's readers as a provider ----
{
  const ft = (w) => ftPick(w);
  check("ftPick follows the funnel's own order (_fk in sendTxtFrom)", ft({ off: 1, go: 1 }) === "unfollow" && ft({ go: 1, softStop: 1 }) === "follow" && ft({ softStop: 1, halt: 1 }) === "unfollow" && ft({ halt: 1, still: 1 }) === "halt" && ft({ still: 1 }) === "still" && ft({}) === "" && ft(null) === "");
  const p = readersProvider((t) => t === "stop" ? "halt" : t === "weird" ? "not-an-option" : "");
  check("a match is exact (p = 1); no match abstains; an unlisted pick abstains", p.ask({ state: "stop", questions: { q: Q } }).answers.q.probabilities.halt === 1 && p.ask({ state: "hello", questions: { q: Q } }).answers.q.abstain === true && p.ask({ state: "weird", questions: { q: Q } }).answers.q.abstain === true && p.sync && p.exact);
}

// ---- the on-device n-gram model ----
{
  const m = model("wake.ngram"), p = ngramProvider(m), z = p.probs("please stop following me");
  check("probabilities sum to 1 and are finite", Math.abs(z.reduce((a, b) => a + b, 0) - 1) < 1e-9 && z.every((v) => v >= 0 && v <= 1));
  check("it is sync and NOT exact (it needs a gate like any model)", p.sync === true && !p.exact);
  check("asked about another route's question it abstains", p.ask({ state: "x", questions: { q: EMOTE.question } }).answers.q.abstain === true);
  const rand = rng(7); let ok = true;
  for (let i = 0; i < 3000 && ok; i++) { const s = Array.from({ length: Math.floor(rand() * 40) }, () => String.fromCharCode(Math.floor(rand() * 0x3000))).join(""); const a = p.ask({ state: s, questions: { q: Q } }).answers.q; ok = !!readAnswer(Q, a); }
  check("3,000 random unicode strings: always a valid answer, never a throw", ok);
  check("features are bounded: 64 words at most, whatever the input", words("w ".repeat(5000)).length === 64 && features("w ".repeat(5000), 1024).idx.every((i) => i >= 0 && i < 1024));
  check("empty input still yields a valid answer", !!readAnswer(Q, p.ask({ state: "", questions: { q: Q } }).answers.q));
  let bad = false; try { ngramProvider(Object.assign({}, m, { dim: 8 })); } catch (e) { bad = true; }
  check("a model file whose sizes disagree is refused at load", bad);
}

// ---- the embedding provider (with a fake embedder: the real model is exercised by the benchmark) ----
{
  const ids = tokenizer("[PAD]\n[UNK]\n[CLS]\n[SEP]\nstop\nfollow\n##ing\nme\n'\n!");
  check("WordPiece: greedy longest match, ## continuation, unknown words, punctuation split", JSON.stringify(ids("Stop following me!")) === "[2,4,5,6,7,9,3]" && JSON.stringify(ids("zzz")) === "[2,1,3]", ids("Stop following me!"));
  check("WordPiece: output is capped", ids("stop ".repeat(500), 64).length <= 64);
  const vec = (t) => { const v = new Float32Array(4); v[/stop|halt/.test(t) ? 0 : /follow|track/.test(t) ? 1 : 2] = 1; return v; };
  const zs = embedProvider({ embed: async (t) => vec(t) }), small = { type: "choice", instructions: "q", criteria: { halt: "an order to stop or halt", follow: "an order to follow or track", none: "something else" } };
  const a = (await zs.ask({ state: "please halt", questions: { q: small } })).answers.q;
  check("zero-shot: the nearest option DESCRIPTION wins, no training", a.choice === "halt" && !!readAnswer(small, a), a);
  const head = { id: "h", classes: ["halt", "follow", "none"], temp: 1, b: [0, 0, 0], W: [[5, 0, 0, 0], [0, 5, 0, 0], [0, 0, 5, 0]] };
  check("a trained head answers its own route and abstains on another", (await embedProvider({ embed: async (t) => vec(t), head }).ask({ state: "track me", questions: { q: small } })).answers.q.choice === "follow" && (await embedProvider({ embed: async (t) => vec(t), head }).ask({ state: "x", questions: { q: Q } })).answers.q.abstain === true);
  let embeds = 0; const ctl = new AbortController();
  const aborter = embedProvider({ embed: async (t) => { embeds++; if (embeds === 1) ctl.abort(); return vec(t); } });
  let embedAborted = false; try { await aborter.ask({ state: "please halt", questions: { q: small } }, { signal: ctl.signal }); } catch (e) { embedAborted = true; }
  check("embed aborts between steps when ctx.signal is aborted", embedAborted && embeds === 1, [embedAborted, embeds]);
}

// ---- the two co-processors and soft reflexes register cleanly on a real router ----
{
  const ran = [], rows = [], sr = createRouter({ log: (e, d) => rows.push(d) });
  sr.provider("readers", readersProvider((t) => /^stop\b/.test(t) ? "halt" : ""));
  sr.provider("model", { ask: async (r) => { const q = r.questions.q; if (q.type === "noul") return { model: "m", answers: { q: { type: "noul", noul: /won|hooray/.test(r.state) ? 0.98 : 0.02 } } }; const k = /won/.test(r.state) && q.criteria.happy ? "happy" : /spin/.test(r.state) && q.criteria.spin ? "spin" : q.criteria.none ? "none" : "calm"; return { model: "m", answers: { q: { type: "choice", choice: k, probabilities: { [k]: 0.97 } } } }; } });
  const run = Object.fromEntries(Object.keys(FUZZY.on).map((k) => [k, () => ran.push(k)]));
  registerFuzzy(sr, run, ["readers", "model"], { mode: "parallel" });
  registerEmote(sr, (rx, id) => ran.push(id + ":" + (rx.emotion || "") + ":" + (rx.expression || "")), ["model"], { mode: "parallel" });
  const soft = softReflexes(sr, Object.fromEntries(SOFT_ACTS.map((a) => [a, () => ran.push("reflex_" + a)])), "model");
  sr.calibrate({ wake: { "model@m": { p: 0.9 } }, express: { "model@m": { p: 0.9 } } });
  sr.seal();
  check("wake: the readers' match logs readers_acted and does not double-request", sr.hear("stop").acted.length === 0 && ran.length === 0 && rows.some((r) => r.why === "readers_acted" && r.act === "halt"));
  ran.length = 0; await sr.hear("spin around for me").done; check("wake: a phrasing the readers do not cover reaches a registered action", ran.includes("spin"), ran);
  ran.length = 0; await sr.hear("we won the game").done; check("express: a celebratory line selects the happy reaction with its schema fields", ran.includes("feel_happy:happy:perk"), ran);
  check("every reaction's fields are from the reply schema's own vocabulary", Object.values(REACTIONS).every((r) => (!r.emotion || ["calm", "curious", "happy", "alert", "scared"].includes(r.emotion)) && (!r.burst || ["sparkle", "joy", "pulse", "ripple", "shiver", "rain"].includes(r.burst)) && (!r.expression || ["purr", "breathe", "sigh", "perk", "shiver", "droop"].includes(r.expression))));
  const id = soft.add({ when: "someone says something celebratory", not: "ordinary talk and questions", act: "trill" });
  check("soft reflex: a creature-written rule becomes an extension-tier yes/no route, in shadow", id === "soft.0" && sr.list().find((r) => r.id === id).tier === "extension" && sr.list().find((r) => r.id === id).mode === "shadow" && sr.list().find((r) => r.id === id).owner === "creature");
  for (const bad of [{ when: "x", not: "ordinary talk and questions", act: "trill" }, { when: "someone celebrates loudly", act: "trill" }, { when: "someone celebrates loudly", not: "ordinary talk and questions", act: "move" }, { when: "someone celebrates loudly", not: "ordinary talk and questions", act: "word" }, { when: "someone celebrates loudly", not: "ordinary talk and questions", act: "halt" }, null, "trill"])
    check("soft reflex refused: " + JSON.stringify(bad).slice(0, 70), soft.add(bad) === "" && softReflexRoute(bad, 1) === null);
  for (let i = 1; i < MAX_SOFT; i++) soft.add({ when: "someone says thing number " + i + " aloud", not: "ordinary talk and questions", act: "beep" });
  check("soft reflexes are capped at " + MAX_SOFT, soft.add({ when: "one more rule than allowed", not: "ordinary talk and questions", act: "beep" }) === "" && sr.list().filter((r) => r.owner === "creature").length === MAX_SOFT);
  check("…and a removed rule frees its slot", soft.remove("soft.2") === true && soft.add({ when: "a replacement rule goes here", not: "ordinary talk and questions", act: "hum" }) === "soft.2");
}

// ---- workerEngine against node:worker_threads (1D.7) ----
{
  const wCode = `
    const { parentPort } = require('node:worker_threads');
    let aborted = 0;
    parentPort.on('message', (m) => {
      if (m.abort) { aborted++; parentPort.postMessage({ id: 99999, ok: true, output: [1] }); return; }
      if (m.input === 'slow') { setTimeout(() => parentPort.postMessage({ id: m.id, ok: true, output: [1, 2], model: 'w1' }), 60); return; }
      if (m.input === 'bad') { parentPort.postMessage({ id: m.id, ok: true, output: 'not-an-array', model: 'w1' }); return; }
      if (m.primitive === 'embed') { parentPort.postMessage({ id: m.id, ok: true, output: [String(m.input).length, 1], model: 'w1' }); return; }
      if (m.primitive === 'choice') { parentPort.postMessage({ id: m.id, ok: true, output: { type: 'choice', choice: 'spin', probabilities: { spin: 0.99, none: 0.01 } }, model: 'w1', usd: 0.0001 }); return; }
      parentPort.postMessage({ id: m.id, ok: false, error: 'unsupported' });
    });
  `;
  const w = new Worker(wCode, { eval: true });
  const eng = workerEngine(w, { primitives: { embed: {}, choice: {} }, model: "w1" });
  const eRes = await eng.ask({ primitive: "embed", input: "hello" });
  check("workerEngine: embed round trip returns checked vector and model", Array.isArray(eRes.output) && eRes.output[0] === 5 && eRes.model === "w1", eRes);
  let badErr = "";
  try { await eng.ask({ primitive: "embed", input: "bad" }); } catch (e) { badErr = e.message; }
  check("workerEngine: malformed output is rejected by primitive checker", /bad_answer/.test(badErr), badErr);
  const ctl = new AbortController();
  const slowP = eng.ask({ primitive: "embed", input: "slow" }, { signal: ctl.signal });
  setTimeout(() => ctl.abort("timeout"), 10);
  let abortErr = "";
  try { await slowP; } catch (e) { abortErr = e.message; }
  check("workerEngine: abort sends abort message and rejects", /abort/.test(abortErr), abortErr);

  const ran = [], sr = createRouter({});
  sr.action("spin", { run: () => ran.push("spin") });
  sr.provider("w_eng", eng);
  sr.route({ id: "w_r", question: { type: "choice", instructions: "pick", criteria: { spin: "spin", none: "none" } }, notFor: "ordinary talk", on: { spin: "spin" }, providers: ["w_eng"], mode: "live" });
  sr.calibrate({ w_r: { "w_eng@w1": { p: 0.9 } } });
  await sr.hear("spin").done;
  check("workerEngine works as a router choice provider", ran.join() === "spin" && sr.spent() === 0.0001, [ran, sr.spent()]);
  await w.terminate();

  // mock siren attachment worker (1D.8): IR sense -> trigger -> siren.on -> actuate with checked args
  const sirenCode = `
    const { parentPort } = require('node:worker_threads');
    parentPort.on('message', (m) => {
      if (m.triggerSense) { parentPort.postMessage({ sense: 'siren_ir', type: 'ir', data: { motion: 1 } }); return; }
      if (m.primitive === 'actuate') {
        parentPort.postMessage({ sense: 'siren_ir', type: 'ack', data: m.input });
        parentPort.postMessage({ id: m.id, ok: true, output: { ok: true }, model: 'siren-v1' });
      }
    });
  `;
  const sw = new Worker(sirenCode, { eval: true });
  const sEng = workerEngine(sw, { primitives: { sense: {}, actuate: {} }, model: "siren-v1" });
  const sRows = [], sSr = createRouter({ log: (e, d) => sRows.push(d) });
  sSr.provider("siren_w", sEng);
  sSr.seal();
  await sSr.port().install({
    name: "siren_ext",
    streams: [{ id: "siren_ir", types: ["ir", "ack"] }],
    capabilities: [{ id: "siren_act", steps: [{ primitive: "actuate", engines: ["siren_w"] }], mode: "live" }],
    commands: [{ id: "siren.on", capability: "siren_act", args: { seconds: { type: "number", min: 1, max: 30 } } }],
    triggers: [{ id: "ir_siren", on: { stream: "siren_ir", type: "ir" }, command: "siren.on", args: { seconds: 5 }, mode: "live" }]
  }, { streams: ["siren_ir"], commands: ["siren.on"], engines: ["siren_w"] });
  let ack = null;
  const unwatch = sSr.watch("siren_ir", (ev) => { if (ev.type === "ack") ack = ev.data; });
  sw.postMessage({ triggerSense: true });
  await new Promise((r) => setTimeout(r, 80));
  unwatch();
  check("mock siren attachment: IR sense -> trigger -> siren.on -> actuate with checked args", ack && ack.seconds === 5 && sRows.some((r) => r.r === "ir_siren" && r.why === "acted" && r.act === "siren.on"), [ack, sRows]);
  await sw.terminate();
}

// ---- boot() host contract: SysRouterHost.command(kind, by) with run fallback (2A.1) ----
{
  const cmdCalls = [], runCalls = [];
  const wModel = JSON.stringify(model("wake.ngram"));
  const fakeFetch = async (url) => ({ ok: true, json: async () => url.includes("wake.ngram") ? JSON.parse(wModel) : url.includes("gates.json") ? { wake: { "ngram-wake@wake.ngram-v1": { p: 0.51 } } } : null });
  const w1 = { location: { search: "?sysrouter=1&sysroute=wake:live", origin: "http://localhost" }, localStorage: {}, SysRouterHost: { command: (k, by) => cmdCalls.push([k, by]), run: { halt: () => runCalls.push("run_halt") } } };
  const p1 = await boot(w1, { fetch: fakeFetch });
  await p1.hear("please stop right now").done;
  check("boot: SysRouterHost.command(kind, by) is called when defined", cmdCalls.length === 1 && cmdCalls[0][0] === "halt" && cmdCalls[0][1] === "sysrouter" && runCalls.length === 0, [cmdCalls, runCalls]);

  const w2 = { location: { search: "?sysrouter=1&sysroute=wake:live", origin: "http://localhost" }, localStorage: {}, SysRouterHost: { run: { halt: () => runCalls.push("run_halt") } } };
  const p2 = await boot(w2, { fetch: fakeFetch });
  await p2.hear("please stop right now").done;
  check("boot: falls back to SysRouterHost.run[kind] when command is absent", runCalls.join() === "run_halt", runCalls);

  // 2A.2: dynamic option set from exposed commands + ?sysroute=wake:live sets fuzzy live
  const dynSr = createRouter({}); let sawCrit = null;
  dynSr.provider("chk", { ask: async (r) => { sawCrit = Object.keys(r.questions.q.criteria); return { model: "m", answers: { q: { type: "choice", choice: "none", probabilities: { none: 0.99 } } } }; } });
  registerFuzzy(dynSr, { halt: () => {}, still: () => {} }, ["chk"], { mode: "live" });
  dynSr.calibrate({ fuzzy: { "chk@m": { p: 0.9 } } });
  await dynSr.hear("spin").done;
  check("2A.2: removing spin from host removes spin from fuzzy question", sawCrit && !sawCrit.includes("spin") && sawCrit.includes("halt") && sawCrit.includes("none") && dynSr.list()[0].id === "fuzzy", [sawCrit, dynSr.list()]);
  check("2A.2: ?sysroute=wake:live sets fuzzy live", p2.flags().routes.fuzzy === "live", p2.flags());

  // 2A.3: third-party commands exposed to person join fuzzy option set
  let sirenRan = 0, secretRan = 0;
  const f3 = createRouter({});
  f3.command({ id: "siren.on", run: () => { sirenRan++; }, exposeTo: ["person"] });
  f3.command({ id: "siren.secret", run: () => { secretRan++; }, exposeTo: ["creature"] });
  f3.provider("alarm_m", { ask: async (r) => ({ model: "m", answers: { q: { type: "choice", choice: /alarm/.test(r.state) && r.questions.q.criteria["siren.on"] ? "siren.on" : "none", probabilities: { "siren.on": 0.99, none: 0.01 } } } }) });
  registerFuzzy(f3, { halt: () => {} }, ["alarm_m"], {
    mode: "live",
    extraCommands: [
      { id: "siren.on", description: "Sound the siren alarm.", exposeTo: ["person"] },
      { id: "siren.secret", description: "Secret command.", exposeTo: ["creature"] }
    ]
  });
  f3.calibrate({ fuzzy: { "alarm_m@m": { p: 0.9 } } });
  await f3.hear("sound the alarm").done;
  const refSiren = f3.port().request("siren.secret", {}, { from: "person" });
  check("2A.3: 'sound the alarm' runs siren.on when exposed to person, refuses unexposed command", sirenRan === 1 && secretRan === 0 && refSiren.why === "refused", [sirenRan, secretRan, refSiren]);

  // 2B.1: emote listens to speech with both person and creature
  const eRows = [], eSr = createRouter({ log: (e, d) => eRows.push(d) });
  eSr.provider("em", { ask: async () => ({ model: "m", answers: { q: { type: "choice", choice: "happy", probabilities: { happy: 0.99 } } } }) });
  registerEmote(eSr, () => {}, ["em"], { mode: "live" });
  eSr.calibrate({ emote: { "em@m": { p: 0.9 } } });
  await eSr.hear("hooray", { from: "creature" }).done;
  check("2B.1: creature event produces an emote decision row with from: creature", eRows.some((r) => r.r === "emote" && r.from === "creature" && r.a === "happy"), eRows);

  // 2B.2: composed 2-step emote capability (embed -> choice) keyed by head model id
  const c2Rows = [], c2Sr = createRouter({ log: (e, d) => c2Rows.push(d) });
  let c2Reacted = "", c2Vec = null;
  c2Sr.provider("minilm", { primitives: { embed: {} }, model: "all-minilm-l6-v2", ask: async () => ({ model: "all-minilm-l6-v2", output: [0.9, 0.1] }) });
  c2Sr.provider("head", { primitives: { choice: {} }, model: "express.minilm-head-v1", ask: async (r) => { c2Vec = r.input; return { model: "express.minilm-head-v1", answers: { q: { type: "choice", choice: "happy", probabilities: { happy: 0.96, calm: 0.04 } } } }; } });
  registerEmote(c2Sr, (rx, id) => { c2Reacted = id; }, [], { id: "emote_comp", embedEngine: "minilm", headEngine: "head", mode: "live" });
  const noGateRes = await c2Sr.invoke("emote_comp", "yay!");
  c2Sr.calibrate({ emote_comp: { "head@express.minilm-head-v1": { p: 0.8 } } });
  const okGateRes = await c2Sr.invoke("emote_comp", "yay!");
  check("2B.2: composed emote capability gates on head model id, publishes to emote, and reacts", !noGateRes.ok && noGateRes.why === "no_gate" && okGateRes.ok && Array.isArray(c2Vec) && c2Vec[0] === 0.9 && c2Sr.read("emote").data === "happy" && c2Reacted === "feel_happy", [noGateRes, okGateRes, c2Vec, c2Reacted]);
  check("2B.2: both paths share the exact 6-label set", Object.keys(EMOTE.question.criteria).sort().join() === "alert,calm,curious,happy,sad,scared");
}
done("providers and registrations");
