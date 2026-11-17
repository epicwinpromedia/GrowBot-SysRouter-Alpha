// fuzz_readers.mjs — Brit's readers and the on-device model under hostile text.
//   node sysrouter/test/fuzz_readers.mjs            30,000 strings, fixed seed
//   node sysrouter/test/fuzz_readers.mjs 300000 9   more, another seed
// The readers run on every utterance, on the main thread, before anything else. This checks
// what the router depends on when it calls them: they never throw, they always return the
// same shape, they are deterministic, and no input makes them slow (a regex that backtracks
// badly on one crafted sentence would freeze the page, and the router would inherit that).
// It reports the slowest inputs it found. It does NOT judge whether a reading is right:
// test_readers_regression.mjs does that against Brit's own documented cases.

import { loadReaders } from "../bench/slice.mjs";
import { readersProvider, ftPick } from "../src/s1-readers.js";
import { ngramProvider } from "../src/s1-ngram.js";
import { readAnswer } from "../src/sysrouter.js";
import { WAKE_ROUTE } from "../src/wakeword.js";
import { model } from "../bench/lib.mjs";
import { check, done, rng } from "./t.mjs";

const N = +process.argv[2] || 30000, SEED = +process.argv[3] || 20261117, rand = rng(SEED), R = loadReaders();
const pick = (a) => a[Math.floor(rand() * a.length)], int = (n) => Math.floor(rand() * n);
// the readers' own vocabulary, so the fuzz reaches deep into their rules instead of bouncing off the first test
const V = ["stop", "follow", "following", "me", "my face", "look", "at", "don't", "do not", "never", "ever", "no", "not", "and", "then", "but", "so", "please", "ok", "wait", "halt", "freeze", "hold still", "stop moving",
  "tracking", "face tracking", "off", "on", "again", "turn", "away", "you", "i", "said", "can't you", "won't you", "why", "if", "later", "just kidding", "never mind", "spin", "walk", "quit", "pause", "watch", "keep", "your eyes on",
  "find", "look for", "where is", "guide me", "outside", "found it", "there it is", "cancel", "enough", "it", "us", "the", "a", "want", "to", "tell", "told", "dare", "better", "kidding", "still", "start", "resume", "enable", "disable"];
const SEP = [" ", " ", " ", ", ", ". ", "! ", "? ", "; ", " - ", " … ", "\n", ""];
const ODD = ["’", "‘", "`", "\u0000", "​", "﻿", "🙂", "é", "\t", "''''", "....", "!!!!", "(", ")", "[", "\\", "$1", "%", "<b>", "‮"];
function make() {
  const k = rand();
  if (k < 0.70) return Array.from({ length: 1 + int(14) }, () => pick(V)).reduce((s, w) => s + pick(SEP) + (rand() < 0.04 ? pick(ODD) : "") + (rand() < 0.1 ? w.toUpperCase() : w));
  if (k < 0.80) return (pick(V) + pick(SEP)).repeat(1 + int(300));                                   // long repeats: the shape that makes a regex backtrack
  if (k < 0.88) return pick(["don't ", "never ", "no ", "not ", "stop ", "and ", ", ", "can't you ", "a".repeat(50) + " "]).repeat(20 + int(400)) + pick(V);
  if (k < 0.94) return Array.from({ length: int(200) }, () => String.fromCharCode(int(0x2100))).join("");
  return pick(["", " ", "\n\n", "stop".repeat(2000), " ".repeat(5000) + "stop", "stop" + " ".repeat(5000) + "following me", "don't".repeat(1000)]);
}

const FT = ["again", "go", "halt", "off", "softStop", "still"], prov = readersProvider((t) => ftPick(R._ftWords(t))), ng = ngramProvider(model("wake.ngram")), Q = WAKE_ROUTE.question;
let threw = 0, shape = 0, nondet = 0, provBad = 0, ngBad = 0; const slow = [], first = [];
for (let i = 0; i < N; i++) {
  const s = make(); let a, b, sk;
  const t0 = performance.now();
  try { a = R._ftWords(s); sk = R._seekWords(s); R._languageCommand && R._languageCommand(s); } catch (e) { threw++; if (first.length < 3) first.push({ s: s.slice(0, 80), e: e.message }); continue; }
  const ms = performance.now() - t0;
  if (slow.length < 5 || ms > slow[slow.length - 1].ms) { slow.push({ ms, len: s.length, s: s.slice(0, 60) }); slow.sort((x, y) => y.ms - x.ms); slow.length = Math.min(slow.length, 5); }
  if (!a || Object.keys(a).sort().join() !== FT.join() || FT.some((k) => typeof a[k] !== "boolean") || typeof sk.clear !== "boolean" || !(sk.goal === null || typeof sk.goal === "string")) shape++;
  b = R._ftWords(s); if (JSON.stringify(a) !== JSON.stringify(b)) nondet++;
  const pa = prov.ask({ state: s, questions: { q: Q } }).answers.q; if (!(pa.abstain === true || (readAnswer(Q, pa) && pa.probabilities[pa.choice] === 1))) provBad++;
  let na; try { na = ng.ask({ state: s, questions: { q: Q } }).answers.q; } catch (e) { na = null; } if (!na || !readAnswer(Q, na)) ngBad++;
}
check(N + " hostile strings (seed " + SEED + "): the readers never threw", threw === 0, first);
check("they always returned the same six booleans, and seek a boolean and a string-or-null", shape === 0, shape);
check("they are deterministic: the same words read the same twice", nondet === 0, nondet);
check("the readers provider always answered exact-or-abstain", provBad === 0, provBad);
check("the on-device model always returned a valid answer", ngBad === 0, ngBad);
console.log("  slowest single reads (all three readers together), ms: " + slow.map((x) => x.ms.toFixed(2) + " (" + x.len + " chars)").join(", "));
check("no input took the readers longer than 50 ms (nothing backtracks badly)", slow[0].ms < 50, slow[0]);
done("readers fuzz");
