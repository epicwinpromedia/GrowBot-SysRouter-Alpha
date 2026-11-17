# SysRouter — Phase 2 build-out plan (v2 router, two shipping capabilities, evidence)

**Status:** execution plan, 2026-11-17. Refines and completes the preliminary plan drafted by Gemini ("SysRouter v2 — Next Buildout Phase Execution Plan").
**Executes:** `SPEC.md` v2 §16 (D1–D8) and GitHub issues #3–#16.
**Builder:** Gemini. **Reviewer and finisher:** Claude. **Approver:** B.

The design is settled in `MISSION.md` v2 and `SPEC.md` v2. This plan does not reopen it. Where executing it required a decision the documents left open, the decision is listed in §2 for B to veto before work starts.

---

## 0. Rules for whoever builds this

1. **One workpackage item per commit.** Each commit contains the code change, its unit test, its mutant (where §5 lists one), and the status flips in `SPEC.md` / `REQUIREMENTS.md` for exactly what it built. The commit message names the item (`1A.3`) and the issue it closes (`#3`).
2. **`node sysrouter/test/run-all.mjs` passes after every commit.** Not just at the end of a stage.
3. **No edits to `app/`.** It is Brit's mirror (R-COMPAT-3). Any change to his page goes into `integration/apply.mjs`, applied only to a copy, or into `integration/proposals/` as a proposal (2C.4).
4. **Zero dependencies in `src/`** (R-COMPAT-1). No framework. If an item seems to need one, stop and ask.
5. **No placeholders.** No `TODO`, no stubbed branch, no "in a real implementation". An item that cannot be finished is left out of the commit and reported, not faked.
6. **Measured numbers only.** Any figure written into a document comes from a file in `results/`, a test's output, or `wc`, and the document says which.
7. **Mutants are named, not numbered.** `test/mutants.mjs` identifies each mutant by its description string. The numbers 35–44 in the Gemini draft are dropped (§1, correction C2).
8. **Model identifiers never appear in commit messages, code comments or documents**, other than the vendor model ids the engines themselves report (for example `typesafe/jev-1.14-20261014`), which are data.

## 1. Corrections to the Gemini draft

| # | The draft says | The fact | Effect on this plan |
|---|---|---|---|
| C1 | 1A.1 TOCTOU = #5; 1A.2 reserved = #6; 1A.4 gates = #4; 1A.5 spend = #9; 1A.6 holds = #10; 1C.1 race = #7; 1C.2 telemetry = #8; 3A versioned gates = #4 | The issues are: #3 late answer, **#4 race breaker**, **#5 unversioned gate**, **#6 TOCTOU**, **#7 reserved**, **#8 spend cap**, **#9 hold on act error**, **#10 cascade telemetry**, #11 reply anchor, #12 double request, #13 RESULTS.md, #14 wrong-action rate, #15 gates overwritten, #16 stale counts | Every reference below uses the real numbers. Closing an issue with the draft's numbers would close the wrong issue. |
| C2 | Mutants 35–44 with fixed numbers | `mutants.mjs` runs 34 checks today. Numbers shift whenever a mutant is added | Mutants are named (§5) |
| C3 | 2B: emote picks among `happy, sad, curious, playful, proud, scared, sleepy, calm, surprised, none` | The shipped labels are `happy, sad, scared, alert, curious, calm`: Brit's reply-schema emotions (`calm, curious, happy, alert, scared`) plus `sad` (`src/expressive.js`, `data/DATASHEET.md`). Dataset v1, both trained models, every gate and every table are built on those six | Labels are unchanged. A new label set needs a new dataset version and retrained models, which is out of scope (§7). |
| C4 | 2B step 1: a "sentiment primitive" from `s1-ngram.js` / `s1-embed.js` | No sentiment model exists. B's own tiny sentiment model is not trained yet. What exists and is measured is MiniLM embedding → trained head | Emote v2 is built as two real steps, `embed` (MiniLM) → `choice` (the trained head), which proves composition on measured engines. B's model plugs in later as configuration (2B.2). |
| C5 | 2B.3: emit `o.say` from `replied(o)`, while 2C guards `replied(o)` with `kind==="event"` | The two conflict. With the guard, the creature's words on autonomous ticks never reach emote. Separately, if creature-word decisions record `lastPick`, the next agreement row compares the brain's emotion with the emote of the creature's own previous line | The page passes `kind` to the router: `SysRouter.replied(o, kind)`, placed outside any guard. The router writes agreement rows only for `kind === "event"` and only from person-input decisions, then emits `o.say` as a creature event for every kind (2C.1, 2B.3). |
| C6 | 2A.1: "update so commands … represent Brit's full command path" | The whole command path lives in Brit's `sendTxtFrom`. This repo cannot change it (rule 3) | Split into what we build (a host contract that prefers one `command(kind, by)` entry, in 2A.1) and what we propose (a patch that factors his branch into `_applyCommand`, with a test proving the factoring changes nothing, in 2C.4) |
| C7 | 1B.3: the public port includes `release` | `release(resource)` clears a hold. On a public port, any script can clear a system hold | Kept. A hold only arbitrates the router's own requests, and Brit's layer arbitrates itself (SPEC §7.2), so the worst case is the router requesting a lower-lane command earlier than it otherwise would. `THREAT-MODEL.md` gets this as a stated residual (3C.4). |
| C8 | 1B.2 restricts registration after `seal()` to "the extension facade" | `sr.extension()` *creates* facades with arbitrary grants. Leaving it open after seal leaves the system lane's power open | After `seal()`, `extension()` throws. The only way into the third-party lane after boot is `port.install(manifest, permissions)` (1D.6). `boot.js` creates the `creature` facade for soft reflexes before `seal()`. |
| C9 | Issue #16: `test_keys.mjs` is 79 lines | `wc -l` gives 70 | Counts come from `tools/doccheck.mjs` (3C.5), never by hand |
| C10 | Issue #13: write `RESULTS.md`; 8 broken citations | Commit `7d0b344` repointed all eight citations to `results/TABLES.md` / `results/browser.json`. `RESULTS.md` still does not exist | It is written (3C.1) and becomes the README's evidence entry again |
| C11 | The draft has no item for: `generate`, `box`, Worker engines, attachments, permission visibility, the creature's request path, the optional sensor stream, the `hear()` dispatch/resolution split | All are decided in SPEC v2 (§4.2, §6.1, §8.3–8.5, §9.1, §9.4) or in the design review | Added as 1D.0, 1D.2, 1D.7–1D.9, 2C.2 and 2C.4 |

## 2. Decisions this plan makes (B: veto any before work starts)

| # | Decision | Why |
|---|---|---|
| P1 | Route and stream ids become `fuzzy` (was `wake`) and `emote` (was `express`). Flags and stored settings accept the old ids as aliases (`?sysroute=wake:live` still works), and a row's `r` is always the new id | SPEC D7. People's `localStorage` already holds `gb_sysroute=wake:…`. |
| P2 | Data artifacts keep their v1 file names: `data/v1/wake.jsonl`, `models/wake.ngram.json`, `results/raw/wake.*` | They are hashed in `data/v1/MANIFEST.json` and named in `results/`. Renaming them breaks reproducibility for no gain. `data/DATASHEET.md` states the mapping. |
| P3 | Mode `parallel` becomes `live`. `parallel` stays accepted as an alias, and the code emits only `live` | SPEC §7.1 |
| P4 | The provider flag for "Brit's funnel already acted on this match" is `inFunnel: true`, and the row is `why: "readers_acted"`, `did: 0` | SPEC §9.2, #12. One name only (the issue's `delegated` / `passive` are not used). |
| P5 | On `readers_acted` the router calls nothing. If the matched command is a stop, it still clears every router hold, because the body *was* stopped. For anything else it takes no hold and sets no cooldown, because the router requested nothing | The router's holds must describe reality: a stop the funnel ran ends what the router was holding |
| P6 | The default hop limit is `maxHops: 3`, set in `createRouter`. Events past it are dropped with `why: "hops"` | SPEC §15.4 left it open. 3 covers stream → capability → publish → one more capability. B may pick another number. |
| P7 | The manifest hash is SHA-256, by `crypto.subtle.digest`, over the canonical JSON of the manifest (keys sorted at every depth, no whitespace). It is reported as lowercase hex. `install` is therefore `async` | SPEC §9.5. WebCrypto exists in every target browser and in Node ≥ 18. |
| P8 | `generate` output is a string capped at 2,000 characters, checked like any answer. It can be published or fed to the next step, and it never selects a command by itself (L1) | SPEC §4.2, §14.7 |
| P9 | `box` is built only after its request and answer shape are verified against TypeSafe's published OpenAPI (docs.typesafe.ai/api/system-one) and one recorded live reply (needs B's TypeSafe or OpenRouter key). Until both exist, it stays `[specified]` | `research/VENDORS.md` records only that `box` exists (Jev 1.14, behind the `TypeSafe-Danger-Zone-Images` header), not its shape. Building it from guesswork breaks rule 5. |
| P10 | Third-party engines and attachment drivers run in a dedicated Worker behind one adapter, `workerEngine(worker, decl)`. The message protocol is §1D.7 | SPEC §8.4, R-TRUST-5 |

## 3. Stage 1 — the v2 router (`src/sysrouter.js`, `src/s1-*.js`)

**Objective:** the router satisfies every law L1–L11 in code, and every v2 registration exists, before any capability depends on it.

### 1A — Defects in the existing router (no dependencies)

| Item | Closes | Files | Change | Acceptance test (in `test_router.mjs` unless stated) |
|---|---|---|---|---|
| 1A.1 | #3 | `sysrouter.js`, `s1-embed.js` | (a) In `askAsync`, the fulfilment handler checks `signal.aborted` before `settle()`, mapping the reason to `stale`, `lost` (race won elsewhere) or `timeout`. (b) `askAsync` races the provider's promise against the signal's `abort` event, so a provider that never resolves still settles the route at the deadline and frees `flight[rid]`. (c) `s1-embed.js` `ask(req, ctx)` checks `ctx.signal.aborted` before and after each `embed()` and throws if aborted. | A provider ignoring `ctx.signal` that resolves after `budgetMs` runs nothing, and the row is `timeout`. A provider that never resolves still lets `out.done` resolve within `budgetMs + 50 ms`. `test_providers`: embed aborts between steps. |
| 1A.2 | #4 | `sysrouter.js` | The race winner aborts with reason `won`. Losing legs settle as `why: "lost"`. `mark()` neither counts `lost` as a failure nor resets the count on `lost` or `stale`. | 4 consecutive races where a fast engine beats a slow abort-honouring engine. The slow engine is never `open`, and on the 5th call (fast engine abstains) the slow engine acts. |
| 1A.3 | #5 | `sysrouter.js` | `gateOf(r, pid, model)` returns `g[pid + '@' + model]` only. No unversioned fallback, ever. A provider that reports no model id has no gate unless it is `exact`. | A gate fitted for `p@v1` refuses an answer reporting `v2` with `no_gate`. A bare `p` gate is never used. Existing tests are updated to calibrate `p@<model>`. |
| 1A.4 | #6 | `sysrouter.js` | `addRoute` (and every v2 registration in 1D) first takes a snapshot of the spec: every field read once into own-property plain values (strings coerced, arrays sliced, `criteria` / `on` copied into `dict()`s, nested objects copied). Validation and storage use only the snapshot. | A spec whose `on.spin` getter returns `perk` four times and then `halt` registers `perk` (or is refused), and `hear()` never runs `halt`. A getter counter proves each field was read exactly once. |
| 1A.5 | #7 | `sysrouter.js` | `if (a.reserved && who.tier === 'extension') fail(...)`, unconditionally. `extension(name, grants)` throws if `grants.actions` names a reserved action. | Granting `halt` to an extension throws at `extension()`. A route by an extension holding an exact provider and no `addsRecall` cannot reach `halt`. |
| 1A.6 | #8 | `sysrouter.js` | Accept `usd` when `Number.isFinite(usd) && usd >= 0`. Drop the `< 1` bound. | A provider reporting `usd: 1.5` makes `spent() === 1.5`, and the next call is `budget`. |
| 1A.7 | #9 | `sysrouter.js` | `a.run()` runs first. Cooldown, hold and stop-clears-holds take effect only if it returned without throwing. | A throwing system action leaves no hold: an extension on the same resource acts in the same tick. A throwing stop clears nothing. |

### 1B — The boundary and the lanes (after 1A)

| Item | Spec | Files | Change | Acceptance test |
|---|---|---|---|---|
| 1B.1 | D1, L7 | `sysrouter.js`, `test_router.mjs`, `fuzz_router.mjs`, `mutants.mjs` | `MODES = ['shadow', 'live']` plus `off` from flags. `parallel` is accepted as an alias (P3); `preempt` is refused at registration and dropped from flags. `hear()` returns `{ acted, done }`. The `preempt` why value and the "extensions cannot pre-empt" check go away. The fuzzer's mode pool becomes `shadow`/`live`. | Registering `mode: 'preempt'` throws. `?sysroute=x:preempt` is ignored. `hear()`'s result has no `preempt` key. |
| 1B.2 | D3, L9 | `sysrouter.js` | After `seal()`, every system-lane method throws: `core`, `route`, `action`, `provider`, `calibrate`, `unroute` on system routes, `extension` (C8), and every v2 registration from 1D. | One test per method, after seal |
| 1B.3 | D2, L9 | `sysrouter.js`, `boot.js` | `sr.port()` returns a frozen object with exactly `hear, replied, read, watch, request, list, extensions, install, uninstall, spent, release`, plus read-only `flags()`. `boot.js` keeps `sr` in its closure and sets `window.SysRouter = sr.port()`. The demo page keeps using the full router it creates itself. | `Object.keys(port)` equals that list. The port has no `route`, `action`, `provider`, `calibrate`, `core`, `seal`, `extension`. `test_funnel` passes unchanged. |

### 1C — Engines, telemetry and the double-request guard (after 1B)

| Item | Closes | Files | Change | Acceptance test |
|---|---|---|---|---|
| 1C.1 | #10 | `sysrouter.js` | Every engine consulted writes a row. The only exception is a non-final `abstain`, which is routine for the readers. This covers sync and async cascade steps, failed or unsure race legs (not legs ended by `won`), and `open` / `budget` skips. | A cascade whose first engine errors 3 times then trips the breaker writes 3 `error` rows, then `open` rows, while the second engine acts. The existing check at `test_router.mjs:170` is updated for the extra `unsure` row. |
| 1C.2 | #12, D5, R-BND-5 | `sysrouter.js`, `s1-readers.js` | Providers may declare `inFunnel: true` (P4). `readersProvider` does. When an `inFunnel` provider decides, the router writes `did: 0, why: "readers_acted"`, calls nothing, and applies P5. | In `live` mode: "stop" → host `halt` called 0 times by the router, row `readers_acted`. "okay, that's enough now" (readers abstain, n-gram decides) → host `halt` called once, row `acted`. |

### 1D — The v2 registry (after 1C)

The v1 calls (`route`, `provider`, `action`, `extension`) remain, as thin sugar over the v2 model, so the benchmark and demo keep working. The v2 registry stays inside `src/sysrouter.js` unless the file passes ~600 lines. If it does, split the registry into `src/registry.js`; still zero dependencies.

| Item | Spec | Change | Acceptance test |
|---|---|---|---|
| 1D.0 | design review (dispatch legibility) | Split `hear()` into **dispatch** (which triggers apply to this event, freshness, rate caps, handing a decision to `act`) and **resolution**: one function `resolve(capability, input, signal) → { d, rows }` that owns policy, steps, gates, budget, breaker and spend. Behaviour is unchanged. This is the EventManager lesson: the dispatcher should read like `_handleEvent`. | The whole suite and all mutants pass with no test changed. `hear()` is ≤ 40 lines. |
| 1D.1 | §6, R-STR-1..5 | `stream(decl)`, `emit(streamId, event)`, `read(streamId)` and `watch(streamId, fn)` (returns an unsubscribe function). Events are `{ stream, type, data, t, seq, hop }`. Text data is capped at 600 characters. Every event carries `hop`, and events past `maxHops` (P6) are dropped with a `hops` row. Built-in stream `speech`, with types `person` and `creature`. `hear(text, { from })` emits onto it. The one-level re-entry guard is replaced by the hop count. | Chaining A → B → A stops at the hop limit with a `hops` row. `watch` callbacks that throw never break dispatch. `read` returns the latest event. |
| 1D.2 | §4.2, P8, P9 | Engines declare `primitives: { name: { in, out } }` (`types` stays as sugar for the decision primitives). Add `generate` (P8). Add `match` as the readers' declared primitive (registered as an exact `choice` engine, as today). `embed` returns a finite number array. `query` returns an array of records of declared shape. `sense` and `actuate` (1D.8). Every primitive has an output checker in the style of `readAnswer`. `box` per P9. | One checker test per primitive, with malformed outputs → `bad_answer` |
| 1D.3 | §7.2, R-REG-5 | `command({ id, capability, args, exposeTo, resource, holdMs, cooldownMs })`. `args` is a declaration (`type: 'number' \| 'string' \| 'boolean' \| 'enum'`, plus `min`, `max`, `maxLen` and `values`), checked before the capability runs. `exposeTo` is a subset of `['third-party', 'creature', 'person']`. `action()` becomes sugar for a command whose capability is a host function. | Out-of-range args → `bad_args` row, nothing runs |
| 1D.4 | §7.3, R-REG-6 | `capability({ id, steps, policy, budgetMs, behavior })`. Steps run in order inside one budget, and each gets the remaining time. Step *k*'s output is step *k+1*'s input. `behavior` is `{ publish?: streamId, request?: { answer: commandId } }`, or an `actuate` last step. A v1 `route` is sugar for a one-step `choice` capability, plus a command table, plus a trigger. | A two-step capability publishes and requests; the second step sees the first step's output; a spent budget in step 1 skips step 2 with `timeout`. |
| 1D.5 | §7.4 | `trigger({ id, on: { stream, type? } \| { person: true } \| { creature: true }, command, args?, mode, cooldownMs })`. The `when` condition is **not** built (§7). | Triggers fire only on their stream and type. A `person: true` trigger fires only via `port.request(..., { from: 'person' })`. |
| 1D.6 | §8.2–8.3, §9.5, R-TRUST-3, R-TRUST-7 | `port.install(manifest, permissions)` (async, P7). It computes the manifest hash, refuses names and hashes on the block list (`createRouter({ blockList: { names, hashes } })`, refreshable by `sr.setBlockList()` on the system handle), validates every registration against `permissions` (`streams`, `commands`, `engines`, `perMin`, `maxUsd`), and registers in the `extension` lane. `port.extensions()` lists each installed extension with its hash and permissions. `port.uninstall(name)` removes all its registrations. `grants` is renamed `permissions` (the old name stays accepted). | A blocked name or hash is refused. A stream the extension was not granted cannot be its trigger source. Uninstall leaves no trigger behind. The hash is stable across key order. |
| 1D.7 | §8.4, P10, R-TRUST-5 | `src/worker-engine.js`: `workerEngine(worker, decl)` wraps a dedicated Worker as an engine. Protocol: page → worker `{ id, primitive, input }`; worker → page `{ id, ok: true, output, model, usd? }` or `{ id, ok: false, error }`. Abort sends `{ id, abort: true }`. Every reply is checked by the primitive's checker. Unknown ids are ignored. | `test_providers` runs the adapter against a `worker_threads` worker in Node. `bench/browser.mjs` re-measures the round trip through the adapter. |
| 1D.8 | §8.5, R-TRUST-8 | Attachments are worker engines declaring `sense` (the worker posts `{ sense: streamId, type, data }`, which become events on a stream the extension registered) and `actuate` (a command's capability). There is no hardware code in this repo. The test uses a mock attachment worker. | The mock "siren" worker: an IR `sense` event → trigger → `siren.on` → `actuate` message received with checked args |
| 1D.9 | §9.4, R-TRUST-9 | `port.request(commandId, args, { from })`, where `from` is `'person'` or `'creature'`. It runs only if the command's `exposeTo` includes that source and, for a third-party command, the person granted it. It is rate-capped per source. This is the router's half of the creature's door. Brit's half is a proposal (2C.4). | A creature request for a command not exposed to the creature → `refused` row, nothing runs |

## 4. Stage 2 — the two shipping capabilities, on the v2 router

### 2A — Fuzzy commands (`src/wakeword.js` → `src/fuzzy.js`, after Stage 1)

| Item | Spec | Change | Acceptance test |
|---|---|---|---|
| 2A.1 | D4, §9.2 | `boot.js` host contract. If `SysRouterHost.command(kind, by)` exists, every Brit command entry calls it (the whole command path). Otherwise it falls back to `SysRouterHost.run[kind]`, unchanged. Stops stay reserved and registered before `seal()`. `INTEGRATION.md` documents `command(kind, by)` as the preferred form. | With a host defining `command`, a fuzzy `halt` calls `command('halt', 'sysrouter')` once; with `run` only, the old path is unchanged |
| 2A.2 | D7, P1 | Rename the file to `fuzzy.js`, the export to `FUZZY`, and the id to `fuzzy`, expressed as a v2 capability (`choice` over Brit's exposed commands), a command table and a trigger on `speech`/`person`. The option set is built from the commands the host exposed, plus `none`, so an unexposed command can never be picked. | Removing `spin` from the host removes `spin` from the question. `?sysroute=wake:live` still sets `fuzzy` live. |
| 2A.3 | §13.3 step 4 (design only) | The option set may also include third-party commands the person exposed to fuzzy commands (`exposeTo` includes `'person'`). Built and tested with a mock command. No siren hardware. | "sound the alarm" → mock `siren.on` requested when exposed, refused when not |

### 2B — Emote (`src/expressive.js` → `src/emote.js`, after Stage 1)

| Item | Spec | Change | Acceptance test |
|---|---|---|---|
| 2B.1 | D6, §13.2 | The trigger listens to `speech` with both types (`person`, `creature`) | A creature event produces an emote decision row with `from: creature` |
| 2B.2 | §7.3, C4 | Emote becomes a composed capability: step 1 `embed` (MiniLM, `s1-embed.js`), step 2 `choice` (the trained head, `express.minilm-head-v1`), with the same six labels (C3). The n-gram one-step capability remains as the no-model fallback when MiniLM is not loaded. B's own sentiment model later replaces step 1 or both steps by configuration only; the plan builds the slot, not the model. | Both paths give the same label set; the two-step path's gates are keyed by the head's model id |
| 2B.3 | C5, R-OBS-3 | `replied(o, kind)`: (1) writes `agree` rows only when `kind === 'event'`, comparing only decisions made on **person** events; (2) then, for every `kind`, emits `o.say` (non-empty, already cleaned by Brit's handler) as a `creature` event on `speech`. The behavior publishes on stream `emote` and requests the expression command if the host exposed one. | A tick reply writes no `agree` row and keeps the pending person pick. A creature event never overwrites the pending person pick. An event reply after a tick produces exactly one correct `agree` row. |

### 2C — The page integration (after 2A and 2B)

| Item | Closes | Change | Acceptance test |
|---|---|---|---|
| 2C.1 | #11 | `integration/apply.mjs` hunk 3 moves to anchor `before` the line `    if(!(o.scratchpad&&o.scratchpad.mood)){` and becomes `try{ if(typeof SysRouter!=="undefined"&&SysRouter) SysRouter.replied(o,kind); }catch(_sr){}`. It sits outside every `kind` guard, because the router applies C5 itself. | `apply.mjs --check` passes. A new reply-handler slice in `test_funnel.mjs` shows `replied` called on mood and no-mood turns, for `event` and `tick`. |
| 2C.2 | §9.1 (optional) | Hunk 4, **off by default** (`apply.mjs --with-sensors`): `SysRouter.sense(trig)` at the top of `fireReflex`, before its guards, so the router sees every trigger Brit's sensors raised. The router port gains `sense(trig)`, which emits on stream `body.sense`. | With the hunk: a `test_funnel`-style slice shows `fireReflex`'s calls unchanged. Without it: nothing changes. |
| 2C.3 | — | `test_funnel.mjs` and `integration/apply.mjs` are updated for the renamed port. The funnel comparison still finds 0 differences in every state. | `run-all` |
| 2C.4 | D4, §9.4 (proposals) | `integration/proposals/` holds two patches for Brit, applied by `apply.mjs --proposal <name>` to a copy only. (a) `apply-command`: factors his `sendTxtFrom` command branch into `_applyCommand(kind, by)`, called by his own reader, and defines `SysRouterHost.command` to call it. A test slices the original and the patched `sendTxtFrom` and proves identical calls on every dataset line in every state, the same method as `test_funnel`. (b) `creature-door`: a context line listing the commands exposed to the creature, and a reply field `cmd: { id, args }` passed to `SysRouter.request(id, args, { from: 'creature' })`. This one is documented only, with no test against his prompt. | (a): 0 differences across all lines and states |
| 2C.5 | — | `demo/index.html` shows the v2 rows (`readers_acted`, `lost`, `hops`, `bad_args`), the published `emote` stream, and `port.extensions()` with an uninstall button. The mock siren extension can be installed from the demo, which is the visible confirmation SPEC §8.3 asks for. | Manual check in the browser, plus `bench/browser.mjs` loading the page with no page errors |

## 5. Stage 3 — calibration, verification, evidence

### 3A — Gates (after Stage 2)

| Item | Closes | Change | Acceptance test |
|---|---|---|---|
| 3A.1 | #5, #15 | `bench/report.mjs` writes every gate under `<engine id>@<model id the engine reports>`: `ngram-fuzzy@wake.ngram-v1`, `ngram-emote@express.ngram-v1`, `embed-fuzzy@wake.minilm-head-v1`, `embed-emote@express.minilm-head-v1`, `hosted@<model>`. An arm whose name carries a host (`clef@primeintellect`) is written as `hosted@<model>@<host>` and never overwrites the default host's entry. Route keys use the v2 ids (P1). | Regenerated `models/gates.json`: `fuzzy.hosted@cloudflare/clef.p` is 0.7193 and `emote.hosted@cloudflare/clef.p` is 0.7069, as `results/TABLES.md` gives for the `clef` arm. MiniLM entries are present. |
| 3A.2 | #15 | `boot.js` pins the host when it asks OpenRouter: `?s1=cloudflare/clef` sends `provider: { only: ['cloudflare'] }`, `typesafe/*` sends `['typesafe']`, and `?s1=<model>@<host>` pins that host and reads that host's gate. | `test_providers` checks the request body per case |
| 3A.3 | #14 (calibration) | `report.mjs` also reports the wrong-action rate on command lines only, beside the existing all-lines rate. The gate-fitting target is **not** changed in this phase; the number is surfaced, and B decides. | `results/TABLES.md` shows the new column |

### 3B — Verification (after 3A)

1. **New mutants in `test/mutants.mjs`.** Each must be caught:
   - "a late answer past the budget acts" (#3)
   - "a race loser trips the breaker" (#4)
   - "an unversioned gate acts" (#5)
   - "a getter changes `on` after validation" (#6)
   - "an extension reaches a stop" (#7)
   - "a cost of $1 or more is not counted" (#8)
   - "a throwing action keeps its hold" (#9)
   - "a failed cascade step writes no row" (#10)
   - "a readers match is requested again" (#12)
   - "the system lane registers after seal" (D3)
   - "the port exposes `route`" (D2)
   - "an event past the hop limit is dispatched" (1D.1)
   - "out-of-range args reach the capability" (1D.3)
   - "a blocked hash installs" (1D.6)
   - "a creature request reaches an unexposed command" (1D.9)
   - "a tick reply writes an agree row" (2B.3)
2. **Run** `node sysrouter/test/run-all.mjs`, `node sysrouter/bench/report.mjs` (no network; rebuilds every table and `gates.json` from `results/raw/`) and `node sysrouter/bench/browser.mjs`.
3. **Investigate the MiniLM timing anomaly.** `results/browser.json` reports MiniLM p50 = 0 ms at 4× and 6× CPU slowdown, faster than at full speed (5.5 ms). Find the cause (most likely a cache or a measurement that skips inference), fix `bench/browser.mjs`, and re-measure. No document quotes the slowed MiniLM numbers until this is resolved.

### 3C — Evidence and documents (after 3B)

| Item | Closes | Change |
|---|---|---|
| 3C.1 | #13 | Write `sysrouter/RESULTS.md` from `results/TABLES.md`, `results/results.json` and `results/browser.json` only, no new runs. Sections: §1 what was measured and what it cannot show; §2 fuzzy commands and cascades; §3 emote; §4 calibration and why the host matters; §5 in-browser cost; §6 Worker isolation cost; §7 the proxy and key checks. The PrimeIntellect failures are stated as measured: 229 of 2,170 calls failed, and the raw error rows are HTTP 429 "too many concurrent requests" (`results/raw/wake.clef@primeintellect.jsonl`). README lists it first under evidence. |
| 3C.2 | #14 | `INTEGRATION.md` and `RESULTS.md` §2 state both rates for readers → n-gram: false trigger 0.3% on non-commands, and wrong action 1.8% (readers alone 0.6%, readers → Jev 1.2%, readers → Clef-flash 0.6%), from `results/TABLES.md`. |
| 3C.3 | — | `SPEC.md` and `REQUIREMENTS.md`: flip every item built in this phase to `[built]` with its test, remove each resolved row from §16, and update §2.3 (names) and §10 (`why` values: `lost`, `readers_acted`, `hops`, `bad_args`, `refused`; `preempt` removed). |
| 3C.4 | — | `THREAT-MODEL.md`: T12 becomes built. T15 gains the Worker adapter and the mock attachment. Add C7 (`release` on the port) as a stated residual. |
| 3C.5 | #16 | `tools/doccheck.mjs`: reads the line, file, test-check and mutant counts from `wc`-equivalents and from `run-all`'s output, and fails if `README.md`, `SPEC.md` or `INTEGRATION.md` state different numbers. It is added to `run-all.mjs` and to `.github/workflows/sysrouter.yml`. |
| 3C.6 | #3–#16 | Close each issue with the commit that fixed it and the test that proves it |

## 6. Order and dependencies

```
1A ─▶ 1B ─▶ 1C ─▶ 1D.0 ─▶ 1D.1 … 1D.9 ─┬─▶ 2A ─┐
                                         └─▶ 2B ─┴─▶ 2C ─▶ 3A ─▶ 3B ─▶ 3C
```

Within 1A, the items are independent, in any order. Within 1D, 1D.0 comes first, then 1D.1–1D.5 in order. 1D.6–1D.9 come after 1D.5, in any order. 2A and 2B are independent of each other.

Stage 4 (packaging and presentation for Brit and the community) starts only after B signs off Stages 1–3.

## 7. Not in this phase, deliberately

| Item | Why |
|---|---|
| `when` (conditions on context) | Open, SPEC §15.1. B: not a blocker. |
| Bluetooth and serial attachments | Open, SPEC §15.2. Neither API has recorded Worker support. |
| Real siren hardware | Documented use case only (MISSION §8). 1D.8 proves the path with a mock. |
| Training B's own sentiment model, or a new emote label set | Needs a dataset v2. The slot for it is built in 2B.2. |
| Any change in Brit's page | Proposals only (2C.4). The page is his. |
| `box` without a verified shape | P9 |
| Changing the gate-fitting target | 3A.3 surfaces the number; B decides |

## 8. Coverage: everything decided, and where it lands

| Decided in | What | Where |
|---|---|---|
| Design review | The router consumes `think()`, never calls it | already true; 2B.3 keeps it (agreement reads replies only) |
| Design review | Never pre-empt | 1B.1 |
| Design review | Requests, never control; Brit's whole command path | 2A.1, 2C.4(a) |
| Design review | No double requests | 1C.2 |
| Design review | Publish for Brit's layer to read | 1D.1 (`read`, `watch` on the port) |
| Design review | The creature's door | 1D.9 (router half), 2C.4(b) (Brit's half, proposal) |
| Design review | Two lanes; sealed system lane; unpublished system reference | 1B.2, 1B.3, C8 |
| Design review | Permissions visible and revocable | 1D.6 (`extensions`, `uninstall`), 2C.5 (shown) |
| Design review | Block list by name and hash | 1D.6, P7 |
| Design review | Third-party code in Workers | 1D.7 |
| Design review | Attachments are engines; network by default | 1D.8 |
| Design review | `generate` admitted; chaining with a hop limit | 1D.2, 1D.1, P6 |
| Design review | One vocabulary: streams, events, triggers, commands, capabilities, primitives, engines | 1D.1–1D.5, 2A.2, P1 |
| Design review | Fuzzy commands over any exposed command, including a developer's | 2A.2, 2A.3 |
| Design review | Emote reads both speakers, as a composed capability | 2B.1–2B.3 |
| Design review | Brit's sensor triggers as a stream, if he wants | 2C.2 |
| Design review (EventManager comparison) | A legible dispatcher; validate at registration | 1D.0; 1A.4 and 1D.3 |
| SPEC §16 | D1 · D2 · D3 · D4 · D5 · D6 · D7 · D8 | 1B.1 · 1B.3 · 1B.2 · 2A.1, 2C.4 · 1C.2 · 2B.1 · P1–P3, 2A.2, 1D.6 · 1D |
| Issues | #3 · #4 · #5 · #6 · #7 · #8 · #9 · #10 · #11 · #12 · #13 · #14 · #15 · #16 | 1A.1 · 1A.2 · 1A.3, 3A.1 · 1A.4 · 1A.5 · 1A.6 · 1A.7 · 1C.1 · 2C.1 · 1C.2 · 3C.1 · 3A.3, 3C.2 · 3A.1, 3A.2 · 3C.5 |
| Status labels | Every part labelled; labels flipped only with a test | rule 1, 3C.3 |
