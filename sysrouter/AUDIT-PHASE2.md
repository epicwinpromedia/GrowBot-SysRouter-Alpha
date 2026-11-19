# SysRouter — Phase 2 audit and work order

**Status:** audit record and binding work order, 2026-11-19. **Audited:** `main` @ `2ad6542` (Phase 2, 42 commits from `7dbb684`). **Baseline:** `68c6294` (end of Phase 1). **Plan audited against:** PLAN-PHASE2 (2026-11-17), `MISSION.md` v2, `SPEC.md` v2, `REQUIREMENTS.md` v2, issues #3–#16.

**To the next agent who is allowed to change code: read this file before you change anything in `src/`, `test/`, `bench/`, `tools/`, `integration/` or `demo/`.** Every defect below was reproduced by running code against `2ad6542`. Each one has a GitHub issue that holds the reproduction. Each one is also marked at its exact location in the code by a trailing comment that starts `AUDIT-PHASE2`. Run `grep -rn "AUDIT-PHASE2" sysrouter/` to list every marked site.

**What the audit changed:** text only. It added this file, comments in code, and revisions to `SPEC.md`, `REQUIREMENTS.md`, `THREAT-MODEL.md`, `RESULTS.md`, `INTEGRATION.md` and `README.md`. It changed no executable code. The suite still passes as it did at `2ad6542`.

**What the audit did not do:** it fixed nothing in code. By B's instruction, the fixes wait until the Phase 3 plan exists. Any item may then be re-scoped. An item that Phase 3 makes moot is closed with that reason; an item that still applies is fixed as written here.

---

## 1. The state of things, in one paragraph

Phase 2 delivered most of the plan.
- **The parts that touch Brit's page are sound.** `app/` is untouched. There are three anchored insertions plus one optional one, and the funnel test shows 0 differences. The double-request guard works.
- **12 of the 14 Phase 1 issues are fixed**, each with a test and a mutant (48 mutants, all caught).
- **The new parts are not sound.** The defects sit in the v2 registry: the third-party lane, the capability pipeline and the event chain. They also sit in the documents, which had marked several broken parts `[built]`. The audit has reverted those labels.
- **Ready now:** fuzzy commands in shadow with on-device engines. **Not ready:** a live third-party lane. Emote's agreement evidence is not reliable until A12 is fixed.

## 2. Rules for the fix phase

These are the plan's §0 rules, which still apply, plus the lessons of this audit.

1. **One item per commit.** Each commit contains the change, its test, its mutant and the status flip for exactly what it fixed. The commit message names the item (`A5`) and the issue (`#19`).
2. **`node sysrouter/test/run-all.mjs` passes after every commit.** The audit ran the suite at all 42 Phase 2 commits, and two were red (§6). Run it at each commit, not only at the end.
3. **Prove a fix on the shipped path, not only by a direct call.** Three Phase 2 acceptance tests passed by calling a helper directly while the shipped path (`boot.js`, `port.install`) did something else: A13, A14 and A9. Every fix that concerns boot or the port gets a test through `boot(window)` or `sr.port()`.
4. **A law is enforced in one place.** If a check exists for routes, it must hold for capabilities, triggers, requests and installs too. A1 makes that structural; until A1 lands, every law fix must cover both pipelines.
5. **Status labels flip only with a passing test** (SPEC §0). Each `[differs]` row in SPEC §16 names the item and issue that will flip it.
6. **Line counts are checked.** `tools/doccheck.mjs` compares `src/*.js` and some `test/*.mjs` line counts with README.md and INTEGRATION.md. A commit that changes those counts updates the documents in the same commit.
7. **No changes to `app/`; zero dependencies in `src/`; no placeholders; measured numbers only; no model identifiers.** Plan rules 3–8 are unchanged.

## 3. Three resolutions the work order depends on

The audit report first called these "decisions for B". They are not new decisions: each follows from rules already in the specification. They are binding for the fix phase, and `SPEC.md` now states each one where it belongs.

### R1. Shadow holds back every behavior, publish included (SPEC §7.1, L2)

- **Source:** L2 defines shadow as "decides and logs and requests nothing", and SPEC §7.3 lists `publish`, `request` and actuation as behaviors.
- **Rule:** in shadow, a capability runs its steps and writes every engine row. It requests nothing, actuates nothing and publishes nothing. This is the "log-only first" convention (INTEGRATION.md).
- **Used by:** A4 (#25).

### R2. Brit's exposure filters the command table, never the question; developer commands get their own question (SPEC §9.2, §13.3)

- **Sources:**
  - Plan 2A.2's purpose: an unexposed command is never acted on.
  - Plan C3 and §7: a new label set needs a new dataset and retrained models, which is out of scope.
  - L3 / R-RT-6: a gate belongs to the exact question it was fitted on.
  - SPEC §14.1: opening a class never grants access to Brit's members.
- **Measured fact behind it:** the shipped n-gram engine (`src/s1-ngram.js:61`) abstains on *every* line when the question's options differ from its trained classes. The MiniLM head does the same (`src/s1-embed.js`). Reproduced: "please spin around" gives `spin` with the full question and `abstain` with only halt, follow and none. The gates in `models/gates.json` were fitted on the full 8 + none question.
- **Rules:**
  1. Brit's fuzzy question is always the trained `FUZZY.question` (8 options + `none`). It is never rebuilt.
  2. The host declares the kinds it exposes.
     - With `SysRouterHost.run`: the keys that hold functions.
     - With `SysRouterHost.command(kind, by)`: the list `SysRouterHost.commands`.
     - If `command` exists and `commands` does not: exactly `halt`, `still`, `follow` and `unfollow`, the kinds Brit's command branch handles today (`integration/proposals/apply-command.mjs`).
  3. A pick of an unexposed kind requests nothing and writes `why: "unexposed"`, `did: 0`.
  4. `did: 1` is never written for a kind the host's command path does not handle.
  5. Third-party commands exposed to fuzzy commands (plan 2A.3, SPEC §13.3 step 4) form a separate fuzzy question with its own capability id. It has no gates, so under L3 it runs in shadow until calibrated. It never changes Brit's question or gates.
- **Departure from the plan:** this replaces the *literal mechanism* in plan 2A.2 ("the option set is built from the commands the host exposed"). That mechanism cannot be met in scope without retraining. The plan's purpose is met.
- **Used by:** A13 (#28).

### R3. Third-party engines come in the manifest, as Worker source text; they are never `exact` or `inFunnel`; their decision primitives run in shadow (SPEC §5.2, §8.2, §8.4, §14.3)

- **Sources:**
  - SPEC §5.2: the engine declaration.
  - Plan 1D.7: the Worker message protocol.
  - SPEC §8.4: third-party code runs only in a Worker.
  - Plan P7: the manifest hash identifies the extension, so it must cover all code (A8).
  - L3 (no gate, no action), L8 (no third-party path to stops) and L9 (privilege is possession, never declaration).
  - MISSION §5: the path from the open lane into the system lane.
- **Rules:**
  1. **Manifest shape:** `engines: [{ id, model, primitives: { <name>: { in, out } }, worker: { source: "<ES module source text>" } }]`.
  2. **Loading:** the loader starts each engine as `new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })), { type: 'module' })`, wraps it with `workerEngine`, and registers it in the extension's lane with `owner = manifest.name`. Browsers start Workers only from same-origin, `blob:` or `data:` URLs, so the source travels as text. That also puts the code inside the manifest hash.
  3. **Forbidden flags:** `install` refuses a manifest whose engine declares `exact` or `inFunnel`.
  4. **Gates:** a third-party *decision* engine (`noul`, `choice`, `score`, `match`) has no gate in `models/gates.json`, so it never acts and runs in shadow only. Gates are fitted by Brit's lane when a contribution is adopted (MISSION §5), never declared by the extension. Other primitives (`actuate`, `sense`, `generate`, `embed`, `query`) need no gate.
  5. **Sense ownership:** a sensing engine emits only onto streams whose `owner` equals the engine's `owner`, never onto a core stream (`speech`, `body.sense`). This serves A7.
- **Used by:** A7 (#21), A8 (#22), A9 (#32).

## 4. The work order

Ordered by dependency. Each item gives: issue · where (line numbers at `2ad6542`; the `AUDIT-PHASE2` comments mark them) · what is wrong · what is required · acceptance test · mutant to add (named, plan rule 7).

### Group A — defects found by the audit

**A1 — One pipeline (#26). Do this first.**
- **Where:** `src/sysrouter.js` — `addRoute` :237–293 and `resolve()` :382–408 for routes; `addCapability` :443–498 and `resolveCapability()` :500–544 for capabilities.
- **What is wrong:** plan 1D said the v1 calls stay as "thin sugar over the v2 model", and 1D.4 said a route *is* a one-step `choice` capability plus a command table plus a trigger. Instead there are two registrations and two resolvers. The capability path lacks all of these:
  - `notFor` (R-REG-5);
  - option-count, option-name, prototype-key and size checks;
  - the 600-character instructions cap;
  - collision checks;
  - the `race` policy;
  - shadow engines;
  - one-flight-per-route staleness (L5);
  - `perMin`;
  - L8.
- **Required:**
  - `addRoute` becomes a builder that calls `addCapability` + `addCommand` (one per answer) + `addTrigger` on `speech`.
  - One validator serves every registration, and one resolver serves every capability. Plan 1D.0's `resolve(capability, input, signal)` owns policy, steps, gates, budget, breaker, spend and staleness.
  - Behavior must not change for existing routes: the whole suite passes unchanged except for row-shape tests the refactor necessarily touches.
  - Move the registration functions into `src/registry.js` while doing this (B2).
- **Acceptance:** every existing test passes, and the route-only checks above now hold for capabilities. The fuzzer generates v2 registrations (B5).
- **Mutants:** "a capability without notFor registers", "a capability step ignores race", "a capability decision about older words acts".

**A2 — The hop limit across async steps (#18).**
- **Where:** `src/sysrouter.js:131–144` (`emit` keeps the hop in the router-wide `activeHop`) and :540 (`resolveCapability` publishes after an `await`).
- **What is wrong:** a publish after any async step gets `hop: 0`. Two capabilities that publish to each other loop without end. Reproduced: 38 events per stream in 400 ms and no `hops` row.
- **Required:** the hop travels with the causal chain: `fireTrigger(tr, ev)` → `act(..., hop)` → `resolveCapability(cap, input, mode, hop)` → `emit(stream, event, hop + 1)`. The limit stays `maxHops: 3` (plan P6).
- **Acceptance:** the reproduction in #18 stops at hop 3 with one `hops` row.
- **Mutant:** "a publish after an async step resets the hop".

**A3 — L8 on capabilities (#24).**
- **Where:** `src/sysrouter.js:482–493` (reserved commands refused only for the extension lane) and :448 (`addsRecall` stored, never read).
- **What is wrong:** a capability can request a reserved command on the strength of one probabilistic engine. The same thing as a route is refused (:280).
- **Required:** a reserved command in `behavior.request` needs every engine of every step to be `exact`, or `addsRecall === true`. This falls out of A1.
- **Acceptance:** the reproduction in #24 throws at registration.
- **Mutant:** "a capability reaches a stop by probability alone".

**A4 — Shadow capabilities (#25), rule R1.**
- **Where:** `src/sysrouter.js:322` (`act()` returns `shadow` before :341 runs the capability).
- **What is wrong:** in shadow, no engine of a capability is ever asked, so no v2 capability can gather evidence.
- **Required:** in shadow, the capability runs and logs every engine row. Request, actuation and publish are all held back (R1). The trigger's own row is `why: "shadow"`, `did: 0`.
- **Acceptance:** the reproduction in #25 writes a row from engine `pz`; the publish stream is unchanged; nothing runs.
- **Mutants:** "a shadow capability publishes", "a shadow capability asks no engine".

**A5 — The exposure ceiling (#19).**
- **Where:** `src/sysrouter.js:298–306` (`normPerms`), :282, :489 and :556.
- **What is wrong:** an extension can be granted any non-reserved system command, including Brit's leg commands, which are exposed only to `person`.
- **Required:**
  - A permission may name a system-lane command only if that command's `exposeTo` includes `'third-party'`.
  - It may name a system stream only if Brit exposed it. Add `exposeTo` to stream declarations; `speech` and `body.sense` default to not exposed.
- **Acceptance:** the reproduction in #19 throws.
- **Mutant:** "an extension is granted an unexposed system command".

**A6 — `request()` and person/creature triggers (#20).**
- **Where:** `src/sysrouter.js:586–590` (triggers fire before the checks at :593–595) and :565–566 (`addTrigger` accepts `person: true` / `creature: true` for any command).
- **What is wrong:** an extension registers a `creature: true` trigger and the creature reaches a command not exposed to it.
- **Required:**
  - The `exposeTo` check and the person-grant check run first, on every path.
  - `addTrigger` refuses a `person` / `creature` source when the command's `exposeTo` lacks that source.
- **Acceptance:** the reproduction in #20 gives `why: "refused"` and runs nothing.
- **Mutant:** "a creature request reaches an unexposed command through a trigger".

**A7 — Sense events confined to the owner's streams (#21), rule R3.5.**
- **Where:** `src/sysrouter.js:216–220` and `src/worker-engine.js:89–94`.
- **What is wrong:** a Worker can post `{ sense: 'speech', type: 'person', data: … }`, which forges the person's words. It can also forge Brit's sensor events on `body.sense`.
- **Required:** a sense event is accepted only on a stream whose `owner` equals the engine's `owner`, never on a core stream. Others are dropped with a row (`why: "refused"`).
- **Acceptance:** the reproduction in #21 sees nothing on `speech` or `body.sense`.
- **Mutant:** "an attachment emits onto a stream it does not own".

**A8 — No code in manifests; the hash covers everything (#22), rule R3.**
- **Where:**
  - `src/sysrouter.js:157`, :187 (`addCommand` accepts `run` from any lane) and :628–631 (`install` passes manifest commands through);
  - `src/registry.js:64–69` (`canonJson` lets functions through as `undefined`);
  - `demo/index.html:121–129` (the mock siren uses `run`).
- **What is wrong:** third-party code runs in the page's scope, and two manifests whose `run` bodies differ hash the same.
- **Required:**
  - `install` refuses any manifest value that is not JSON: function, symbol, `undefined`, getter, class instance. Use either `canonJson` throwing on a non-JSON value, or a structured-clone round trip compared with the original.
  - `run` is accepted only from the system lane.
  - A third-party command's work is a capability whose last step is a Worker engine's `actuate` (A9).
  - Rewrite the demo's mock siren in that form.
- **Acceptance:** the reproduction in #22 is refused at install. Two manifests that differ only in Worker source hash differently.
- **Mutants:** "an extension command carries a function", "the hash ignores worker source".

**A9 — Third-party engines in the manifest (#32), rule R3.**
- **Where:** `src/sysrouter.js:611–644` (`install` has no `engines` section), :199 (`provider()` sealed, correctly), `src/worker-engine.js:134` (copies `exact` / `inFunnel` from its declaration), and `test/test_providers.mjs:171–182` (the siren test registers its engine through the system lane on an unsealed router).
- **Required:** R3 rules 1–4.
- **Acceptance:** on a **sealed** router, through `port.install` only, the mock siren with its Worker source in the manifest does IR sense → trigger → `siren.on` → `actuate` with checked arguments. A manifest engine with `exact: true` is refused.
- **Mutant:** "a third-party engine declares exact".

**A10 — Stream grants for extension routes (#30).**
- **Where:** `src/sysrouter.js:633` (`install` adds routes), `addRoute` (never reads `grants.streams`), and :418–426 (`hear()` runs every route).
- **What is wrong:** an extension with `streams: []` receives every word the person says.
- **Required:** an extension route needs `'speech'` in its grants, and creature-reading routes need the creature stream as well. This is automatic after A1, when routes become triggers.
- **Acceptance:** the reproduction in #30 writes no row for `ear_r`.
- **Mutant:** "an extension route hears speech without a grant".

**A11 — Per-extension `perMin` and `maxUsd` (#31).**
- **Where:** `src/sysrouter.js:303–305` (stored), :421 (`perMin` read only for routes); `maxUsd` is never read.
- **What is wrong:** 50 trigger firings run under `perMin: 5`, and one extension can use up the session's whole spend budget.
- **Required:**
  - One per-extension meter covers route decisions, trigger firings, capability runs and requests (`why: "rate"`).
  - Per-extension spend is tracked separately from the session total, and its paid engines are skipped with `why: "budget"` once its own `maxUsd` is reached.
- **Acceptance:** the reproduction in #31 runs 5 times, then writes `rate` rows.
- **Mutants:** "an extension trigger ignores perMin", "an extension ignores its maxUsd".

**A12 — Person and creature state kept apart (#23).**
- **Where:**
  - `src/sysrouter.js:106` (`row()` guards `lastPick` with `o.from`, which only acting rows carry);
  - :424 (`from` set only in `finish`);
  - :422 and :395 (`seqOf` / `flight` keyed by route only);
  - :440 (every reply's `say` is heard as the creature's words).
- **What is wrong:**
  - A creature row that does not act overwrites the person's pending pick. Reproduced: the agree row compares the creature's "sad" with the brain's "happy".
  - Creature words mark the person's in-flight decision `stale`.
- **Required:**
  - For `input: 'both'` routes, `lastPick`, `seqOf` and `flight` are keyed by route and speaker.
  - Every row of such a route carries `from`.
- **Acceptance:** both reproductions in #23 give the correct result: `a: 'happy', ok: 1`, and the person's decision acts or shadows instead of going `stale`.
- **Mutants:** "a creature row overwrites the person's pick", "creature words make a person decision stale".

**A13 — Fuzzy commands honour exposure (#28), rule R2.**
- **Where:**
  - `src/boot.js:57` (every kind gets a function, so nothing is ever filtered);
  - `src/fuzzy.js:48` (filter by function) and :53–61 (`extraCommands` merged into Brit's question);
  - `integration/proposals/apply-command.mjs` (handles 4 of the 8 kinds).
- **Required:** R2 rules 1–5. Add `unexposed` to SPEC §10's `why` list (already done in text).
- **Acceptance, through `boot(window)` (rule §2.3):**
  - A host exposing only `halt` and `follow`: "please spin around" gives `why: "unexposed"`, `did: 0`, and the question equals `FUZZY.question`.
  - A developer command registers its own question in shadow and leaves Brit's question and gates unchanged.
- **Mutants:** "an unexposed fuzzy pick is requested", "a developer command changes Brit's fuzzy question".

**A14 — Wire the composed emote (#29).**
- **Where:** `src/boot.js:60` (never passes `embedEngine` / `headEngine`, never loads MiniLM), `src/emote.js:48–60` (the composed capability has no trigger), and `src/sysrouter.js:437` (`replied()` loops over routes only).
- **Required:**
  - `boot.js` loads the MiniLM engine and `models/express.minilm-head.json` when the model files are present (as `demo/index.html` does under `?embed=1`).
  - It registers the composed capability with a trigger on `speech` for both speakers, with A12's speaker tagging.
  - `replied()` writes `agree` rows for capability decisions on person events.
  - The n-gram route remains the fallback when MiniLM is absent (plan 2B.2).
- **Acceptance:** `boot(window)` with the model files present gives emote decisions from `embed-emote@express.minilm-head-v1` and an `agree` row after an event reply. Without them, the n-gram route is used.
- **Mutant:** "the composed emote writes no agree row".

**A15 — Honest rows for capability-backed commands (#27).**
- **Where:** `src/sysrouter.js:163` (a missing capability is accepted) and :341–343 (`did: 1` and `acted` written before, or without, the capability running).
- **Required:**
  - A command naming an unknown capability is refused at registration, or at `seal()` / install time for forward references.
  - The trigger's row is written when the capability settles: `acted` with `did: 1` only if its behavior ran, otherwise the capability's `why`.
- **Acceptance:** the reproduction in #27 throws at registration.
- **Mutant:** "a command bound to a missing capability acts".

**A16 — SPEC counts and `doccheck` (#33).**
- **Where:** `tools/doccheck.mjs:24`, :68–71.
- **What is wrong:** `doccheck` never checks SPEC.md, and its mutant check is a hard-coded floor of 48.
- **Required:**
  - `doccheck` checks SPEC.md §0 (suite count, module count, total lines, router lines) and §3 (mutant count).
  - It reads the suite and mutant counts from `run-all`'s output, or from `test/run-all.mjs`'s `TESTS` list and `test/mutants.mjs`'s `MUTANTS`, and compares them with what the documents state.
  - **Text already corrected by the audit:** the counts in SPEC.md §0 and §3, and the figures in §8.4 and §14.3. Keep them correct as code changes.

**A17 — RESULTS.md §1 held-out sizes (#34).** **Done by the audit** (text only): wake held-out 1,410 of 2,778 lines, express 574 of 1,103. Close #34 when this file lands on `main`.

**A18 — Status labels (#35).** **Partly done by the audit:** every `[built]` label the audit found broken is reverted to `[differs]`, with its item and issue, in SPEC.md, REQUIREMENTS.md and THREAT-MODEL.md, and SPEC §2.3's permission fields are corrected. **Remaining:** flip each label back to `[built]` only in the commit that fixes it, with its test.

### Group B — smaller deviations from the plan

- **B1 — v1 names (#36).**
  - `demo/index.html:50` accepts only `?mode=parallel`.
  - `src/sysrouter.js:1–28` and `src/boot.js:7` header comments use the v1 model.
  - **Required:** the demo accepts `live` (with `parallel` as an alias), and the comments use the v2 vocabulary. Mind rule §2.6 on line counts.
- **B2 — Split the registry (#37).** `src/sysrouter.js` is 683 lines, past the plan 1D threshold of ~600. Move the registration functions into `src/registry.js`, as part of A1.
- **B3 — The MiniLM anomaly's cause (#38).** The Phase 1 file showed p50 = 0 ms at 4× and 6×. The anomaly vanished with Chromium 153 → 156, and no cause was found. **Required:** find and state the cause in RESULTS.md §5, and add a check in `bench/browser.mjs` that a throttled p50 is not below the 1× p50. If the cause cannot be found, say so in RESULTS.md §5; the audit has added that statement.
- **B4 — `replied(o)` with no kind (#39).** `src/sysrouter.js:436` treats a missing `kind` as `event`. **Required:** `agree` rows only when `kind === 'event'`.
  - **Mutant:** "a reply with no kind writes an agree row".
- **B5 — Test coverage of the v2 registry (#40).** `test/fuzz_router.mjs` generates only v1 routes, every mutant targets `src/sysrouter.js`, and no test boots `src/boot.js`. **Required:** the fuzzer generates v2 registrations, with the invariants listed in #40. Add mutants in `worker-engine.js` and `boot.js`, and a boot-path test. Do this alongside A1, because it is how A1's "behavior unchanged" claim gets checked.
- **B6 — Read each spec field once (#41).** Several v2 registration fields are read more than once; the table is in #41. **Required:** one snapshot helper in `src/registry.js`, used by every registration. **Acceptance:** a getter counter shows one read per field.

### Group C — notes that need no code

- **C1 — `request(..., { from })` trusts a declared source.** A caller of the public port says whether a request is from the person or the creature. This is inside the THREAT-MODEL T6 scope (hostile script in the page is out of scope), and Brit's own code makes the declaration in the creature-door proposal. L9 prefers possession to declaration. It is recorded as a stated residual in THREAT-MODEL.md, not as a defect.
- **C2 — Every brain reply now runs emote again.** Since 2B.3, each reply's `say`, ticks included, is heard as the creature's words, and emote decides on it. With a hosted engine configured (`?s1=`), that is one more paid call per reply, bounded by the session spend cap. It is recorded in INTEGRATION.md.

## 5. Order and dependencies

```
A1 (+B2, +B5) ─┬─▶ A3, A4, A10, A11 (largely fall out of A1; verify each)
               ├─▶ A2
               └─▶ A12 ─▶ A14
A5, A6 (independent of A1; small)
A8 ─▶ A9 ─▶ A7          (A9 gives engines an owner; A7 needs it)
A13 (independent)
A15 (after A1)
B1, B3, B4, B6 (any time; B6 with A1)
A16 ─▶ A18 last          (flip each label in the commit that earns it; A16 first so doccheck guards the rest)
```

Until A5, A6, A7 and A8 are fixed, no extension should be installed outside tests.

## 6. Process record of Phase 2

**Per-commit test runs.** The full `run-all.mjs` was run at every one of the 42 commits, each in its own worktree. 40 pass. 2 fail:
- `7dbb684` (1A.1): the mutant "an answer about older words still acts" survived, so for one commit the suite could not detect a broken L5. It was restored in `20486e2` by a new test.
- `d3ce178` (1A.4): the mutant "a registered answer table can be edited afterwards by its author" survived. It was legitimately retargeted in `758e659`, to mutate the author's own object now that `on` is copied.

**Other rules:**

| Plan rule | Result |
|---|---|
| 3 (no `app/` edits) | Kept: `git diff 68c6294 2ad6542 -- app` is empty |
| 4 (zero dependencies) | Kept: every `src/` import is a relative module |
| 5 (no placeholders) | Kept |
| 7 (named mutants) | Kept: 48 |
| 8 (no model identifiers) | Kept |

**Not kept:** rule 1 (status flips outran the code: A18), rule 6 (SPEC.md figures and one RESULTS.md count: A16, A17), and 3C.6. Nine of the fourteen issues were closed by commit keyword alone; the audit added the missing closing notes.

**Other notes:**
- The commit message of `cdd6c2c` lost "$1" to shell interpolation.
- The work landed on `main` without a pull request, so this audit was its first review.

## 7. Corrections to the plan itself

1. **The Phase 1 tables were stale relative to their own raw data.** `results/TABLES.md` at `68c6294` scored 2,170 Clef answers. 2,778 had been committed in `results/raw/` since `eaddae1`. Phase 2 regenerated the tables correctly, and the audit reproduced them byte for byte from the committed raw data (only the date line differs).
   - **Plan 3A.1's expected gate was stale:** `fuzzy.hosted@cloudflare/clef = 0.7193` is now 0.8846.
   - **Plan 3C.1's failure count was stale:** "229 of 2,170" is now 244 of 3,007.
   - Phase 2's numbers are the correct ones.
2. **The numbers given to Brit in the Phase 1 documents changed** (wake/fuzzy, held-out):

   | Figure | Phase 1 docs | Now |
   |---|---|---|
   | readers → n-gram, recall | 58.3% | 57.2% |
   | readers → n-gram, false triggers | 0.3% | 0.6% |
   | readers → Jev, recall | 95.2% | 83.3% |
   | Jev gate | 0.6401 | 0.9101 |

   The case for the hosted engines is weaker than the Phase 1 documents said. INTEGRATION.md and RESULTS.md already use the current numbers.
3. **Plan 2A.2 and 2A.3 conflict with L3 and with fixed-class on-device models.** R2 resolves this within the plan's own constraints.
4. **Plan 1D's "the v1 calls remain as thin sugar over the v2 model" was not built.** A1 builds it.

## 8. How the audit verified, so it can be repeated

- **Upstream:** `britcruise9/GrowBot` cloned. The fork's base `f1dd1b2` equals upstream `HEAD`. Outside `sysrouter/` the fork changes only `.github/workflows/sysrouter.yml`, `.gitignore` and `env.example`. The `research/CODEMAP.md` line numbers spot-checked in `app/v3/next.html` are correct.
- **Suite:** `node sysrouter/test/run-all.mjs` at `2ad6542`: 10 suites PASS — 153 router checks, 65 provider checks, 16 funnel checks, 48 mutants caught (49 checks with the harness check).
- **Report:** `node sysrouter/bench/report.mjs` in a clean copy reproduces `results/TABLES.md` and `models/gates.json` exactly, except for the date line.
- **Demo:** `demo/index.html` loaded in headless Chromium:
  - no page errors;
  - `readers_acted` rows with `?mode=parallel`;
  - the mock siren installs, lists and requests.
- **Reproductions:** 20 candidate defects were tested against `2ad6542`.
  - 18 reproduced, and are the issues above.
  - One did not reproduce (a TOCTOU on `addTrigger`'s `on.stream`: `install` catches it). It was dropped.
  - One (the gate values) was the plan's error (§7.1).
  - Each issue's body contains its reproduction.
