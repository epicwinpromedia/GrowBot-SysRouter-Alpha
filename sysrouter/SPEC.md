# SysRouter — Specification (v2, 2026-11-17)

This is the contract for the co-processing router and registry described in `MISSION.md`. Each rule cites the requirement it answers (`REQUIREMENTS.md`) and, where it is built, the test that proves it.

v2 replaces v1 (also 2026-11-17). v1 described what was built. v2 describes the whole design and marks, section by section, how much of it is built. Nothing measured has changed.

## 0. How to read this document

Every section and rule carries one status:

| Status | Meaning |
|---|---|
| **[built]** | In `src/`, exercised by `test/`, and passing (`node sysrouter/test/run-all.mjs`: 11 suites, all PASS) |
| **[specified]** | Decided and specified here; not yet in code |
| **[differs]** | Decided here, but the code still does something else. Listed in §16 as work to do |
| **[proposal to Brit]** | Needs a change in Brit's layer, which only he can decide |
| **[open]** | Not decided; the options are written down in §15 |

The shipped path today is 13 browser ES modules with no dependencies (`src/`, 1740 lines); the router itself is `src/sysrouter.js` (547 lines) and `src/registry.js` (451 lines).

---

## 1. The boundary [specified as a rule; the built code already respects it except where §16 says otherwise]

GrowBot has two layers. **The body layer is Brit's**: embodiment, reflexes, senses, the wire to the chip, and the creature agent (`think()`, its prompt, memory and dream). **The router is part of the mind** and runs alongside the body layer.

Three things cross the boundary, and nothing else:

| Direction | What crosses | Who decides |
|---|---|---|
| Body layer → router | **Streams** the body layer already produces: the person's transcribed words, the creature's replies, and any of his sensor triggers he chooses to share | His layer produces them; the router only reads |
| Router → body layer | **Requests** for commands he chose to expose | His own command path does whatever it does for that command, or nothing |
| Router → body layer | **Published results** the router makes readable | His layer reads them if and when it chooses: as context for the brain, as a reason to start a brain turn under his own guards, or not at all |

The router never changes, delays, intercepts, replaces or pre-empts anything in his layer, and it never calls `think()` (L7).

## 2. The vocabulary [specified; §2.3 maps it to the names the built code uses]

### 2.1 The chain

```
an EVENT in a STREAM ─▶ a TRIGGER ─▶ a COMMAND ─▶ a CAPABILITY ─▶ a BEHAVIOR
                                                    │
                                    built from PRIMITIVES provided by ENGINES
```

The chain composes. A behavior can be a request for another command, or an event published on a stream that other triggers listen to. Fuzzy commands is one hop of each: a capability whose behavior is a request for one of Brit's commands.

### 2.2 The terms

| Term | Definition | Owned by |
|---|---|---|
| **Stream** | A registered, named source of events. Its declaration says what its events carry. | The lane that registered it. Brit's streams are his and are read-only to everyone else. |
| **Event** | One item in a stream: `{ stream, type, data, t, seq }`. Events come from many sources and have many types. Brit's own events (his reflex triggers, his journal events, his brain-turn kinds) are a separate family the router does not redefine. | Its stream's owner |
| **Trigger** | A rule that calls one command. Its source is an event in a stream, a person's request (a button or setting), or the creature's request (§9.4). Brit's reflex triggers (`TRIGS`, `next.html:11590`) are a protected family of the same kind. | The lane that registered it |
| **Command** | A named, callable entry point to exactly one capability, with an argument declaration. A lane can call its own commands. It can only **request** a command another lane owns and exposed. | The lane that registered it |
| **Capability** | The thing that does the work: one primitive, or several composed in order. Fuzzy commands is `choice` answered by a cascade of engines. Emote is a sentiment primitive composed with `choice`. | The lane that registered it |
| **Primitive** | A typed operation an engine provides: input type, output type, and the checks an output must pass. §4 lists the members. | Declared by an engine |
| **Engine** | Anything that provides primitives: deterministic rules, an on-device model, a hosted model, an external API, or an attachment. | The lane that registered it |
| **Attachment** | A hardware extension, registered as an engine. A sensor provides a stream; an actuator provides an actuation primitive. | The lane that registered it |
| **Behavior** | What a capability produces: an effect in the world, an event published to a stream, or a request for another command. | — |
| **Extension** | A package of third-party registrations, identified by a name and the hash of its manifest. | Its author; installed by the person |
| **Lane** | Who registered something, and so what it may do (§8). | Assigned by the loader, never declared |
| **Permission** | What the person allowed a third-party extension to use: which streams it may read, which of Brit's exposed commands it may request, which engines it may call, which keys and budget. | The person |

Sharing names across lanes is deliberate. "Capability" names an open class; letting a developer register new capabilities grants access to the class, never to Brit's members of it.

### 2.3 The names in the built code [built]

| v2 term | v1 alias (still accepted) | What the code has |
|---|---|---|
| Engine | `provider` (`sr.provider`) | Engines that answer primitives (`noul`, `choice`, `score`, `generate`, `match`, `embed`, `query`, `sense`, `actuate`) |
| Decision primitive | `question.type` | `noul`, `choice`, `score` |
| Stream | `hear(text, {from})` | `sr.stream`, `sr.emit`, `port.read`, `port.watch` (built-in `speech` and `body.sense`) |
| Command | `action` (`sr.action`) | `sr.command` with `args` schema and `exposeTo` (`person`, `creature`, `third-party`) |
| Capability + trigger | `route` (`sr.route`) | `sr.capability` (composed `steps`, `behavior: { publish, request }`) and `sr.trigger` (`stream`, `person`, `creature`), plus `sr.route` |
| Brit's stop commands | `reserved` actions | Registered before `seal()` |
| System lane | tiers `core` and `system` | Sealed at `seal()`; `boot.js` publishes only `sr.port()` |
| Third-party lane | tier `extension` | `port.install()`, `port.extensions()`, `port.uninstall()`, `sr.extension()` |
| Permission | `grants` | `permissions` (`streams`, `commands` / `actions`, `engines` / `providers`, `perMin`, `maxUsd`) |
| Fuzzy commands | `wake` flag alias | `fuzzy`, `src/fuzzy.js` |
| Emote | `express` flag alias | `emote`, `src/emote.js` |

## 3. The laws

Every built law has a passing test and a deliberately broken router ("mutant") that the tests catch (`test/mutants.mjs`, 68 mutants, all caught).

| # | Law | Status | Requirement | Proved by |
|---|---|---|---|---|
| L1 | **Select, never author.** An engine's answer can only pick one of the answers a capability declared, and that answer can only name a registered command. No field of an engine's reply is executed or forwarded as a command. | [built] | R-REG-2, R-SAFE-2 | `test_router` "select, never author"; fuzz invariant |
| L2 | **Shadow first.** A trigger's default mode is `shadow`: it decides and logs and requests nothing. | [built] | R-RT-4 | `test_router`; `test_funnel` |
| L3 | **No gate, no action.** A probabilistic engine with no fitted gate for this capability and this exact model version never acts, even at p = 1. Gates are data. | [built] | R-RT-6 | `test_router` "no fitted gate" |
| L4 | **Fail to today.** Timeout, error, malformed reply, missing key, low confidence: nothing is requested, the row says why, and GrowBot behaves as it does without the router. Nothing the router does can throw into Brit's code. | [built] | R-SAFE-3 | `test_router` "fail to today"; `test_funnel` "hear() throws" |
| L5 | **The person's newest words decide.** A decision about older words that lands after newer words is dropped (`stale`). | [built] | funnel convention | `test_router` "newest words" |
| L6 | **Requests, never control.** The router reaches Brit's layer only by requesting a command he exposed, through the same path his own reader uses for that command (§9.2). What happens next is his. | [built] (`boot.js` `SysRouterHost.command`, `readers_acted` guard; page proposal `apply-command`) | R-BND-3 | `test_providers`, `test_funnel` |
| L7 | **Never pre-empt; never call `think()`.** The router has no mode that skips, delays or replaces anything in Brit's layer, and no path to `think()`. | [built] (`preempt` removed; no path to `think()`) | R-BND-1, R-BND-4 | `test_router` |
| L8 | **Stops are Brit's.** His stop commands are registered before `seal()`. A probability alone never reaches them: only an exact engine chain, or a capability marked `addsRecall`, which can request a stop his readers missed and can never block or delay one. A third-party trigger can never reach them. | [built] | R-SAFE-1 | `test_router` "stop is code"; `test_readers_regression` part 3 |
| L9 | **Privilege is possession.** A lane's power is the reference the loader holds. Registrations never declare their own lane. | [built] (`seal()` closes system lane; `boot.js` publishes `sr.port()`) | R-TRUST-1 | `test_router` "tiers and grants" |
| L10 | **The kill switch is total.** `?sysrouter=0` (persisted): no engine is asked, nothing is requested, no row is written. | [built] | R-SAFE-4 | `test_router` "kill switch" |
| L11 | **The words never enter a row.** A journal row carries capability, engine, answer, probability, timing and cost, never the text. | [built] | R-OBS-2 | `test_router` "observability"; fuzz invariant |

## 4. Primitives

### 4.1 Decision primitives

A decision primitive asks one question, in the request shape TypeSafe Jev, Cloudflare Clef and OpenRouter share (`research/VENDORS.md` §1), so those engines need no translation.

| Primitive | Status | `criteria` | Answer the router accepts | The pick |
|---|---|---|---|---|
| `choice` | [built] | `{ option: "description", … }` (2–64) | `{ choice, probabilities }` | `choice`, which must be a listed option |
| `noul` | [built] | `{ true: "…", false: "…" }` | `{ noul: 0..1 }` | `true` if ≥ 0.5 |
| `score` | [built] | `["lowest", …, "highest"]` (2–10) | `{ score, probabilities }` | the most probable level, numbered from 0 as the engines number them |
| `box` | [specified] | an image and what to find | per `research/VENDORS.md` (Jev 1.14 only, behind TypeSafe's `TypeSafe-Danger-Zone-Images` header) | — |

Every field is checked before use (`readAnswer`, [built]). A pick outside the options, a probability outside 0..1, a non-number, or a prototype key (`__proto__`, `constructor`) is `bad_answer`. An engine may also return `{ abstain: true }`, meaning "my rules do not cover this". That lets a cascade continue and is never a confident no.

### 4.2 Other primitives [built]

The class is open: an engine declares each primitive it provides, with its input type, output type and output checks. Members named so far:

| Primitive | Input → output | Example engine |
|---|---|---|
| `generate` | text → text | a generative model registered by a developer. Its output is data: it can feed a stream or another primitive, never become a command by itself (L1) |
| `match` | text → one rule's key, or abstain | Brit's regex readers (today registered as an exact `choice` engine) |
| `embed` / sentiment | text → numbers | a tiny on-device model, composed with `choice` or `score` to decide |
| `query` | text → result records | an external retrieval API |
| `sense` | (none) → events on a stream | an attachment's sensor |
| `actuate` | declared arguments → done or refused | an attachment's actuator |

The creature agent is not a primitive the router can call. The router reads `think()`'s replies as a stream (§9.1) and nothing more.

## 5. Engines

### 5.1 The engine contract [built for decision engines]

```js
{ ask(req, ctx) -> { model, answers: { q }, usage?, usd? },   // req = { state, questions: { q } }, ctx.signal aborts at the budget
  sync?: true,    // answers in the same tick (no promise)
  exact?: true,   // deterministic rules: a match needs no gate
  types: ['noul','choice','score'] }
```

| Engine | File | Kind | Notes |
|---|---|---|---|
| Brit's readers | `s1-readers.js` | sync, exact | Calls `_ftWords` as it is. Abstains when no rule matches. |
| n-gram model | `s1-ngram.js` | sync, on-device | One JSON file per capability (~190 kB), a hand-written forward pass |
| MiniLM | `s1-embed.js` | async, on-device | ONNX Runtime Web, the build the app already ships. Trained head, or zero-shot from the option descriptions |
| Jev / Clef | `s1-http.js` | async, hosted | One request shape; the model is configuration |
| a small chat model | `s1-chat.js` | async, hosted | Any OpenAI-style endpoint used as a decision engine: the options are lettered lines and exactly one letter is accepted |

Adding an engine is configuration (`bench/arms.json` for the benchmark, `?s1=<model>` in the page). No capability changes (R-RT-2).

### 5.2 Engines beyond decisions [specified]

An engine declares `primitives: { name: { in, out } }` in place of `types`. Third-party engines run behind a URL, or in a dedicated Web Worker, and reach the router only by messages (§8.4). An attachment is an engine whose primitives are `sense` and `actuate` (§8.5).

### 5.3 Reliability limits [built]

- **Circuit breaker.** An engine that fails three times in a row (`error`, `timeout`, `bad_answer`) is not asked for 30 s. The cascade moves on.
- **Spend cap.** Engines that charge stop being asked once the session has spent `maxUsd` (default $0.25). `sr.spent()` reports the total.

Both are overridable at `createRouter`.

## 6. Streams and events

### 6.1 The streams that exist today

| Stream | Owner | Status |
|---|---|---|
| The person's transcribed words | Brit | [built]: `hear(t)` in `sendTxtFrom` (integration line 2) |
| The creature's replies | Brit | Router side [built] (`input: 'creature' \| 'both'`); the feed from the page [specified] (§9.1) |
| His sensor triggers (`tap`, `loud`, `fall`, …) | Brit | [proposal to Brit]: a one-line tap where `fireReflex` is called, if he chooses to share them |
| A capability's published results | the capability's lane | [specified] (§6.3) |
| An attachment's sensor | the attachment's lane | [specified] (§8.5) |

### 6.2 Rules for streams [specified]

- **Discrete events only.** Nothing at sensor or motor rate enters the router. A raw signal (an IR level at 50 Hz, an IMU stream) becomes events in its own detector first, the way Brit's code turns 20 Hz sensors into debounced triggers before the reflex table sees them.
- **Declared shape.** A stream declares its event types and what each event's `data` holds. Text events hold a string, capped at 600 characters, as `hear()` does today.
- **Read permission.** A third-party trigger can listen to a stream only if the person granted it that stream (§8.3).

### 6.3 Chaining [specified]

A capability may publish its results as events on a stream it registers. Other triggers may listen to that stream. That is how capabilities compose across lanes and how Brit's layer reads results (§9.3).

Loops are prevented by a hop count carried on every event. An event caused by another event carries the parent's count plus one, and the router drops any event past the limit, writing a row (the limit is [open], §15). Today's code has the one-level version of this: `hear()` refuses re-entry deeper than one nested call [built].

## 7. Triggers, commands and capabilities

### 7.1 The decision capability, as built [built]

```js
sr.route({
  id: 'wake',                              // v2 name: fuzzy commands
  question: { type: 'choice', instructions: '…', criteria: { halt: '…', …, none: '…' } },
  notFor: 'what this must NOT fire on',    // required (R-REG-5)
  on: { halt: 'halt', … },                 // answer -> command
  providers: ['readers', 'ngram-wake', 'hosted'], policy: 'cascade', shadow: [],
  input: 'person',                         // which speaker on the speech stream
  mode: 'shadow', budgetMs: 900, cooldownMs: 800, addsRecall: true, agree: ''
});
```

**Policy**, how engines are consulted [built]:

| Policy | Behaviour |
|---|---|
| `single` | one engine |
| `cascade` | in order. The first *confident* answer ends it, including a confident "nothing". A spent time budget ends it. |
| `race` | all at once. The first *confident* answer wins, not the first to arrive. |
| `shadow: [...]` (extra list) | asked and logged beside any policy; never acts. This is how a candidate engine is trialled on live traffic. |

**Mode**, what happens to a decision:

| Mode | Status | Behaviour |
|---|---|---|
| `off` | [built] | nothing is asked |
| `shadow` (default) | [built] | decided and logged; nothing requested |
| `live` | [built] under the name `parallel` | the command is requested; everything in Brit's layer carries on exactly as it would have |
| ~~`preempt`~~ | [differs]: still in the code | **Removed from the design.** Pre-emption is Brit's mechanism for his body, and the router never does it (L7). |

Gates have two numbers per (capability, engine, model version) [built]. `p` is the bar for an answer that requests a command. `pn` is the bar for an answer that requests nothing: how sure "nothing was asked" must be before a cascade stops there instead of asking the next engine.

### 7.2 Commands [specified as separate registrations; built as `action`]

```js
{ id: 'siren.on', capability: 'siren', args: { seconds: { type: 'number', min: 1, max: 10 } },
  exposeTo: ['person', 'creature'] }        // lane is assigned by the loader
```

- A command names one capability and declares its arguments. Arguments are checked against the declaration before the capability runs, the way `readAnswer` checks answers.
- A command a lane owns, that lane calls. A command another lane owns and exposed can only be **requested**.
- A **resource hold** (`resource`, `holdMs`) arbitrates between commands **the router requests**, by lane: a third-party command never displaces a system command's hold [built]. Brit's layer arbitrates itself (the get-up lab "owns the legs", `fireReflex` will not fire while the creature moves or speaks, `next.html:8063`). The router never claims to referee his layer.
- `cooldownMs` is per command [built]: a debounce against the same thing twice, never a block on a different command.

### 7.3 Capabilities [specified as separate registrations; built as the decision part of `route`]

```js
{ id: 'emote',
  steps: [ { primitive: 'sentiment', engines: ['tiny-emote'] },
           { primitive: 'choice', engines: ['tiny-emote-head'], criteria: { happy: '…', sad: '…', … } } ],
  policy: 'cascade', budgetMs: 400,
  behavior: { publish: 'emote', request: { happy: 'face.happy', sad: 'face.sad', … } } }
```

A capability is an ordered list of primitive steps. Each step names its primitive, the engines that may answer it, and the policy for asking them. The output of one step is the input of the next. Its **behavior** says what happens with the last step's result:

- **`publish`**: an event on the capability's own stream.
- **`request`**: a table from decided answers to commands, as `on` is today.
- **An actuation**: the last step is an attachment's `actuate` primitive.

The data shape above is a proposal for review. What is decided is the structure: steps, engines per step, a behavior.

### 7.4 Triggers [specified as separate registrations; built as `input` on a route]

```js
{ id: 'emote-on-words', on: { stream: 'speech', from: 'both' }, command: 'emote.read', mode: 'shadow', cooldownMs: 0 }
{ id: 'siren-on-ir',    on: { stream: 'siren.ir', type: 'detected' }, command: 'siren.on', args: { seconds: 3 } }
{ id: 'siren-by-hand',  on: { person: true }, command: 'siren.on' }      // a button the person sees
```

A trigger names its source and one command. Whether a trigger can also carry a condition on context (`when`) is [open] (§15.1).

## 8. Lanes, permissions and isolation

### 8.1 The system lane [built for registration; [differs] in §16 for the published handle and the seal]

- It is everything registered through `sr.core()`, `sr.action()`, `sr.provider()` and `sr.route()` by the code that created the router: Brit's code, or `boot.js` on his behalf. `core` holds his stop commands. `system` holds his features.
- **It is closed when the page has loaded.** `seal()` ends registration in the system lane: no new stop commands, no new system triggers, commands, engines or gates. Precedent: Brit's system features are present when the page loads and are switched by flags, never added at runtime. Runtime registration is only for low-trust authors over whitelists (`scratchpad.reflex`).
- **The system reference is never published.** The page gets a public port: `hear`, `replied`, `list`, `spent`, `release`, and `install(manifest)` for the third-party lane. Holding the router object is the privilege, so it stays with the code that booted it.

### 8.2 The third-party lane [built: the facade; specified: everything else]

An extension is installed through the public port and receives a frozen facade, and nothing more.

- **[built]** It can add and remove its own decision capabilities, over the commands and engines it was granted, at its own rate cap (`perMin`, default 20).
- **[specified]** It can also register its own streams, engines (behind a URL or in a Worker), capabilities, commands and triggers.
- **[built]** It can never reach a stop command, run in any mode Brit's lane reserves, or see other registrations, gates or keys.
- **[specified]** It can request one of Brit's commands only if he exposed that command and the person granted that request.

### 8.3 Permissions [built]

- **Brit sets the ceiling.** Only what he exposes can ever be granted: which of his streams, which of his commands.
- **The person grants within it**, per extension: streams it may read, exposed commands it may request, engines it may call, keys and spend.
- **Every install is visible and revocable.** It shows a confirmation when installed (precedent: the "⚡ reflex set" toast, added because testers could not tell a reflex had installed, `next.html:11619`). A list of extensions with what each may do is one tap away, with a way to remove each (precedent: "the person has the x", `next.html:11627`).

### 8.4 Isolation [built, §14.2]

Third-party registrations are **data**: a manifest the loader passes to the facade. No third-party code runs in the page's scope. Code a third party brings (an engine, an attachment driver) runs in a **dedicated Web Worker** or behind a URL, and reaches the router only by messages.

The measured cost of a Worker message round trip is in `results/browser.json`:
- at full speed: p50 0 ms, p95 0.1 ms, p99 0.2 ms;
- with the CPU slowed 6×: p50 0.1 ms, p95 1.2 ms, p99 1.4 ms.

These were measured on desktop Chromium 156.0.8078.79 with CPU throttling, not on a phone.

The in-page checks of §8.2 are a second line of defence, not the boundary. Hostile script that is already in the page is out of scope (`THREAT-MODEL.md` T6).

### 8.5 Attachments [built; one path open]

An attachment is an engine. Its sensor is a stream, its actuator is an `actuate` primitive, and its driver is code in a dedicated Worker.

How the attachment's hardware is reached decides what works where. Facts from MDN's browser-compatibility data (2026-11-17):

| Connection | Available in a dedicated Worker? | Browsers |
|---|---|---|
| Network: WebSocket, `fetch` | Yes | All |
| WebUSB | Yes (Chromium 70+, Android included) | Chromium only; not Safari or iOS, not Firefox |
| Web Serial | No worker support recorded | Chromium desktop; Chrome Android 148+; not Safari or iOS |
| Web Bluetooth | No worker support recorded | Chromium only; not Safari or iOS |

**Decision:** the default attachment connects **over the network**. It can be its own board dialling its own relay channel, the "own both ends" shape in `PORTING.md`, or a local HTTP endpoint. That works from a Worker on every phone and never touches Brit's chip, firmware or relay channel. Direct WebUSB from a Worker is a Chromium-only option. A path for Bluetooth or serial attachments, which would need page-scope code, is [open] (§15.2).

## 9. The interface to Brit's layer

This section is what `INTEGRATION.md` asks of Brit, stated as contract.

### 9.1 Streams he feeds

| Feed | Line in the page | Status |
|---|---|---|
| The person's words | `SysRouter.hear(t)` in `sendTxtFrom`, after every local reader has acted, before `_imitationRequest` and the queue | [built] (integration line 2) |
| The brain's reply, for agreement rows | `SysRouter.replied(o)` in the reply handler | [built] (integration line 3) |
| The creature's spoken reply as a stream | `SysRouter.hear(o.say, { from: 'creature' })` where the reply's words are spoken | [specified]; needed by emote (`input: 'both'`) |
| His sensor triggers | `SysRouter.sense(trig)` beside each `fireReflex(trig)`, or once inside it | [proposal to Brit] |

### 9.2 Commands he exposes [built shape; [differs] in content]

Brit defines `SysRouterHost.run`, one entry per command he exposes. Today `boot.js` registers each entry as a command, and his stop commands as reserved, before `seal()`.

**An entry must be his whole command path, not one function inside it.** When his reader hears a literal "stop", `sendTxtFrom` (`next.html:12010` onward) does several things:
- it runs `_namedHalt`, `_gsHear`, `_recHalt`, `_partsHalt("words")` and `_bodyHalt()`;
- it latches the face tracker and hushes a buffered bench answer;
- it shows a toast;
- and the words still reach the brain turn.

A fuzzy "stop" must produce exactly the same. The contract is therefore that Brit factors that branch into one function his reader also calls, for example `_applyCommand(kind, by)`, and exposes `SysRouterHost.command(kind, by)` (`boot.js`, `src/fuzzy.js`, `integration/proposals/apply-command.mjs`). Today `boot.js` falls back to `SysRouterHost.run[kind]` if `command` is not defined.

**No double requests.** When his reader already matched the words (the `readers` engine answered exactly), his funnel has already acted. The router then requests nothing and writes `why: "readers_acted"`. It requests only what his readers missed. [specified]

### 9.3 What the router publishes for him [specified]

`sr.read(stream)` returns the latest event on a published stream, and `sr.watch(stream, fn)` calls `fn` with each new one. With these his layer can:
- show results to the brain as context, the way the "quiet WATCH" beat reads senses against standing rules (`next.html:13431`);
- turn a result into a brain turn under his own guards, the way a heard sound becomes `think("you just heard …","event")` (`next.html:7204`);
- or ignore it.

The router never calls `think()`.

### 9.4 The creature's door [proposal to Brit]

For the creature to use a command a developer brought (the siren "at will", a retrieval oracle), two things inside the agent have to happen, and both are Brit's:

1. **The model has to know the command exists.** A context line lists the commands the person exposed to the creature, with each command's description written for the model (the "LLM face" of `agent-harness/SPEC-BODY-TRUTH.md`).
2. **Its reply needs a field that names a command and its arguments.** His dispatcher passes that field to the router. The router checks it against the registry and the person's permissions, the same way `applyScratchWrites` checks `scratchpad.reflex` against the reflex whitelist (`next.html:11619`).

With that one door, every later developer command becomes usable by the creature without anyone editing the agent again. Putting a command into his own menu directly remains Brit's separate, curated path.

**Without the door**, the third-party lane can still listen to the creature's reply stream (§9.1) and react to what the creature *said*. This works with no change to the agent, but it is less reliable.

### 9.5 The block list [specified]

Brit can publish a list of blocked third-party contributions from his server, the way `/api/config` already delivers model choices. The loader refuses to install, and removes, any extension on the list.

Entries name an extension and the hash of its manifest. The name catches renamed copies of known extensions; the hash catches copies under another name.

**What it can and cannot do:** it works against widely shared contributions. A determined individual can change a manifest and get a new hash. The block list is a curation tool, not a security boundary.

## 10. The journal row [built]

One row per decision, written through `logEv("sysroute", …)` in the journal's existing short-key style:

| Key | Meaning |
|---|---|
| `r`, `tier`, `ext`, `mode` | trigger/capability id, its lane tier, the extension's name if any, the mode in force |
| `p`, `m` | engine id, and the model id as the engine reported it |
| `a`, `pr` | the answer and its probability (3 decimals) |
| `ms`, `tok`, `usd` | time to answer, input tokens, cost of the call |
| `act`, `did` | the command the answer maps to, and `1` if it was requested |
| `why` | `acted`, `shadow`, `none`, `unexposed`, `unsure`, `no_gate`, `abstain`, `bad_answer`, `timeout`, `error`, `stale`, `open` (circuit breaker), `budget` (spend cap), `cooldown`, `held`, `rate`, `act_error`, `shadow_arm`, `agree`, `boot`, `unwired`, `lost`, `readers_acted`, `hops`, `bad_args`, `refused` |

`sr.replied(o, kind)` writes one `agree` row per capability that set `agree` on person events (`kind === 'event'`). The row holds what the fast engine picked, what the brain's reply said, and whether they matched (R-OBS-3).

## 11. Flags [built]

Read from the URL and persisted to `localStorage`, like `?bodysnd=0` and `?express=bench`:

| Flag | Effect |
|---|---|
| `?sysrouter=1` | boot the router (it is off until asked for) |
| `?sysrouter=0` | off: the page behaves exactly as today |
| `?sysroute=fuzzy:live,emote:off` | per trigger: `off`, `shadow`, `live` (`parallel` accepted as an alias for `live`) |
| `?s1=cloudflare/clef-flash` | also ask this hosted engine, through a lane the person configured (§12) |

## 12. Keys [built]

`src/keys.js` is the one resolver, with the same interface in Node and the browser. A caller asks for a *sender* by purpose and never receives a key. Lanes, first configured wins:

| Lane | Where the key lives | Sent to |
|---|---|---|
| `own` | on your own server or `tools/proxy.mjs`; the page holds **no key** | the host in `SYSROUTER_URL` / `pb_s1_url` (https, or localhost) |
| `byok` | `.env` (`OPENROUTER_API_KEY`) or the browser's existing `pb_byok` | `openrouter.ai` only |
| `typesafe` | `.env` (`TYPESAFE_API_KEY`), Node only | `api.typesafe.ai` only |
| `house` | none in the page; the site's proxy on house credits | the page's own origin. Needs a server route that does not exist yet. |

Guarantees, each tested in `test/test_keys.mjs`:
- a key goes only to its lane's host, over https, with redirects refused;
- it is never returned, logged, or left in an error message;
- `describe()` shows only six leading and three trailing characters.

These key lanes are funding lanes, a different thing from the router's system and third-party lanes. A third-party engine that needs a key gets a sender for its own host only, and only if the person granted it (§8.3) [specified].

One list of every variable, what reads it and where it is sent: `env.example` at the repo root. `tools/keyscan.mjs`, also run in CI, refuses a commit containing a key shape.

**Browser storage (R-SEC-4), evaluated.** Encrypting `pb_byok` at rest with a non-extractable WebCrypto key would protect a copied profile, a backup or an exported soul. It would not protect against script running in the page, which can ask the same WebCrypto key to decrypt. The page's threat is in-page script (`THREAT-MODEL.md` T6), so encryption at rest buys little there. The `own` lane, which keeps the key out of the browser entirely, is the real answer, and it is implemented.

## 13. The reference use cases, end to end

### 13.1 Fuzzy commands (ships)

1. The person says "okay, that's enough now". Brit's funnel runs his readers; `_ftWords` matches nothing, so his layer does nothing early and the words go on to the brain as always.
2. `hear(t)` puts the words on the speech stream. The fuzzy-commands trigger calls its command; the capability asks `choice` over the commands Brit exposed. His readers abstain, the on-device model answers `halt` at p = 0.97, and its gate for this model version is 0.94.
3. The behavior requests Brit's `halt`. His command path does exactly what it does for a literal "stop". The row says `why: "acted"`.
4. If the person had said "stop", his readers would have matched in step 1. The router writes `readers_acted` and requests nothing.

Status: steps 1–2 [built], in shadow; step 3 [differs] (§9.2); step 4 [specified].

### 13.2 Emote (ships)

1. The person's words, or the creature's reply, arrive on the speech stream.
2. The emote trigger calls `emote.read`. `src/emote.js` supports both the composed 2-step capability (`embed` -> `choice`) and the one-step n-gram fallback.
3. The behavior requests the expression output: Brit's expression path if he exposes it, or the developer's own display attachment.
4. When the brain's reply lands, `replied()` logs whether the two agreed. The brain's reply still wins in Brit's layer, because the router never touches it.

Status: the person's words, the `choice` capability and agreement rows are [built] in shadow; the creature's words and composed steps are [specified]; the display attachment is [specified].

### 13.3 Siren attachment (documented, not shipped)

1. A developer builds a siren with an IR sensor on its own small board, which dials its own relay channel.
2. They install an extension that registers:
   - the attachment as an engine, with `sense` (IR) and `actuate` (siren) primitives;
   - its driver in a Worker;
   - the stream `siren.ir`;
   - the capability `siren`;
   - the commands `siren.on` and `siren.off`;
   - three triggers: on an IR event, on a button, and on the creature's request.
3. The person grants the extension its permissions and sees it in the list.
4. The fuzzy-commands capability includes the exposed commands the person allowed. "Sound the alarm" therefore requests `siren.on` as readily as "stop it" requests Brit's `halt`.
5. The creature can sound it only if Brit has opened the door (§9.4). Without the door, a trigger on the creature's reply stream is the fallback.

Status: [specified] throughout.

## 14. Decisions, with reasons

### 14.1 Should the system be privileged over extensions? Yes.

The contended resources are single: one pair of legs, one voice, one brain flight, one budget. A person's trust in the creature rests on its own behaviour being predictable.

So:
- the system lane outranks the third-party lane on every resource the router arbitrates;
- Brit's stops outrank everything;
- a third-party extension is confined to what it brought and what it was granted.

Hijacking is prevented structurally by L1 and L6. A third party contributes data, and can only request what Brit exposed.

### 14.2 Isolation: cooperative tiers or a hard boundary? Data plus Workers.

A third-party registration is pure data, so third-party code never needs to share the page's JavaScript scope. Code a third party brings runs in a dedicated Worker or behind a URL. The measured cost of a Worker round trip (§8.4) is small against any engine's own time. In-page tier checks are then a second line, not the only one.

### 14.3 Where thresholds live

In `models/gates.json`, keyed by capability, engine and the model id the engine reports (`hosted@typesafe/jev-1.14-20261014`). A new model version has no gate, so by L3 it cannot act until it has been measured.

The benchmark shows why this matters: fitted gates differ between engines, and between two hosts serving the same weights (`models/gates.json` / `results/TABLES.md`: `clef` 0.8846 against `clef@primeintellect` 0.8559; `clef-flash` 0.8794 against `clef-flash@primeintellect` 0.9101).

### 14.4 The router never pre-empts

Pre-emption of the body by voice is Brit's mechanism ("A halt word stops a move through the normal halt path", `sendTxtFrom`). His mechanism never skips the brain turn for a stop word: "the words still reach the turn". A router that skipped or replaced anything in his layer would be controlling it, not co-processing beside it.

### 14.5 The router consumes `think()`, never calls it

`think()` is single flight, speaks, and spends house credits or the person's key (`next.html:10750`). Who gets the creature's attention is the agent owner's decision, so the router publishes (§9.3) and his layer decides.

### 14.6 One vocabulary across lanes

Brit's triggers and commands and the router's are the same kinds of thing, distinguished by lane. Opening a class to new members never grants access to his members. This keeps one mental model for developers and makes the path from the open lane into his curated menu a change of lane, not a change of concept.

### 14.7 `generate` and chaining are admitted

Developers bring "their own models, their own primitives". A generative model is one of them. L1 keeps its output data, never a command. Chaining (§6.3) is what lets capabilities compose; the hop limit keeps it finite.

## 15. Open questions

1. **`when`: conditions on context.** Should a trigger be able to say "only while walking" or "only during a game"? Not a blocker for the next phase. Brit flagged per-rule conditions as an open gap in his own reflex table ("KNOWN GAPS (0630, OPEN for Brit): no conditional gate", `next.html:11591`). The options:
   - (a) Context stays central and owned by Brit's layer, as `fireReflex` keeps it today.
   - (b) A trigger may name a condition over a set of state names Brit's layer publishes.
   - (c) A trigger may carry a CSS selector tested against the live document. This would need his state reflected into the DOM, which his code does not do today.
2. **Bluetooth and serial attachments.** Neither API has recorded Worker support (§8.5). A path for them would need page-scope code, which §14.2 rules out for third parties. Options: a small bridge Brit's layer owns, or network-only attachments.
3. **The creature's door (§9.4).** Brit's decision. If he opens it, decide whether the person approves each command once at install time or each time the creature uses it.
4. **The hop limit for chaining** (§6.3). Today's code defaults to `maxHops: 3` across both synchronous and async capability chains.
5. **The exact data shapes** of §7.2–7.4, for review once the structure is accepted.

## 16. Where the code differs from this specification

All Phase 2 items (D1–D8) and Phase 2 audit items (#18–#41) are `[built]` in `src/` and `integration/` and verified by `test/run-all.mjs` (11 suites, 68 mutants). Remaining non-built items are explicitly scoped exclusions or open decisions: the `box` primitive (no verified shape yet), third-party host-bound key senders (`REQUIREMENTS.md` R-SEC-3 / `THREAT-MODEL.md` T7, `[specified]`), `when` conditions (§15.1, `[open]`), Bluetooth/serial attachments (§15.2, `[open]`), and Brit's optional page proposals (`integration/proposals/`, `[proposal to Brit]`).

## 17. What is deliberately not here

- Sensor-rate or motor-rate work.
- Open conversation.
- Any replacement of a clamp or stop path by a probability (MISSION non-goals).
- Changes to `app/`.
- A server-side route for the house key lane (Brit's server is not in this repo).
