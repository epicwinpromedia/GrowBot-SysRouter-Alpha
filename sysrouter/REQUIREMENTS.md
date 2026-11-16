# SysRouter — Requirements (v0, working)

These are **requirements, not a design.** They say what must be true and how it will be checked. Numbers marked **TBM** (to be measured) are set only after baselines exist. IDs are stable so later documents can cite them.

---

## R-RT — Routing

- **R-RT-1** Every registered route names a **question shape** (yes/no, choice, score, or generate) and a **provider policy** (single engine, cascade, parallel, or shadow). It does not name a vendor in code; vendors come from configuration.
- **R-RT-2** System One providers include, at minimum: Brit's existing regex readers (unchanged, as the baseline), Jev, Clef / Clef-flash, an on-device model, and a fast small generative model used in yes/no or choice mode. Adding a provider must not require editing any route.
- **R-RT-3** System Two remains today's `think()` path and its three funding lanes. SysRouter can route *to* it but never replaces it.
- **R-RT-4** Execution modes: **shadow** (decide and log, act on nothing), **parallel** (act on the fast answer while the brain continues), **pre-empt** (act and skip the brain call), **cascade** (cheap engine first, escalate when uncertain). Shadow is the default for every new route.
- **R-RT-5** Decisions run outside the brain's single-flight queue. A route can decide while `think()` is in flight.
- **R-RT-6** Thresholds belong to the (provider, model version, route) combination and are fitted on held-out data. They never live in route logic.

## R-REG — Registration (functions, behaviors, co-processors)

- **R-REG-1** One registration contract for core features and third-party extensions: route id, question(s), allowed outputs, the registered actions those outputs may trigger, latency budget, required capabilities, cooldown, and mode.
- **R-REG-2** Outputs can only select **registered actions**. An action runs through the app's existing executors and clamps (e.g. `moveLegs`, `fireReflex`, the expression gate), never through a new path to the body.
- **R-REG-3** The first two registrations:
  - **semantic wakewording:** fuzzy spoken command → registered action
  - **the expressive co-processor:** what the person and creature say → emotion, sound, burst, sky, expression
- **R-REG-4** Meaning-based reflex triggers sit next to the 11 sensor triggers. The creature can write its own soft reaction rules through the same whitelist-clamped path it uses today (`scratchpad.reflex`).
- **R-REG-5** Registration-time validation: collisions between routes, overly broad criteria (a required "not for" description, plus a check on a held-out negative set), rate limits.

## R-SAFE — Safety and security

- **R-SAFE-1** Stop, halt, limp and pause are **reserved**. They stay deterministic code and are never routed through a probabilistic engine alone. A System One engine may *add* recall for unusual stop phrasings. It may never block, delay or override a deterministic stop.
- **R-SAFE-2** Text from the person is untrusted input to any engine (prompt injection). No engine output can widen what an action may do.
- **R-SAFE-3** Engine failure, timeout, missing key or low confidence → today's path, unchanged.
- **R-SAFE-4** A kill switch turns all of SysRouter off (URL flag persisted to `localStorage`, per codebase convention), plus a per-route switch.
- **R-SAFE-5** A written threat model built from the real code (`CODEMAP.md` §8: the relay has no auth; the gateway is not a security boundary).

## R-TRUST — System lane vs extension lane

**The question:** should work that comes from the system (GrowBot's own architecture) be privileged over work from third-party extensions, and how do we stop an extension from hijacking primary systems? This must be answered, with reasons, before the specification is final.

**What the code already shows (V):** several resources are single and shared:
- one brain flight at a time (`think()`)
- one owner of the legs at a time (`moveLegs` takeover)
- one voice
- one budget of house credits or the user's own key
- one journal holding private speech

Contention for these is the real priority question.

- **R-TRUST-1** Every registration carries an **origin tier**: `core` (engine-owned safety), `system` (GrowBot's own features), `extension` (third party). The tier is assigned by whatever loads the code, never declared by the code itself.
- **R-TRUST-2** Priority by tier for each shared resource. A lower tier never pre-empts an action a higher tier owns. A `core` stop always wins, whoever owns the resource.
- **R-TRUST-3** Extensions get **capability grants**, not ambient access: which actions, which expressive channels, which input text, which providers, which keys and budget. Grants are visible to the person and revocable.
- **R-TRUST-4** Extensions can't read or change other routes, core thresholds, reserved actions or keys. They get per-extension rate and cost caps, and every decision is logged with its tier.
- **R-TRUST-5 (open, decide with reasons):** isolation. Code loaded into the same page shares one JavaScript global scope, so tiers enforced only by API are *cooperative*, not a security boundary (the gateway's header says the same of itself). Hard isolation means running extensions in a Web Worker or sandboxed iframe that reach the router only by messages. The decision needs measured costs (latency, complexity) against the threat model in R-SAFE-5.

## R-SEC — Secrets and keys (whole-system, not SysRouter-only)

**Today (V, `CODEMAP.md` §10):**
- Browser keys sit in `localStorage` (`pb_byok`, `pb_llm_key`).
- The harness reads environment variables.
- Firmware uses `secrets.example.py` → `secrets.py`.
- `.gitignore` already ignores `.env`, `.env.*`, `*.key`, `*.pem`, `secrets/`, `config.js`.
- Keys are not in the soul (the soul lives under separate `pb2_*` keys).

**Fixed constraint:** a page served from growbot.dev cannot read files on the user's computer. A `.env` file can therefore only serve **local tools and local servers** (harness, benchmarks, a local proxy, a dev server), never the hosted page directly.

- **R-SEC-1** One documented secrets convention for every GrowBot component: one `.env.example` at the repo root listing every variable, what reads it and where it is sent. Real values go in an ignored `.env` / `.env.local`. Per-component examples are allowed only if they defer to the root one.
- **R-SEC-2** One small credential resolver per runtime (Node and browser) with the same interface. A component asks for a credential by purpose ("decision model, OpenRouter route"), not by storage key. Resolution order is documented and testable.
- **R-SEC-3** Every credential is bound to the host(s) it may be sent to. A key is never sent anywhere else, logged, put in a journal row, put in an exported file or shown in full in the UI.
- **R-SEC-4** Browser storage of user keys keeps working (today's BYOK). We must evaluate and document what stronger options buy and cost: at-rest encryption with a non-extractable WebCrypto key protects exports and backups but not script running in the page.
- **R-SEC-5** The **local-proxy pattern:** keys live in the user's `.env`; the hosted page talks to the user's own proxy (the existing local-server door). That is the secure path for users who don't want keys in the browser at all.
- **R-SEC-6** Secret scanning in CI for this repo, and a pre-commit check documented for contributors.

## R-OBS — Observability

- **R-OBS-1** Each routing decision writes a journal row through `logEv` in the existing style: route, provider, model id as resolved by the vendor, answers and probabilities (bounded), latency split into network and decision, cost, action taken, and whether the brain's later reply agreed.
- **R-OBS-2** Text in rows follows the existing redaction rules (`logEv` redaction; hashed user text).
- **R-OBS-3** Shadow mode yields an agreement report: System One vs what the brain or person did next.

## R-PERF — Performance and cost (all TBM)

- **R-PERF-1** Per-route latency budgets, set from measured STT and brain latency on real phones.
- **R-PERF-2** Hosted calls have hard timeouts with fallback; on-device paths have CPU and battery budgets.
- **R-PERF-3** Cost per 1,000 decisions per provider, from measured token counts and current price pages.

## R-COMPAT — Fit with the codebase

- **R-COMPAT-1** Browser ES module, zero dependencies in the shipped path, loaded the way `brain-dial.js` and `visual-memory.js` are loaded. Benchmarks and tools may use Node.
- **R-COMPAT-2** Every call into SysRouter from `next.html` is `typeof`-guarded so Brit's slicing test harness keeps working.
- **R-COMPAT-3** No edits to `app/` in this repo except in an explicitly labeled integration branch. `app/` is Brit's mirror and gets replaced.
- **R-COMPAT-4** Works with all three brain lanes. Where a vendor key is missing, routes degrade to the providers that remain (at least the regex and on-device ones).

## R-EVAL — Evidence

- **R-EVAL-1** A versioned labeled dataset with documented sources, licences and splits (tuning / held-out). It includes real STT errors produced by a text-to-speech → Whisper round trip, plus Brit's documented regex edge cases.
- **R-EVAL-2** Arms:
  - today's behavior (regex + brain)
  - regex only
  - Jev
  - Clef
  - Clef-flash
  - a fast small generative model
  - an on-device model
  - hybrids
- **R-EVAL-3** Metrics: precision, recall and false-trigger rate per class; latency p50, p95 and p99, end to end on a real phone; cost; calibration; stability under shuffled option order; failure behavior under timeouts and outages.
- **R-EVAL-4** Every regex case that passes today becomes a regression test any hybrid must pass.
- **R-EVAL-5** Results reproducible from this repo with one command, given keys.
