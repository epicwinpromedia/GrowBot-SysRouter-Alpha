# GrowBot System Router — Alpha Development Repository

This repository is the development workspace for the **GrowBot System Router (SysRouter) Alpha Build**. It combines GrowBot's open hardware and software assets with the specification, reference implementation, tests, benchmarks, threat model, and integration plan for a co-processing mind architecture.

The SysRouter Alpha is a proposal and implementation package for Brit Cruise's GrowBot. It is not the hosted GrowBot brain or server, and it is not yet a drop-in replacement for GrowBot's existing behavior.

## Mission

GrowBot's creature agent processes speech and decisions on one single-flight brain path. SysRouter adds a sanctioned, controlled way to run many intelligence primitives alongside that path without changing or preempting it.

The goal is to make engines of any kind available as composable primitives:

- deterministic rules and Brit's existing regex readers;
- on-device models;
- hosted decision models;
- generative models;
- external APIs;
- sensors and actuators attached to a developer's own hardware.

Developers compose primitives into capabilities, expose capabilities through commands, and bind commands to triggers that react to events in streams. A capability can publish a result, request an exposed command, or operate an attachment.

## System boundary

The router is part of the mind. Brit's layer remains owner of the body, reflexes, senses, chip link, creature agent, prompts, memory, and `think()` loop.

| Direction | Allowed crossing |
|---|---|
| Brit's layer to SysRouter | Speech, creature replies, and sensor events that Brit explicitly exposes as streams |
| SysRouter to Brit's layer | A request for a command Brit exposed |
| SysRouter to Brit's layer | A published result Brit's layer may read without the router starting or changing a brain turn |

SysRouter never changes, delays, intercepts, replaces, or preempts the existing GrowBot layer. It never calls `think()`. Model output is advisory; GrowBot's own command paths and deterministic safety controls decide whether and how to act.

## Core vocabulary

The specification uses one registration chain across both lanes:

```text
event in a stream -> trigger -> command -> capability -> behavior
                                                  |
                                  primitives provided by engines
```

- **Engine:** provides primitives, including models, rules, APIs, or attachments.
- **Primitive:** a typed operation such as `noul`, `choice`, `score`, `box`, `generate`, `match`, `embed`, `query`, `sense`, or `actuate`.
- **Capability:** one primitive or a composed sequence of primitives.
- **Command:** a named entry point to a capability.
- **Trigger:** reacts to an event, a person, or the creature.
- **Stream:** a registered source of named events.
- **Behavior:** publishes an event, requests a command, or actuates an attachment.

## Requirements

The Alpha requirements cover boundary control, routing, registration, streams, safety, trust, secrets, observability, performance, compatibility, and evidence.

- **Boundary:** SysRouter reads only exposed streams and reaches GrowBot only through exposed commands.
- **Fallback:** errors, missing keys, timeouts, low confidence, and the kill switch leave GrowBot behaving as before.
- **Shadow first:** new triggers default to shadow mode, which decides and logs but never requests an action.
- **Safety:** stop, halt, limp, and pause remain Brit's deterministic code. No probabilistic engine can replace or preempt them.
- **Lanes:** Brit's privileged system lane is sealed at page load; an open third-party lane receives only its own registrations and granted permissions.
- **Isolation:** third-party code runs in a Worker or behind a URL rather than sharing the page JavaScript scope.
- **Secrets:** one credential convention covers the browser, Node tools, hosted engines, firmware, and local proxies. Credentials are host-bound and never logged or exported.
- **Observability:** each decision is logged with trigger, capability, engine, model, bounded probability, latency, cost, requested command, and reason, never the spoken text.
- **Compatibility:** the shipped browser path uses ES modules with no dependencies and guards every call into Brit's code.
- **Evidence:** every engine and cascade is tested against versioned held-out datasets and reported for accuracy, false triggers, latency, cost, calibration, and failure behavior.

The normative requirement list is in [sysrouter/REQUIREMENTS.md](sysrouter/REQUIREMENTS.md).

## Alpha use cases

The reference package defines three use cases:

| Use case | Status | Purpose |
|---|---|---|
| Fuzzy commands | Implemented in shadow | Recognize a natural phrasing of one of Brit's commands that his regex readers missed, then request that command through his own command path |
| Emote | Implemented in shadow | Read person speech and creature replies and drive expression in parallel with dialogue |
| Siren attachment | Specified | Demonstrate a developer-built sensor and actuator extension, including permissions, streams, commands, triggers, and a Worker-isolated driver |

Fuzzy commands and Emote ship in the reference implementation. Neither is live by default. Siren remains a documented design that tests the attachment model.

## Implementation status

The reference implementation is in [sysrouter/src/](sysrouter/src/) and uses 13 browser ES modules. It includes:

- a registry and router;
- a separate engine contract;
- Brit's regex readers;
- on-device n-gram and MiniLM decision engines;
- hosted Jev/Clef engines;
- fuzzy command and emote capabilities;
- soft reflex support;
- key resolution and host-bound credential checks;
- Web Worker isolation;
- shadow, live, and off trigger modes;
- circuit breakers and spend limits;
- a browser demo and benchmark suite.

The implementation status is intentionally explicit. Some parts are built and passing, while some integration choices, the creature command door, Bluetooth and serial attachments, and additional trigger conditions remain specified or awaiting Brit's decision. [sysrouter/SPEC.md](sysrouter/SPEC.md) section 0 and section 16 identify built, specified, differing, proposed, and open items.

## Repository map

| Path | Contents |
|---|---|
| [sysrouter/](sysrouter/) | SysRouter Alpha mission, specification, requirements, integration plan, reference implementation, benchmark, tests, threat model, and results |
| [sysrouter/src/](sysrouter/src/) | Browser implementation and engine adapters |
| [sysrouter/test/](sysrouter/test/) | Plain Node test suites, fuzzing, mutants, and reader regression checks |
| [sysrouter/bench/](sysrouter/bench/) | Dataset slicing, engine runs, browser measurements, and report generation |
| [sysrouter/results/](sysrouter/results/) | Benchmark tables, raw engine replies, browser measurements, and summaries |
| [sysrouter/integration/](sysrouter/integration/) | Anchored page integration and proposal scripts |
| [app/](app/) | Read-only snapshot of GrowBot browser code; not the source of new live app changes |
| [firmware/](firmware/) | Pico 2 W MicroPython firmware, Wi-Fi setup, servo drivers, and the shipped relay client |
| [hardware/](hardware/) | Printable body parts, templates, CAD-related assets, and hardware documentation |
| [policy/](policy/) | Open walk-policy runners, trained weights, and forward-model or simulation exports |
| [ports/](ports/) | Examples for placing the GrowBot brain in other machines; starts with a robot lawnmower |
| [agent-harness/](agent-harness/) | Terminal runner for a local or hosted LLM, identity and memory rules, and body abstractions |

## Specification package

Read the documents in this order:

1. [sysrouter/MISSION.md](sysrouter/MISSION.md) defines the intent, boundary, vocabulary, lanes, and goals.
2. [sysrouter/SPEC.md](sysrouter/SPEC.md) defines the full contract and marks each part by implementation status.
3. [sysrouter/REQUIREMENTS.md](sysrouter/REQUIREMENTS.md) provides stable requirement IDs and evidence.
4. [sysrouter/RESULTS.md](sysrouter/RESULTS.md) summarizes measured benchmark and browser results.
5. [sysrouter/INTEGRATION.md](sysrouter/INTEGRATION.md) proposes small, independently reversible integration steps for Brit.
6. [sysrouter/THREAT-MODEL.md](sysrouter/THREAT-MODEL.md) describes protected assets, threats, mitigations, and remaining limits.
7. [sysrouter/data/DATASHEET.md](sysrouter/data/DATASHEET.md) documents the benchmark data sources, licences, splits, and limitations.

Supporting code-map, vendor, and claims research is under [sysrouter/research/](sysrouter/research/).

## Run the Alpha tests and demo

The tests use Node and do not require an API key for the no-key suite.

```text
node sysrouter/test/run-all.mjs
node sysrouter/tools/serve.mjs
```

Open `http://localhost:8765/sysrouter/demo/` to try fuzzy commands and emote decisions. The demo reports the selected engine, confidence, latency, and proposed journal row.

To rebuild benchmarks, review [sysrouter/README.md](sysrouter/README.md) for its Node, key, browser, and benchmark commands.

## Build and port GrowBot

- [BUILD.md](BUILD.md): standard Pico 2 W body build.
- [BOM.md](BOM.md): tested parts and power requirements.
- [PORTING.md](PORTING.md): use the GrowBot brain with another body or run another mind through the same app safety layer.
- [firmware/README.md](firmware/README.md): chip software and installation.
- [agent-harness/README.md](agent-harness/README.md): terminal-based agent and body contract.

The hosted GrowBot app is available at [growbot.dev](https://growbot.dev). Its public build is separate from this repository's SysRouter work.

## Contributing

Keep changes focused and open an issue before a large proposal. The repository also contains a read-only [app/](app/) snapshot that is replaced from live GrowBot releases; changes belong at the live source or in a separate proposal.

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch, pull-request, and contribution rules.

## License

- Code, including the SysRouter implementation and firmware: [PolyForm Noncommercial 1.0.0](LICENSE).
- Hardware and documentation: [CC BY-NC 4.0](hardware/LICENSE.md).
- Third-party benchmark data retains the licences recorded in [sysrouter/data/DATASHEET.md](sysrouter/data/DATASHEET.md).

Commercial use requires a separate licence. Commercial enquiries: info@growbot.dev
