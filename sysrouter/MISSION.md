# GrowBot System Router — Mission

**Status:** mission statement, v1 (2026-11-16).
**Designer:** B (EPIC WIN Pro Media). **Submitted to:** Brit Cruise (GrowBot founder), Discord DM, 2026-11-08.

---

## The intent

Make every kind of computational intelligence GrowBot can use, System One and System Two alike, available as a primitive: to the system itself and to developers building extensions. The router is the means; access to those primitives is the goal.

## The mission, in one paragraph

The **GrowBot System Router** (SysRouter) routes work between **System One** engines (fast, typed decisions: TypeSafe Jev, Cloudflare Clef, a regex/rule engine, a small on-device model, or others) and **System Two** engines (the generative language-model agent, or others). The user or the developer doing the implementation defines which engines exist. Functions, behaviors and co-processors (such as emoting) are **registered** with the router, and the router sends each one to the engine it is registered for, in parallel where that helps, in a way that is robust, efficient, reliable, observable and extensible. It is a fast, light, uncomplicated thin layer that provides rich routing for extensible, parallel, mixed-engine architectures.

## Why GrowBot needs it (facts from the code, see `research/CODEMAP.md`)

1. **The brain thinks one thought at a time.** `think()` refuses to start while a thought is in flight (`app/v3/next.html:10754`). Words a person says during that time are queued (`sendTxtFrom`, `next.html:12059`) and answered only after the current thought lands.
2. **Fast local paths already exist, but each is hand-wired.** The input funnel runs a fixed series of hard-coded readers before the brain sees anything: stop and halt words, face-tracking words, get-up halts, hunt goals, imitation (`next.html:12010–12058`). Each new fast behavior means another hand-placed call in that funnel.
3. **The fast reflex table only understands sensors.** The creature can write its own reflexes, but triggers are limited to 11 sensor events (`tap`, `loud`, `dark`, `fall`…; `next.html:11590`). There is no trigger for *meaning*: "when someone says something celebratory, perk up" has nowhere to live.
4. **Expression comes only from the language model's reply.** Emotion, sound, light bursts, sky color and body expressions are fields of the one JSON reply (`app/v3/prompts.js:231–300`), so the body can't react until the whole thought has come back.

SysRouter turns these hand-placed fast paths into one registry, adds engines that understand meaning in tens to hundreds of milliseconds, and lets them run beside the brain instead of waiting behind it.

## Goals

- **G1 — Engine-agnostic routing.** Any engine that can answer a typed question (yes/no, pick one, score on a scale) is a System One provider. Any engine that generates is a System Two provider. Brit's own regex readers are a first-class System One provider, not something we replace.
- **G2 — Registration.** A function, behavior or co-processor declares what it needs (question type, latency budget, required capabilities, what it may trigger). The router picks the engine according to configuration, not code edits.
- **G3 — Parallel co-processing.** A registered co-processor runs alongside the brain, not in its queue. The two first co-processors are:
  - **Semantic wakewording:** fuzzy matching of spoken commands from the speech-to-text output to registered actions.
  - **The expressive loop:** the body and face react to what the person and the creature are saying, without a separate brain call and without the brain having to track emotion.
- **G4 — Secure by construction.** System One output can only select from **registered, already-clamped actions**. It never produces free-form commands. Safety actions (stop, halt, limp) are reserved and engine-owned. Third-party registrations can't override them.
- **G5 — Observable.** Every routing decision is logged in the app's existing journal format (`logEv`, `next.html:457`): which engine, its answer, probabilities, latency, cost, and what was done.
- **G6 — Fails back to today's behavior.** If any engine is slow, down, unconfigured or uncertain, the input goes down the path it takes today. A kill switch turns the whole layer off.
- **G7 — One secrets mechanism for the whole system.** Users and developers can supply their own keys through a secure, documented mechanism that serves every GrowBot component, not just SysRouter (see `REQUIREMENTS.md` §R-SEC).
- **G8 — Proven by data.** Every engine and pipeline choice is backed by benchmarks of accuracy, latency, cost, reliability and calibration, against today's behavior as the baseline.

## Non-goals

- Anything at sensor or motor rate. Balance, walking, IMU interpretation and servo control stay with the existing policies and clamps.
- Replacing the language model for open conversation, planning, counting, date math or anything that needs generation.
- Replacing a safety control with a probability. Clamps, bands and stop paths stay deterministic code.

## Principles (the tie-breakers)

1. **Principles before practices.** Coherence, simplicity and integrity decide ties.
2. **Rule of Least Power.** Deterministic code first, then a System One engine, then a System Two engine. Each step up must be earned by data.
3. **The clamp is code.** Prompts and model outputs are advisory. Limits are enforced by code (`agent-harness/README.md`, design law 4).
4. **Measure before claiming.** No number enters a spec unless it was measured or its source is cited.
5. **Fit the codebase's own conventions.** Feature flags with kill switches, log-only first, `typeof`-guarded calls so pieces can be tested in isolation, and the existing three brain-funding lanes (house credits, the user's own OpenRouter key, the user's own server).
6. **Thin.** If the router needs a framework, the design is wrong.

## What "done" means for this effort

A presentation package for Brit and the GrowBot community that makes an evidence-backed case for adopting SysRouter. It contains:

1. **The specification:** the router contract, the provider contract, the registration contract, and the security and secrets model.
2. **A working reference implementation** in the app's language (browser JavaScript, ES module), including the two first co-processors.
3. **The benchmark suite and its results:** today's behavior vs Jev vs Clef vs a fast small language model vs an on-device model vs hybrids, measured for speed, accuracy, cost, latency, reliability and flexibility. It includes which engine and which pipeline fit which kind of work.
4. **An integration plan Brit controls:** a sequence of small, independently mergeable steps that fit `CONTRIBUTING.md`, each with its flag, its kill switch and its evidence. He chooses how much to take and when.

Success means Brit can make an informed decision from that package alone, whether he adopts it, asks for more, or asks for something different.
