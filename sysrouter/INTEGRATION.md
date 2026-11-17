# SysRouter — Integration plan

For Brit. Every step is small, stands on its own, changes nothing a user can see until you decide it should, and can be undone with one flag. Take as many as you like, in order, and stop wherever you want.

It follows `CONTRIBUTING.md`: an issue first, one change per pull request, about 300 lines, nothing against `app/`.

## The shape of it

- **Everything lives in one new folder**, `sysrouter/`, the way `policy/forward/` does. Nothing existing is edited.
- **The app page needs three one-line insertions**, which only you can make at the source, since `app/` is your mirror. They are written out, anchored and machine-checked in `integration/apply.mjs`:

  ```
  node sysrouter/integration/apply.mjs --diff     # the three lines, with where each goes
  node sysrouter/integration/apply.mjs --check    # do the anchors still match this snapshot?
  ```

  | # | Where | The line |
  |---|---|---|
  | 1 | after the `forward-choice.mjs` module script | `<script type="module" src="/sysrouter/boot.js?v=1117"></script>` |
  | 2 | in `sendTxtFrom`, after every local reader has acted, before `_imitationRequest` and the queue | `try{ if(!_bsnd&&typeof SysRouter!=="undefined"&&SysRouter) SysRouter.hear(t); }catch(_sr){}` |
  | 3 | in the reply handler, before the mood line | `try{ if(typeof SysRouter!=="undefined"&&SysRouter) SysRouter.replied(o); }catch(_sr){}` |

  Each is fenced `/*SYSROUTER{*/ … /*}SYSROUTER*/`, `typeof`-guarded and in a `try`, like its neighbours, so your slicing harnesses keep working.

- **It is off until `?sysrouter=1`**, like `?express=bench`. Once on, every route is in **shadow**: it decides, writes a `sysroute` row to the journal, and runs nothing. `?sysrouter=0` turns it off again.

**What proves the three lines are safe:** `test/test_funnel.mjs` slices your real `sendTxtFrom` out of `app/v3/next.html`, with and without line 2, and runs both over every line of the dataset in three states (idle, thinking, paused). The calls the funnel makes are identical, call for call, when SysRouter is absent, null, running in shadow, or throwing: 11,532 comparisons, 0 differences. The line adds 0.04 ms at the median.

## Step 0 — the issue

`CONTRIBUTING.md` asks for an issue before anything big. Proposed text:

> **Proposal: a small registry for the fast paths in `sendTxtFrom` (SysRouter)**
> The input funnel already routes: local readers first, the brain last. Each fast path is hand-placed. This proposes one small registry (255 lines, no dependencies) where a fast path is a registered question plus a table of which answer may trigger which existing executor, answered by your regex readers first and optionally by an on-device model or a decision model (Jev, Clef). It starts log-only behind `?sysrouter=1`. Evidence, tests and a benchmark are in [fork link]. I'd like to send it as a series of small PRs; the first is the registry and its tests, with no change to the app.

## The steps

Sizes are lines of code under review; tests are counted separately because they are the evidence, not the change.

| Step | Pull request | Code | Tests | Page change | Users see |
|---|---|---|---|---|---|
| 1 | **The router.** `sysrouter.js` | 255 | `test_router.mjs` 277 | none | nothing |
| 2 | **Your readers as the first provider.** `s1-readers.js` | 30 | `test_readers_regression.mjs` 65 + golden file | none | nothing |
| 3 | **The on-device engine and the wake route.** `s1-ngram.js`, `wakeword.js`, `models/wake.ngram.json` | 112 | `test_providers.mjs`, `fuzz_readers.mjs` | none | nothing |
| 4 | **Shadow on the live page.** `boot.js` + your three lines | 55 + 3 | `test_funnel.mjs` 89 | the three lines | nothing: rows in the journal for anyone who opens `?sysrouter=1` |
| 5 | **The expressive route.** `expressive.js`, `models/express.ngram.json` | 53 | `test_providers.mjs` | none | nothing (shadow) |
| 6 | **Keys and hosted engines.** `keys.js`, `s1-http.js`, `env.example`, `tools/keyscan.mjs`, `tools/proxy.mjs` | 101 + 98 tools | `test_keys.mjs` 70 | none | nothing unless they name an engine with `?s1=` and have supplied their own key or server |
| 7 | **Let one route act.** You define `SysRouterHost` (the executors: each a call the page already makes) and flip `?sysroute=wake:parallel` on the bench | your code | your harness | a `SysRouterHost` object | on the bench link only: a command the readers missed is acted on without waiting for the brain |
| 8 | **Soft reflexes.** `soft-reflex.js` | 55 | `test_providers.mjs` | a branch where `scratchpad.reflex` is applied | on the bench: the creature can write "when someone says something celebratory, trill" |

Optional, any time after step 6: `s1-embed.js` (MiniLM on the ONNX runtime you already ship, 86 lines) and `s1-chat.js` (a small chat model as a decision engine, 49 lines).

**Each step's evidence is one command**, on a fresh clone, with no key and no network: `node sysrouter/test/run-all.mjs`.

### Why this order

1–3 put code in the repo that nothing calls. 4 is the first time the page changes, and what it changes is provably nothing. Between 4 and 7 you have what you have asked for elsewhere in the code ("log-only first, then a shadow arm, then a flip"): real rows from real use, in your own journal, showing what each engine *would* have done and whether the brain's reply agreed (`why:"agree"`). Step 7 is yours to take, on your evidence, for whichever route has earned it.

### What I recommend you take first, and why

Steps 1–4 with the cascade **readers → on-device model**: no key, no vendor, no cost, no network, nothing leaves the phone. On the held-out data this roughly triples the share of spoken commands recognised without the brain, at a false-trigger rate of a few lines per thousand (`RESULTS.md` §2). The hosted engines recognise more, and step 6 lets a person who wants that add it with their own key; nothing in steps 1–5 depends on any vendor.

## What you would need to decide

1. **Where the files are served from.** The plan assumes `/sysrouter/` on growbot.dev. Any path works; `boot.js` finds its models relative to itself.
2. **The executors (step 7).** Which existing function each action calls. Suggested: `halt`/`still` → `_bodyHalt`; `follow`/`unfollow` → `_faceTrack.personFollow` / `.disable`; walks and spin → the same path a reply's `walk` field takes; `sing` → `playSing`; the feelings → the reply dispatcher's own setters for `emotion`, `burst` and `expression`. These are your calls to make: they are your clamps.
3. **A house lane for hosted engines (optional).** If `/api/llm` forwarded `target=openrouter-systemone` to OpenRouter's `/api/v1/systemone` the way it forwards chat, decision engines would ride the funding and metering you already have. `keys.js` already has the lane; it is off until the server offers it.
4. **Thresholds.** `models/gates.json` is fitted on this benchmark's data. Before a route acts for real users it should be refitted on your shadow rows.

## Undoing it

`?sysrouter=0` for one person. Remove the three fenced lines for everyone. Delete the folder and nothing else is affected: nothing outside `sysrouter/` imports it.
