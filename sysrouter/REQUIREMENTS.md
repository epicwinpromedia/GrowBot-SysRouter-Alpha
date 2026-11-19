# SysRouter — Requirements (v2, 2026-11-17)

These are **requirements, not a design.** They say what must be true and how it is checked; `SPEC.md` says how. IDs are stable: code and other documents cite them, so an ID is never reused for a different requirement. v2 keeps every v1 ID, rewrites those the mind/body framing changed (`MISSION.md` §3–§5), and adds two sections: R-BND (the boundary) and R-STR (streams).

**Status** of each requirement, with the same meanings as `SPEC.md` §0:
- **built**: in code and tested;
- **specified**: decided, not yet in code;
- **differs**: decided, but the code does otherwise (`SPEC.md` §16);
- **proposal**: needs Brit's decision;
- **open**: undecided;
- **TBM**: to be measured.

**Revised by the Phase 2 audit (2026-11-19, `AUDIT-PHASE2.md`).** Where Phase 2 marked a requirement `built` and the audit reproduced it broken against `2ad6542`, the status now reads `differs`, with the work item and issue that will make it `built`. Flip a status back only in the commit that fixes it, with its test (plan rule 1).

---

## R-BND — The boundary with Brit's layer (new in v2)

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| R-BND-1 | The router never changes, delays, intercepts, replaces or pre-empts anything in Brit's layer (embodiment, reflexes, senses, the creature agent). | built (`preempt` removed) | `SPEC.md` L7, `test_router` |
| R-BND-2 | The router reads only streams Brit's layer already produces, at the points he chooses to feed them. | built (person's words, brain reply, creature's words via `replied`, sensor triggers via `--with-sensors`). differs: creature events share per-route state with person events (A12, #23) | `test_funnel` (identical calls with router absent, null, in shadow, or throwing; reply-handler and `fireReflex` slices) |
| R-BND-3 | The router reaches Brit's layer only by **requesting** a command he exposed. The request goes through the same path his own reader uses for that command, so every side effect is his. | built: `boot.js` `SysRouterHost.command`, proposal `apply-command`. differs: what Brit exposes is not honoured; all eight fuzzy kinds are always offered, and the proposal's `command()` handles four (A13, #28, `SPEC.md` R2); extensions can be granted his commands without his exposure (A5, #19) | `test_providers`, `test_funnel` |
| R-BND-4 | The router never calls `think()`. It reads the brain's replies and publishes results his layer may read. | built (`port.read`, `port.watch`, `replied`) | `SPEC.md` §9.3, `test_router` |
| R-BND-5 | When Brit's reader already matched, the router requests nothing for those words. | built (`why: "readers_acted"`) | `test_router`, mutant "a readers match is requested again" |
| R-BND-6 | Anything that needs a change in Brit's layer (the command path, the sensor tap, the creature's door) is a proposal he can decline. Declining it leaves everything else working. | built (`integration/proposals/` and `--with-sensors` opt-in) | `INTEGRATION.md`, `test_funnel` |

## R-RT — Routing

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| R-RT-1 | A capability names the **primitives** it uses and, for each, the **engine policy** (single, cascade, race, plus shadow engines). It never names a vendor in code; engines come from configuration. Decision primitives: `noul`, `choice`, `score`, `box`. Others include `generate`. | built: `noul`, `choice`, `score`, `generate`, `match`, `embed`, `query`, `sense`, `actuate`, composed steps, and all four policies. Specified: `box` (excluded in Phase 2). | `test_router`, `test_providers` |
| R-RT-2 | Engines include, at minimum: Brit's regex readers (unchanged, the baseline), Jev, Clef / Clef-flash, an on-device model, and a small generative model used as a decision engine. Adding an engine never requires editing a capability. | built | `test_providers`; `bench/arms.json` |
| R-RT-3 | System Two in GrowBot is Brit's `think()` path and its three funding lanes. The router consumes it and never calls it (R-BND-4). A developer's own generative engine is a separate engine registered like any other. | built (`generate` primitive) | `test_router`, `SPEC.md` §4.2, §14.5 |
| R-RT-4 | Trigger modes are **off**, **shadow** (decide and log, request nothing) and **live** (request the command; everything else carries on). Shadow is the default for every new trigger. There is no pre-empt mode. | built for routes (`off`, `shadow`, `live`, with `parallel` alias; `preempt` removed). differs: a shadow trigger never runs its capability (A4, #25; `SPEC.md` R1: shadow holds back request, actuation and publish); the demo takes only `?mode=parallel` (B1, #36) | `test_router` |
| R-RT-5 | Capabilities run outside the brain's single-flight queue: they can decide while `think()` is in flight. | built | `test_funnel` (thinking state) |
| R-RT-6 | Thresholds belong to the (engine, model version, capability) combination, are fitted on held-out data, and never live in capability logic. | built | `models/gates.json`; `test_router` "no fitted gate" |
| R-RT-7 | A circuit breaker stops asking an engine that keeps failing. A spend cap stops asking engines that charge once the session limit is reached. | built | `test_router` |

## R-REG — Registration

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| R-REG-1 | One registration contract for both lanes, covering **streams, engines, capabilities, commands and triggers**. Registrations are data; a lane is assigned by the loader. | built (`stream`, `provider`, `capability`, `command`, `trigger`, plus `route`). differs: `route` is its own registration and resolver, not sugar over a capability (A1, #26); third parties cannot register engines (A9, #32); manifests may carry functions, so they are not pure data (A8, #22) | `test_router`, `SPEC.md` §2.3, §7 |
| R-REG-2 | A capability's answer can only select **registered commands**. A command whose capability is in Brit's layer runs through his existing executors and clamps, never a new path to the body. | built for selection and for `SysRouterHost.command`. differs: a command may name a missing capability and log `did: 1` (A15, #27) | `test_router` "select, never author", `test_providers` |
| R-REG-3 | The first two capabilities to ship: **fuzzy commands** (the speech stream → `choice` over the commands Brit exposed → a request for one of them) and **emote** (the person's words and the creature's replies → a sentiment primitive composed with `choice` → an expression output). A third, the **siren attachment**, is documented as a worked design. | built in shadow: `fuzzy` (`src/fuzzy.js`); `emote` as the one-step n-gram route reading both speakers; the mock siren through the system lane. differs: the composed 2-step emote is never built by `boot.js`, has no trigger and writes no agree rows (A14, #29); creature events corrupt emote's agreement evidence (A12, #23); fuzzy ignores exposure (A13, #28); the siren cannot be installed by a third party (A9, #32) | `test_providers`, `SPEC.md` §13 |
| R-REG-4 | Meaning-based triggers can sit beside Brit's 11 sensor triggers. The creature can write its own soft reaction rules through the same whitelist-clamped path it uses today (`scratchpad.reflex`). | built in shadow (`soft-reflex.js`). Proposal: the branch in Brit's reply handler that applies them. | `test_providers` |
| R-REG-5 | Registration-time validation: collisions, overly broad criteria (a required "not for" description, plus a check on a held-out negative set), rate limits, argument declarations on commands. | built for routes and command `args`. differs: capabilities skip `notFor`, option checks, size caps and collision checks (A1, #26); registrations read some fields more than once (B6, #41) | `test_router`, mutant "out-of-range args reach the capability" |
| R-REG-6 | A capability can be composed of several primitive steps, each answered by its own engines, and its behavior is to publish an event, request a command, or actuate an attachment. | built (steps, one budget, the three behaviors). differs: steps ignore `race` and shadow engines; no staleness; L8 not enforced (A1, #26; A3, #24) | `test_router`, `test_providers` |

## R-STR — Streams and events (new in v2)

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| R-STR-1 | Streams are registered and named. Each declares its event types and what an event's data holds. | built (`sr.stream`, `speech`, `body.sense`) | `test_router` |
| R-STR-2 | Only discrete events enter the router. Raw signals at sensor or motor rate become events in their own detector first. | built (discrete events only; `sense` events) | `SPEC.md` §6.2 |
| R-STR-3 | A capability can publish its results as a stream that other triggers, and Brit's layer, can read (chaining). | built (`behavior.publish`, `port.read`, `port.watch`) | `test_router` |
| R-STR-4 | Chains are finite: every event carries a hop count, and events past the limit are dropped with a row. | built for synchronous chains (`maxHops: 3`, `why: "hops"`). differs: the hop resets to 0 after any async step, so chains loop without end (A2, #18) | `test_router`, mutant "an event past the hop limit is dispatched" |
| R-STR-5 | A third-party trigger can read a stream only if the person granted it that stream. | built for triggers. differs: extension routes hear `speech` without a grant (A10, #30); Brit's streams have no exposure ceiling (A5, #19); a Worker can emit onto any stream (A7, #21) | `test_router` |

## R-SAFE — Safety and security

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| R-SAFE-1 | Stop, halt, limp and pause are **Brit's** and stay deterministic code. They are never reached through a probabilistic engine alone. A capability marked `addsRecall` may request a stop his readers missed. It may never block, delay or override one. No third-party trigger can request one. | built for routes and the extension lane. differs: a capability's `behavior.request` reaches a stop on a probability alone; `addsRecall` is never read there (A3, #24) | `test_router` "stop is code"; `test_readers_regression` part 3 |
| R-SAFE-2 | Text from the person, and any text a third party supplies, is untrusted input to every engine (prompt injection). No engine output can widen what a command may do. | built | `test_router`; `fuzz_router` (injection strings in every round) |
| R-SAFE-3 | Engine failure, timeout, missing key or low confidence: nothing is requested, and GrowBot behaves as today. | built | `test_router` "fail to today" |
| R-SAFE-4 | A kill switch turns the router off entirely (URL flag persisted to `localStorage`, per codebase convention), plus a per-trigger switch. | built | `test_router` "kill switch" |
| R-SAFE-5 | A written threat model built from the real code, covering the third-party lane and attachments. | built for v2 | `THREAT-MODEL.md` |

## R-TRUST — The system lane and the third-party lane

**What the code shows (V):** several resources are single and shared:
- one brain flight at a time (`think()`);
- one owner of the legs at a time (`moveLegs` takeover);
- one voice;
- one budget of house credits or the user's own key;
- one journal holding private speech.

**Decided** (`SPEC.md` §14.1): the system lane is privileged, and a third party is confined to what it brought and what it was granted.

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| R-TRUST-1 | Every registration carries a **lane**: the system lane (Brit's; tiers `core` and `system`) or the third-party lane (tier `extension`). The lane is assigned by whoever holds the reference used to register, never declared in the registration. | built | `test_router` "tiers and grants" |
| R-TRUST-2 | The router arbitrates only between commands **it requests**. Among those, a third-party command never displaces a system command's hold, and Brit's stops clear every hold. Brit's layer arbitrates itself, and the router never claims to referee it. | built | `test_router`; `mutants.mjs` |
| R-TRUST-3 | Third parties get **permissions**, not ambient access: which streams to read, which of Brit's exposed commands to request, which engines to call, which keys and budget. Brit sets the ceiling (what can be exposed). The person grants within it. Every install shows a confirmation, and every extension is listed with what it may do and can be removed. | built: `port.install`, `port.extensions`, `port.uninstall`, `demo/index.html`. differs: no ceiling, since any non-reserved system command can be granted (A5, #19); `perMin` and `maxUsd` not enforced outside routes (A11, #31) | `test_router`, `SPEC.md` §8.3 |
| R-TRUST-4 | A third party cannot read or change other registrations, system-lane gates, stop commands or keys. It has per-extension rate and cost caps, and every decision is logged with its lane. | built for isolation of registrations, gates, stops and keys. differs: per-extension rate cap enforced for routes only, cost cap never (A11, #31) | `test_router`; `fuzz_router` |
| R-TRUST-5 | Isolation. **Decided:** third-party registrations are data, and code a third party brings (an engine, an attachment driver) runs in a dedicated Worker or behind a URL. In-page checks are a second line. | built: `src/worker-engine.js` for the system lane. differs: manifests may carry `run` functions that execute in page scope (A8, #22); a Worker's sense messages can reach any stream (A7, #21); third parties cannot bring a Worker engine (A9, #32) | `results/browser.json` (Worker round trip); `test_providers` |
| R-TRUST-6 | The system lane closes when the page has loaded, and the reference that registers in it is never published to the page. | built (`seal()`, `boot.js` publishes `sr.port()`) | `test_router`, `mutants` |
| R-TRUST-7 | Brit can block third-party contributions with a list his server publishes, naming extensions and manifest hashes. The documents state that it is a curation tool, not a security boundary. | built: `blockList`, `setBlockList`, refusal by name and hash. differs: the hash ignores manifest code, so two different `run` bodies hash the same (A8, #22) | `test_router`, mutant "a blocked hash installs" |
| R-TRUST-8 | Attachments connect over the network by default, so they work from a Worker on every browser and never touch Brit's chip, firmware or relay channel. Direct WebUSB from a Worker is a Chromium-only option. | built for the system lane (`worker-engine.js` + mock siren `node:worker_threads` test). differs: no third-party path (A9, #32, `SPEC.md` R3); sense not confined to the owner's streams (A7, #21). Open: Bluetooth and serial (`SPEC.md` §15.2). | `test_providers` |
| R-TRUST-9 | The creature can use a third-party command only through a door Brit opens in his agent, and only for commands the person exposed to the creature. Without the door, the third-party lane may react to the creature's reply stream. | proposal | `SPEC.md` §9.4 |

## R-SEC — Secrets and keys (whole-system, not SysRouter-only)

**Today (V, `research/CODEMAP.md` §10):**
- Browser keys sit in `localStorage` (`pb_byok`, `pb_llm_key`).
- The harness reads environment variables.
- Firmware uses `secrets.example.py` → `secrets.py`.
- `.gitignore` ignores `.env`, `.env.*`, `*.key`, `*.pem`, `secrets/`, `config.js`.
- Keys are not in the soul, which lives under separate `pb2_*` keys.

**Fixed constraint:** a page served from growbot.dev cannot read files on the user's computer. A `.env` file can therefore only serve local tools and local servers, never the hosted page directly.

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| R-SEC-1 | One documented secrets convention for every GrowBot component: one `env.example` at the repo root listing every variable, what reads it and where it is sent. Real values go in an ignored `.env` / `.env.local`. | built | `env.example` |
| R-SEC-2 | One small credential resolver per runtime (Node and browser) with the same interface. A component asks by purpose, never by storage key. | built | `src/keys.js`; `test_keys` |
| R-SEC-3 | Every credential is bound to the host(s) it may be sent to. It is never sent elsewhere, logged, put in a journal row or exported file, or shown in full. A third-party engine gets a sender for its own host only, and only if the person granted it. | built for the first part; specified for third parties | `test_keys` (21 checks) |
| R-SEC-4 | Browser storage of user keys keeps working (today's BYOK). The stronger options are evaluated and documented. | built (evaluated) | `SPEC.md` §12 |
| R-SEC-5 | The local-proxy pattern: keys live in the user's `.env`, and the hosted page talks to the user's own proxy. | built | `tools/proxy.mjs` |
| R-SEC-6 | Secret scanning in CI for this repo, and a pre-commit check documented for contributors. | built | `tools/keyscan.mjs`; `.github/workflows/sysrouter.yml` |

## R-OBS — Observability

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| R-OBS-1 | Each decision writes a journal row through `logEv` in the existing style: trigger/capability, engine, model id as reported, answer and probability (bounded), latency, cost, the command requested, and why. | built for routes. differs: a capability-backed command logs `acted` / `did: 1` before, or without, the capability running (A15, #27); a shadow trigger writes no engine rows for its capability (A4, #25); pick of an unexposed fuzzy kind should write `unexposed` (A13, #28) | `SPEC.md` §10 |
| R-OBS-2 | No row contains the words. Text follows the existing redaction rules. | built | `test_router` "observability" |
| R-OBS-3 | Shadow mode yields an agreement report: what the capability decided against what the brain's reply said. | built for the n-gram emote route on `kind === 'event'`. differs: creature rows overwrite the person's pending pick, so agree rows compare the wrong pair (A12, #23); a call with no `kind` writes agree rows (B4, #39); the composed emote writes none (A14, #29) | `agree` rows |

## R-PERF — Performance and cost

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| R-PERF-1 | Per-trigger latency budgets, set from measured STT and brain latency on real phones. | TBM on a phone. Desktop Chromium measurements exist. | `results/browser.json` |
| R-PERF-2 | Hosted calls have hard timeouts with fallback. On-device paths have CPU and battery budgets. | built: timeouts. TBM: battery. | `test_router` |
| R-PERF-3 | Cost per 1,000 decisions per engine, from measured token counts and current price pages. | built | `results/TABLES.md` |

## R-COMPAT — Fit with the codebase

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| R-COMPAT-1 | Browser ES module, zero dependencies in the shipped path. Benchmarks and tools may use Node. | built | `src/` |
| R-COMPAT-2 | Every call into the router from `next.html` is `typeof`-guarded and inside `try`, so Brit's slicing harnesses keep working. | built | `integration/apply.mjs`; `test_funnel` |
| R-COMPAT-3 | No edits to `app/` in this repo. `app/` is Brit's mirror and is replaced on each snapshot. | built | `integration/apply.mjs` writes only to a copy |
| R-COMPAT-4 | Works with all three brain lanes. Where a vendor key is missing, capabilities degrade to the engines that remain (at least the regex and on-device ones). | built | `boot.js` |

## R-EVAL — Evidence

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| R-EVAL-1 | A versioned labeled dataset with documented sources, licences and splits, including real STT errors from a text-to-speech → Whisper round trip and Brit's documented regex edge cases. | built | `data/DATASHEET.md`; `data/v1/MANIFEST.json` |
| R-EVAL-2 | Arms: today's behaviour (regex + brain), regex only, Jev, Clef, Clef-flash, a small generative model, on-device models, cascades. | built | `results/TABLES.md` |
| R-EVAL-3 | Metrics: precision, recall and false-trigger rate per class; latency p50, p95 and p99 (end to end on a real phone: TBM); cost; calibration; stability under shuffled option order; failure behaviour under timeouts and outages. | built except phone latency | `results/TABLES.md`; `results/raw/` |
| R-EVAL-4 | Every regex case that passes today is a regression test any cascade must pass. | built | `test_readers_regression` |
| R-EVAL-5 | Results are reproducible from this repo with one command, given keys. | built | `node bench/run.mjs`; `node bench/report.mjs` rebuilds every table from `results/raw/` with no network |
