# GrowBot System Router — Mission

**Status:** mission statement, v2 (2026-11-17). Replaces v1 (2026-11-16).
**Designer:** B (EPIC WIN Pro Media). **Submitted to:** Brit Cruise (GrowBot founder), Discord DM, 2026-11-08.
**What changed in v2:** the boundary between the router and GrowBot is now stated exactly (the router is part of the mind, Brit's layer is the body and the creature agent), the router never pre-empts anything, and one vocabulary (§4) names every registered part. Nothing measured changed.

---

## 1. The intent

Make every kind of computational intelligence available to GrowBot as a **primitive**, to Brit's system and to any developer, and let those primitives be composed and run **in parallel with** GrowBot's existing architecture without changing it.

The router is the means. A sanctioned, controlled, open registry of intelligence primitives is the goal.

## 2. The mission, in one paragraph

The **GrowBot System Router** (SysRouter) is a co-processing router and registry for GrowBot's **mind**. Engines of any kind (a regex reader, a tiny on-device model, a hosted decision model such as TypeSafe Jev or Cloudflare Clef, a generative model, an external API, a piece of hardware someone attached) register the **primitives** they provide. Developers compose primitives into **capabilities**, expose each capability through a **command**, and bind commands to **triggers** that react to **events** in **streams**. Everything runs **alongside** Brit's layer: it reads what his layer already produces, and it reaches his layer only by making **requests** to commands he has chosen to expose. He decides whether and how to respond. Developers who bring their own engines, sensors and effects control those fully, on their own instance, without changing Brit's code.

## 3. The boundary: mind and body

| | **The body layer (Brit's)** | **The co-processing layer (this router)** |
|---|---|---|
| What it is | Embodiment: movement, balance, proprioception, gesture, reflexes, the senses, the wire to the chip. Also the creature agent: the language model behind `think()`, its prompt, memory and dream. | A router and registry where any number of engines co-process, in parallel, through registered primitives |
| Who owns it | Brit, completely | Its lanes (§5): Brit's system lane and the open third-party lane |
| What crosses | The router **reads** streams his layer produces (the person's words, the creature's replies, his sensor triggers). The router **requests** commands he exposes. His layer **reads** what the router publishes, if and when he chooses. | |
| What never happens | The router changes, delays, intercepts, replaces or pre-empts anything in his layer, or calls `think()` | |

The biological picture is a guide, not a claim: "body" here covers what a nervous system spreads across the cerebellum, brainstem, spinal reflexes and sense organs. The router is part of the mind, next to the agent, never in front of it.

## 4. The vocabulary

One chain describes every registration:

```
an EVENT in a STREAM ─▶ a TRIGGER ─▶ a COMMAND ─▶ a CAPABILITY ─▶ a BEHAVIOR
                                                    │
                                    built from PRIMITIVES provided by ENGINES
```

| Term | Meaning |
|---|---|
| **Stream** | A registered source of events: the person's transcribed words, the creature's replies, a sensor, a capability's published results |
| **Event** | One item in a stream. Events come from many sources and have many types; Brit's events are one family among them, not the only one, and not equivalent to the others |
| **Trigger** | A rule that calls a command: in reaction to an event, at a person's request, or at the creature's request |
| **Command** | A named, callable entry point to a capability. A command another lane owns can only be *requested* |
| **Capability** | What actually does the work: one or more primitives composed. "Emote" is a capability: a sentiment primitive composed with the `choice` decision primitive |
| **Primitive** | A typed operation an engine provides: the decision primitives `noul`, `choice`, `score` and `box`; `generate`; a regex match; a query; an actuation; any other operation an engine declares |
| **Engine** | Whatever provides primitives: a model (on-device or hosted), an external API, deterministic rules, or an **attachment** |
| **Attachment** | A hardware extension. It is an engine: it provides primitives (a sensor provides a stream, an actuator provides an actuation) |
| **Behavior** | What a capability produces: an effect in the world, an event published to a stream, or a request for another command |
| **Extension** | A package of registrations (streams, engines, capabilities, commands, triggers) contributed in the third-party lane |

Brit's existing members of these classes keep their names and stay his. His reflex triggers (`TRIGS`) and his commands are a protected family; the router's triggers and commands are the same kind of thing in a different lane. Opening a class to new members never grants access to his members.

## 5. Two lanes

- **The system lane** belongs to Brit. It is for GrowBot's official features and rollouts. It is registered when the page loads and sealed; holding it is the privilege. Brit chooses which of his commands and streams to expose to the third-party lane, and he can publish a block list of third-party contributions that become a problem.
- **The third-party lane** is open. Any developer or user can register streams, engines, capabilities, commands and triggers, and attachments, and run them on their own instance with no change to Brit's code. Everything they bring, they control completely. Everything of Brit's, they can only request, through what he exposed.

A contribution that proves itself can be adopted into the system lane, on Brit's terms, in whatever form he chooses. That is the path from the open lane into the curated menu.

## 6. Why GrowBot needs it (facts from the code, `research/CODEMAP.md`)

1. **The brain thinks one thought at a time.** `think()` refuses to start while a thought is in flight (`app/v3/next.html:10754`). Words said during that time are queued (`sendTxtFrom`, `next.html:12059`).
2. **Fast local paths exist, and each is hand-wired.** The input funnel runs a fixed series of readers before the brain (`next.html:12010–12058`). A new fast behavior means another hand-placed call.
3. **The fast reflex table only understands sensors.** Triggers are limited to 11 sensor events (`next.html:11590`). There is no trigger for *meaning*.
4. **Expression comes only from the language model's reply** (`app/v3/prompts.js:231–300`), so the body cannot react until the whole thought is back.
5. **There is no sanctioned way to add an engine, a sensor or an effect** without editing the page. `PORTING.md` invites ports and says what the hosted app cannot yet express decides what gets built next.

## 7. Goals

- **G1 — Primitives from any engine.** Any engine that provides a typed primitive can be registered: decision engines, generative engines, rules, APIs, attachments. Brit's regex readers are a first-class engine, unchanged.
- **G2 — Registration, not edits.** Streams, engines, capabilities, commands and triggers are registered as data. Choosing which engine answers is configuration, not code.
- **G3 — Parallel co-processing.** Capabilities run alongside the brain and the body, never in their queue and never in front of them. Two capabilities ship first:
  - **Fuzzy commands:** a decision model listens to the transcribed speech stream and, when it recognises a phrasing that means one of Brit's commands, requests that command, exactly as if his own reader had matched the literal words.
  - **Emote:** a small sentiment model, composed with the `choice` primitive, reads the person's words and the creature's replies and drives an expression output (the screen, or an attachment such as an LED face) in parallel with the dialogue.
- **G4 — Requests, never control, across the boundary.** Nothing the router does reaches Brit's layer except a request to a command he exposed, and his layer decides what happens. No engine output is ever executed as a command of its own invention.
- **G5 — Two lanes.** A privileged system lane for Brit and an open third-party lane for everyone, as in §5.
- **G6 — Observable.** Every decision is a row in the app's existing journal (`logEv`, `next.html:457`).
- **G7 — Fails back to today.** Slow, down, unconfigured or unsure: nothing happens, and GrowBot behaves exactly as it does without the router. A kill switch removes the layer.
- **G8 — One secrets mechanism for the whole system.** (`REQUIREMENTS.md` §R-SEC.)
- **G9 — Proven by data.** Engine and pipeline choices are backed by measured accuracy, latency, cost, reliability and calibration against today's behavior.

## 8. The three reference use cases

Two ship. The third is documented so the design is tested against a case that adds hardware and the creature's own choices.

| | **Fuzzy commands** (ships) | **Emote** (ships) | **Siren attachment** (documented) |
|---|---|---|---|
| Stream | The person's transcribed words (Brit's) | The person's words and the creature's replies (Brit's) | An IR sensor (the attachment's own) |
| Trigger | Each utterance | Each utterance and each reply | A spoken request, an IR event, or the creature's request |
| Command | `fuzzy.match` (third-party or system) | `emote.read` (the developer's) | `siren.on`, `siren.off` (the developer's) |
| Capability | `choice` over the commands Brit exposed, answered by his readers first, then an on-device model, then optionally Jev or Clef | A sentiment primitive (a tiny on-device model) composed with `choice` | The attachment's actuation primitive |
| Behavior | A **request** for one of Brit's commands (`halt`, `follow`, …), handled by his own command path | An expression on the screen or an attached display | The siren sounds |

Further illustrations the vocabulary covers without change: a retrieval extension whose capability is a `query` primitive answered by an external API, exposed as a command the person can call and, if Brit opens the creature's door (`SPEC.md` §9.4), the creature too.

## 9. Non-goals

- Changing, delaying, intercepting or pre-empting anything in Brit's layer. Pre-emption of the body by voice is Brit's mechanism; the router never does it, it only requests his commands.
- Calling `think()`, or replacing the creature agent for conversation, planning or anything else.
- Anything at sensor or motor rate. Raw signals become discrete events before they reach the router.
- Replacing a safety control with a probability. Clamps, bands and stop paths stay Brit's deterministic code.

## 10. Principles (the tie-breakers)

1. **Principles before practices.** Coherence, simplicity and integrity decide ties.
2. **Rule of Least Power.** Deterministic rules first, then a System One engine, then a System Two engine. Each step up is earned by data.
3. **The clamp is code.** Model outputs are advisory; limits are enforced in code (`agent-harness/README.md`, design law 4).
4. **Privilege is possession, never declaration.** A lane's power is a reference the loader hands over, never a field a registration claims.
5. **Measure before claiming.** No number enters a document unless it was measured or its source is cited.
6. **Fit the codebase's conventions.** Feature flags with kill switches, log-only first, `typeof`-guarded calls, the existing funding lanes.
7. **Thin.** If the router needs a framework, the design is wrong.

## 11. What "done" means for this effort

A presentation package for Brit and the GrowBot community that makes an evidence-backed case for adopting SysRouter:

1. **The specification** (`SPEC.md`): the vocabulary, the boundary, the lanes, the contracts for every registered part, and the security and secrets model.
2. **A working reference implementation** in the app's language (browser JavaScript, ES module) with the two shipping capabilities.
3. **The benchmark suite and its results** (`results/`): today's behavior against every engine and cascade, for accuracy, latency, cost, reliability and calibration.
4. **An integration plan Brit controls** (`INTEGRATION.md`): small, independently mergeable steps, each with its flag, its kill switch and its evidence.

Success means Brit can make an informed decision from that package alone: adopt it, ask for more, or ask for something different.
