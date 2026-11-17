# SysRouter — Specification (v1, 2026-11-17)

This is the contract the reference implementation in `src/` follows and the tests in `test/` enforce. Each rule cites the requirement it answers (`REQUIREMENTS.md`) and the test that proves it. Where a requirement left a decision open, the decision and its reasons are in §9.

The whole shipped path is nine small files with no dependencies (`src/`, 785 lines; the router itself is `src/sysrouter.js`, 255 lines).

---

## 1. The four things

| Thing | What it is | Who defines it |
|---|---|---|
| **Action** | A named call into an executor the page already has (`_bodyHalt`, the expression gate, a reflex sound). It has an optional shared resource (`legs`, `voice`, `face`) and hold time. | The page, and only the page |
| **Provider** | An engine that answers a typed question about some text. | The page |
| **Route** | A question, the table of which answer may trigger which action, the providers to ask and in what order, and a mode. **Pure data: no functions.** | The page, or an extension through its facade |
| **Gate** | The probability a given provider (and model version) must reach on a given route before its answer counts. | Fitted from data (`bench/report.mjs`), loaded as `models/gates.json` |

```js
const sr = createRouter({ log: logEv, flags: readFlags(location.search, localStorage) });
sr.action('halt', { run: _bodyHalt, reserved: true });
sr.provider('readers', readersProvider((t) => ftPick(_ftWords(t))));
sr.route({ id: 'wake', question: {...}, notFor: '...', on: { halt: 'halt' }, providers: ['readers', 'ngram-wake'], policy: 'cascade' });
sr.calibrate(gates);
sr.seal();
// in sendTxtFrom, after the local readers:
try{ if(typeof SysRouter!=="undefined"&&SysRouter) SysRouter.hear(t); }catch(_sr){}
```

## 2. The laws

Every law has a test that passes and a deliberately broken router ("mutant") that the tests catch (`test/mutants.mjs`, 25 of 25).

| # | Law | Requirement | Proved by |
|---|---|---|---|
| L1 | **Select, never author.** An answer can only pick a key of `route.on`; that key can only name a registered action. No field of an engine's reply reaches an executor. | R-REG-2, R-SAFE-2, G4 | `test_router` "select, never author"; fuzz invariant "ran something that is not a registered action" |
| L2 | **Shadow first.** A route's default mode is `shadow`: it decides and logs and runs nothing. | R-RT-4 | `test_router`; `test_funnel` (9,819 funnel calls, 0 actions) |
| L3 | **No gate, no action.** A probabilistic provider with no fitted gate for this route never acts, even at p = 1. Gates are data, never route logic. | R-RT-6 | `test_router` "no fitted gate" |
| L4 | **Fail to today.** Timeout, error, malformed reply, missing key, low confidence: nothing runs, the row says why, and the words go down the path they take today. Nothing the router does can throw into the funnel. | R-SAFE-3, G6 | `test_router` "fail to today" (14 malformed replies); `test_funnel` "hear() throws" |
| L5 | **The person's newest words decide.** An answer about older words that lands after newer words is dropped (`stale`). | funnel convention (`_expressionPerson`) | `test_router` "newest words" |
| L6 | **Stop is code.** Reserved actions are registered before `seal()`. A deterministic provider's stop runs in the same tick as `hear()`. A probability alone can never be the path to a reserved action; a route may only *add* a stop the deterministic layer missed (`addsRecall`). A stop ignores cooldowns and holds, and clears every hold. | R-SAFE-1 | `test_router` "stop is code"; `test_readers_regression` part 3 |
| L7 | **The kill switch is total.** `?sysrouter=0` (persisted): no provider is asked, no action runs, no row is written. | R-SAFE-4 | `test_router` "kill switch" |
| L8 | **The words never enter a row.** A journal row carries route, engine, answer, probability, timing and cost, never the text. | R-OBS-2 | `test_router` "observability"; fuzz invariant |

## 3. Questions and answers

A route asks **one** question, in the request shape TypeSafe Jev, Cloudflare Clef and OpenRouter share (`research/VENDORS.md` §1), so those engines need no translation:

| Type | `criteria` | Answer the router accepts | The pick |
|---|---|---|---|
| `choice` | `{ option: "description", … }` (2–64) | `{ choice, probabilities }` | `choice`, which must be a listed option |
| `noul` | `{ true: "…", false: "…" }` | `{ noul: 0..1 }` | `true` if ≥ 0.5 |
| `score` | `["lowest", …, "highest"]` (2–10) | `{ score, probabilities }` | the most probable level, numbered from 0 as the engines number them |

Every field is checked before use (`readAnswer`): a pick outside the options, a probability outside 0..1, a non-number, or a prototype key (`__proto__`, `constructor`) is `bad_answer`. A provider may also return `{ abstain: true }`: "my rules do not cover this", which lets a cascade continue and is never a confident no.

## 4. Providers

```js
{ ask(req, ctx) -> { model, answers: { q }, usage?, usd? },   // req = { state, questions: { q } }, ctx.signal aborts at the route's budget
  sync?: true,    // answers in the same tick (no promise)
  exact?: true,   // deterministic rules: a match needs no gate
  types: ['noul','choice','score'] }
```

| Provider | File | Kind | Notes |
|---|---|---|---|
| Brit's readers | `s1-readers.js` | sync, exact | Calls `_ftWords` as it is. Abstains when no rule matches. |
| n-gram model | `s1-ngram.js` | sync, on-device | One JSON file per route (~190 kB), a hand-written forward pass like `growbot_policy.js`. |
| MiniLM | `s1-embed.js` | async, on-device | Runs on the ONNX Runtime Web build the app already ships. Trained head, or zero-shot from the option descriptions. |
| Jev / Clef | `s1-http.js` | async, hosted | One body shape; the model is configuration. |
| small chat model | `s1-chat.js` | async, hosted | Any OpenAI-style endpoint; the options are lettered lines and exactly one letter is accepted. |

Adding an engine is a line of configuration (`bench/arms.json` for the benchmark, `?s1=<model>` in the page): no route changes (R-RT-2).

## 5. Routes: policy and mode

**Policy** is how the providers are consulted:

| Policy | Behaviour |
|---|---|
| `single` | one provider |
| `cascade` | in order. The first *confident* answer ends it, including a confident "nothing". A spent time budget ends it. |
| `race` | all at once. The first *confident* answer wins, not the first to arrive. |
| `shadow: [...]` (extra list) | asked and logged beside any policy; can never act. This is how a candidate engine is trialled on live traffic. |

**Mode** is what happens to a decision:

| Mode | Behaviour |
|---|---|
| `shadow` (default) | logged only |
| `parallel` | the action runs; the words still go to the brain as they do today |
| `preempt` | the action runs and `hear()` returns `preempt: true`, so the caller may skip the brain turn. Not available to extensions. |

The requirements listed "shadow" and "cascade" under both headings (R-RT-1, R-RT-4). They are separated here because they answer different questions; the table above is the resolution.

Other route fields: `notFor` (required: what the route must *not* fire on, R-REG-5), `budgetMs` (20–10,000, default 1,500), `cooldownMs` (per action: a debounce, never a block on a different command), `input` (`person`, `creature`, `both`), `agree` (the reply field to compare with, for the agreement row), `addsRecall`.

Gates have two numbers per (route, provider, model version): `p` for an answer that triggers an action, and `pn` for an answer that triggers nothing, i.e. how sure "nothing was asked" must be before a cascade stops there instead of asking the next engine.

## 6. Tiers, resources and extensions

- **Tiers** are `core`, `system`, `extension`. The tier comes from *which function registered the route* (`sr.core`, `sr.route`, or an extension's facade), never from the route's own data (R-TRUST-1).
- **Resources.** An action that names a resource holds it for `holdMs`. A lower tier is refused (`held`) while a higher tier holds it; equal tiers follow "newest wins", as the app does today. A reserved action clears every hold (R-TRUST-2).
- **An extension gets a facade and nothing else:** `sr.extension(name, { actions, providers, perMin })` returns a frozen object with `route`, `unroute`, `grants`. It can add and remove only its own routes, over only the actions and providers it was granted, at its own rate cap; it cannot pre-empt the brain, reach a reserved action, or see other routes, gates or keys (R-TRUST-3, R-TRUST-4).
- **Soft reflexes** (`soft-reflex.js`) are the creature's own meaning-triggers ("when someone says something celebratory, trill"). They are registered through an extension facade named `creature`, limited to five sounds and lights the reflex table already plays, six rules, shadow by default (R-REG-4).

## 7. The journal row (R-OBS)

One row per decision, through `logEv("sysroute", …)`, in the journal's existing short-key style:

| Key | Meaning |
|---|---|
| `r`, `tier`, `ext`, `mode` | route id, its tier, the extension's name if any, the mode in force |
| `p`, `m` | provider id, and the model id as the engine reported it |
| `a`, `pr` | the answer and its probability (3 decimals) |
| `ms`, `tok`, `usd` | time to answer, input tokens, cost of the call |
| `act`, `did` | the action the answer maps to, and `1` if it ran |
| `why` | `acted`, `preempt`, `shadow`, `none`, `unsure`, `no_gate`, `abstain`, `bad_answer`, `timeout`, `error`, `stale`, `cooldown`, `held`, `rate`, `act_error`, `shadow_arm`, `agree`, `boot`, `unwired` |

`sr.replied(reply)` writes one `agree` row per route that set `agree`: what the fast engine picked, what the brain's reply said, and whether they matched (R-OBS-3).

## 8. Flags (R-SAFE-4)

Read from the URL and persisted to `localStorage`, like `?bodysnd=0` and `?express=bench`:

| Flag | Effect |
|---|---|
| `?sysrouter=1` | boot the router (it is off until asked for) |
| `?sysrouter=0` | off: the page behaves exactly as today |
| `?sysroute=wake:parallel,express:off` | per route: `off`, `shadow`, `parallel`, `preempt` |
| `?s1=cloudflare/clef-flash` | also ask this hosted engine, through a lane the person configured (§10) |

## 9. Decisions the requirements left open

**System lane vs extension lane (R-TRUST): should the system be privileged, and how is hijacking prevented?**
Yes. The contended resources are single (one pair of legs, one voice, one brain flight, one budget), and a person's trust in the creature rests on its own behaviour being predictable. So: the system tier outranks extensions on every shared resource, `core` stops outrank everything, and an extension is confined to what it was granted. Hijacking is prevented structurally by L1: an extension contributes *data* (a question and a table), never code that touches the body, and its table can only name actions the page granted it.

**Isolation (R-TRUST-5): cooperative tiers, or a hard boundary?**
A route is pure data, so **an extension never needs to load code into the page**: it is a JSON document the loader passes to `extension().route()`. That removes the main reason to share a JavaScript scope with third-party code. An extension that brings its own *engine* runs it behind a URL or in a Web Worker and is registered as a provider by the page. The measured cost of a Worker message round trip is in `RESULTS.md` §6 (well under a millisecond at full speed, around a millisecond at the 95th percentile with the CPU slowed 6×), which is small against any engine's own time. Recommendation: data-only extensions by default; a Worker for extension engines. The in-page tier checks are then a second line, not the only one.

**Where thresholds live (R-RT-6).** In `models/gates.json`, keyed by route, provider and the model id the engine reports (`hosted@typesafe/jev-1.14-20261014`). A new model version has no gate, so by L3 it cannot act until it has been measured. The benchmark shows why this matters: the fitted gates differ between engines, and between two hosts serving the same weights (`RESULTS.md` §4).

## 10. Keys (R-SEC)

`src/keys.js` is the one resolver, with the same interface in Node and the browser. A caller asks for a *sender* by purpose and never receives a key. Lanes, first configured wins:

| Lane | Where the key lives | Sent to |
|---|---|---|
| `own` | on your own server or `tools/proxy.mjs`; the page holds **no key** | the host in `SYSROUTER_URL` / `pb_s1_url` (https, or localhost) |
| `byok` | `.env` (`OPENROUTER_API_KEY`) or the browser's existing `pb_byok` | `openrouter.ai` only |
| `typesafe` | `.env` (`TYPESAFE_API_KEY`), Node only | `api.typesafe.ai` only |
| `house` | none in the page; the site's proxy on house credits | the page's own origin. Needs a server route that does not exist yet. |

Guarantees, each tested in `test/test_keys.mjs`: a key goes only to its lane's host, over https, with redirects refused; it is never returned, logged or left in an error message; `describe()` shows six leading and three trailing characters.

One list of every variable, what reads it and where it is sent: `env.example` at the repo root. A check that refuses a commit containing a key shape: `tools/keyscan.mjs` (also run in CI).

**Browser storage (R-SEC-4), evaluated.** Encrypting `pb_byok` at rest with a non-extractable WebCrypto key would protect a copied profile, a backup or an exported soul. It would not protect against script running in the page, which can ask the same WebCrypto key to decrypt. Since the page's threat is in-page script (`THREAT-MODEL.md` T6), encryption at rest buys little there; the `own` lane, which keeps the key out of the browser entirely, is the real answer and is implemented.

## 11. What is deliberately not here

Sensor-rate or motor-rate work, open conversation, any replacement of a clamp or stop path by a probability (MISSION non-goals). Changes to `app/`. A server-side route for the house lane (Brit's server is not in this repo).
