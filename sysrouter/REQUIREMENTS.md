# SysRouter — Requirements (v2, 2026-11-17)

These are **requirements, not a design.** They say what must be true and how it is checked; `SPEC.md` says how. IDs are stable: code and other documents cite them, so an ID is never reused for a different requirement. v2 keeps every v1 ID, rewrites those the mind/body framing changed (`MISSION.md` §3–§5), and adds two sections: R-BND (the boundary) and R-STR (streams).

**Status** of each requirement, with the same meanings as `SPEC.md` §0:
- **built**: in code and tested;
- **specified**: decided, not yet in code;
- **differs**: decided, but the code does otherwise (`SPEC.md` §16);
- **proposal**: needs Brit's decision;
- **open**: undecided;
- **TBM**: to be measured.

---

## R-BND — The boundary with Brit's layer (new in v2)

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| R-BND-1 | The router never changes, delays, intercepts, replaces or pre-empts anything in Brit's layer (embodiment, reflexes, senses, the creature agent). | differs: `preempt` mode (D1) | `SPEC.md` L7 |
| R-BND-2 | The router reads only streams Brit's layer already produces, at the points he chooses to feed them. | built: person's words, brain reply. Specified: creature's words, sensor triggers. | `test_funnel` (the funnel's calls are identical with the router absent, null, in shadow, or throwing) |
| R-BND-3 | The router reaches Brit's layer only by **requesting** a command he exposed. The request goes through the same path his own reader uses for that command, so every side effect is his. | differs: D4 | `SPEC.md` §9.2 |
| R-BND-4 | The router never calls `think()`. It reads the brain's replies and publishes results his layer may read. | built for the first part; publishing is specified | `SPEC.md` §9.3 |
| R-BND-5 | When Brit's reader already matched, the router requests nothing for those words. | differs: D5 | `SPEC.md` §9.2 |
| R-BND-6 | Anything that needs a change in Brit's layer (the command path, the sensor tap, the creature's door) is a proposal he can decline. Declining it leaves everything else working. | specified | `INTEGRATION.md` |

## R-RT — Routing

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| R-RT-1 | A capability names the **primitives** it uses and, for each, the **engine policy** (single, cascade, race, plus shadow engines). It never names a vendor in code; engines come from configuration. Decision primitives: `noul`, `choice`, `score`, `box`. Others include `generate`. | built: `noul`, `choice`, `score`, and all four policies. Specified: `box`, `generate`, composed steps. | `test_router` |
| R-RT-2 | Engines include, at minimum: Brit's regex readers (unchanged, the baseline), Jev, Clef / Clef-flash, an on-device model, and a small generative model used as a decision engine. Adding an engine never requires editing a capability. | built | `test_providers`; `bench/arms.json` |
| R-RT-3 | System Two in GrowBot is Brit's `think()` path and its three funding lanes. The router consumes it and never calls it (R-BND-4). A developer's own generative engine is a separate engine registered like any other. | built for consuming; specified for third-party generative engines | `SPEC.md` §4.2, §14.5 |
| R-RT-4 | Trigger modes are **off**, **shadow** (decide and log, request nothing) and **live** (request the command; everything else carries on). Shadow is the default for every new trigger. There is no pre-empt mode. | built: off, shadow, live (as `parallel`). Differs: `preempt` still exists (D1). | `test_router` |
| R-RT-5 | Capabilities run outside the brain's single-flight queue: they can decide while `think()` is in flight. | built | `test_funnel` (thinking state) |
| R-RT-6 | Thresholds belong to the (engine, model version, capability) combination, are fitted on held-out data, and never live in capability logic. | built | `models/gates.json`; `test_router` "no fitted gate" |
| R-RT-7 | A circuit breaker stops asking an engine that keeps failing. A spend cap stops asking engines that charge once the session limit is reached. | built | `test_router` |

## R-REG — Registration

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| R-REG-1 | One registration contract for both lanes, covering **streams, engines, capabilities, commands and triggers**. Registrations are data; a lane is assigned by the loader. | built: decision capability fused with its trigger and command table (`route`), engines (`provider`), commands (`action`). Specified: separate registrations. | `SPEC.md` §2.3, §7 |
| R-REG-2 | A capability's answer can only select **registered commands**. A command whose capability is in Brit's layer runs through his existing executors and clamps, never a new path to the body. | built for selection; differs for the path (D4) | `test_router` "select, never author" |
| R-REG-3 | The first two capabilities to ship: **fuzzy commands** (the speech stream → `choice` over the commands Brit exposed → a request for one of them) and **emote** (the person's words and the creature's replies → a sentiment primitive composed with `choice` → an expression output). A third, the **siren attachment**, is documented as a worked design. | built in shadow: fuzzy commands (as `wake`), emote with the person's words and a single `choice` step (as `express`). Differs: D6. Specified: composed steps; the siren. | `SPEC.md` §13 |
| R-REG-4 | Meaning-based triggers can sit beside Brit's 11 sensor triggers. The creature can write its own soft reaction rules through the same whitelist-clamped path it uses today (`scratchpad.reflex`). | built in shadow (`soft-reflex.js`). Proposal: the branch in Brit's reply handler that applies them. | `test_providers` |
| R-REG-5 | Registration-time validation: collisions, overly broad criteria (a required "not for" description, plus a check on a held-out negative set), rate limits, argument declarations on commands. | built except argument declarations (specified) | `test_router` |
| R-REG-6 | A capability can be composed of several primitive steps, each answered by its own engines, and its behavior is to publish an event, request a command, or actuate an attachment. | specified | `SPEC.md` §7.3 |

## R-STR — Streams and events (new in v2)

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| R-STR-1 | Streams are registered and named. Each declares its event types and what an event's data holds. | specified | `SPEC.md` §6 |
| R-STR-2 | Only discrete events enter the router. Raw signals at sensor or motor rate become events in their own detector first. | specified (today's single stream is already discrete) | `SPEC.md` §6.2 |
| R-STR-3 | A capability can publish its results as a stream that other triggers, and Brit's layer, can read (chaining). | specified | `SPEC.md` §6.3, §9.3 |
| R-STR-4 | Chains are finite: every event carries a hop count, and events past the limit are dropped with a row. | built: one-level re-entry guard. Specified: hop count. Open: the limit. | `SPEC.md` §6.3 |
| R-STR-5 | A third-party trigger can read a stream only if the person granted it that stream. | specified | `SPEC.md` §8.3 |

## R-SAFE — Safety and security

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| R-SAFE-1 | Stop, halt, limp and pause are **Brit's** and stay deterministic code. They are never reached through a probabilistic engine alone. A capability marked `addsRecall` may request a stop his readers missed. It may never block, delay or override one. No third-party trigger can request one. | built | `test_router` "stop is code"; `test_readers_regression` part 3 |
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
| R-TRUST-3 | Third parties get **permissions**, not ambient access: which streams to read, which of Brit's exposed commands to request, which engines to call, which keys and budget. Brit sets the ceiling (what can be exposed). The person grants within it. Every install shows a confirmation, and every extension is listed with what it may do and can be removed. | built: actions, engines and rate cap. Specified: streams, keys, the visible list. | `SPEC.md` §8.3 |
| R-TRUST-4 | A third party cannot read or change other registrations, system-lane gates, stop commands or keys. It has per-extension rate and cost caps, and every decision is logged with its lane. | built | `test_router`; `fuzz_router` |
| R-TRUST-5 | Isolation. **Decided:** third-party registrations are data, and code a third party brings (an engine, an attachment driver) runs in a dedicated Worker or behind a URL. In-page checks are a second line. | built: data-only registration. Specified: the Worker message protocol. | `results/browser.json` (Worker round trip); `SPEC.md` §8.4, §14.2 |
| R-TRUST-6 | The system lane closes when the page has loaded, and the reference that registers in it is never published to the page. | differs: D2, D3 | `SPEC.md` §8.1 |
| R-TRUST-7 | Brit can block third-party contributions with a list his server publishes, naming extensions and manifest hashes. The documents state that it is a curation tool, not a security boundary. | specified | `SPEC.md` §9.5 |
| R-TRUST-8 | Attachments connect over the network by default, so they work from a Worker on every browser and never touch Brit's chip, firmware or relay channel. Direct WebUSB from a Worker is a Chromium-only option. | specified. Open: Bluetooth and serial (`SPEC.md` §15.2). | `SPEC.md` §8.5 (MDN compatibility data) |
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
| R-OBS-1 | Each decision writes a journal row through `logEv` in the existing style: trigger/capability, engine, model id as reported, answer and probability (bounded), latency, cost, the command requested, and why. | built | `SPEC.md` §10 |
| R-OBS-2 | No row contains the words. Text follows the existing redaction rules. | built | `test_router` "observability" |
| R-OBS-3 | Shadow mode yields an agreement report: what the capability decided against what the brain's reply said. | built | `agree` rows |

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
