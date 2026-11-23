# SysRouter — Integration plan (v2, 2026-11-17)

For Brit. Every step is small, stands on its own, changes nothing a user can see until you decide it should, and can be undone with one flag. Take as many as you like, in order, and stop wherever you want.

It follows `CONTRIBUTING.md`: an issue first, one change per pull request, about 300 lines, nothing against `app/`.

## What this is, in one paragraph

SysRouter runs **alongside** your layer, never in front of it. It reads what your page already produces (the person's words, the brain's reply). It reaches your layer only by **requesting** commands you chose to expose, and your own code decides what happens. It never pre-empts anything and never calls `think()`. Your body layer and your creature agent stay entirely yours. What it adds is a sanctioned, controlled place where engines (your regex readers, small on-device models, Jev, Clef, a developer's own model or hardware) co-process in parallel, plus an open lane where developers can bring their own engines, sensors and effects without touching your code. `MISSION.md` §3–§5 has the boundary; `SPEC.md` §9 has the contract.

## The shape of it

- **Everything lives in one new folder**, `sysrouter/`, the way `policy/forward/` does. Nothing existing is edited.
- **Shadow needs three insertions in the page** (five lines with their fences), which only you can make at the source, since `app/` is your mirror. They are written out, anchored and machine-checked in `integration/apply.mjs`:

  ```
  node sysrouter/integration/apply.mjs --diff     # the insertions, with where each goes
  node sysrouter/integration/apply.mjs --check    # do the anchors still match this snapshot?
  ```

  | # | Where | The line |
  |---|---|---|
  | 1 | after the `forward-choice.mjs` module script | `<script type="module" src="/sysrouter/boot.js?v=1117"></script>` |
  | 2 | in `sendTxtFrom`, after every local reader has acted, before `_imitationRequest` and the queue | `try{ if(!_bsnd&&typeof SysRouter!=="undefined"&&SysRouter) SysRouter.hear(t); }catch(_sr){}` |
  | 3 | in the reply handler, before the mood line | `try{ if(typeof SysRouter!=="undefined"&&SysRouter) SysRouter.replied(o); }catch(_sr){}` |

  Each is fenced `/*SYSROUTER{*/ … /*}SYSROUTER*/`, `typeof`-guarded and inside a `try`, like its neighbours, so your slicing harnesses keep working.

- **It is off until `?sysrouter=1`**, like `?express=bench`. Once on, everything is in **shadow**: it decides, writes a `sysroute` row to the journal, and requests nothing. `?sysrouter=0` turns it off again.
- **Letting anything act needs one more thing from you**: the commands you expose (step 7). That is where your control sits, and it is more than three lines.

**What proves the three insertions are safe:** `test/test_funnel.mjs` slices your real `sendTxtFrom` out of `app/v3/next.html`, with and without line 2. It runs both over every line of the dataset in three states (idle, thinking, paused). The calls the funnel makes are identical, call for call, when SysRouter is absent, null, running in shadow, or throwing. The suite passes as of 2026-11-17 (`node sysrouter/test/run-all.mjs`).

## Step 0 — the issue

`CONTRIBUTING.md` asks for an issue before anything big. Proposed text:

> **Proposal: a co-processing router beside the brain (SysRouter)**
> GrowBot's fast paths are hand-placed in `sendTxtFrom`, and the reflex table understands only sensors. This proposes a small registry (one module, no dependencies) where engines (your regex readers first, then optionally an on-device model or a decision model such as Jev or Clef) co-process what the person says, in parallel with the brain and never in front of it. It reaches the body only by requesting commands you expose, through your own command path. The first two uses: fuzzy commands (a phrasing that means "stop" or "follow me" but that the readers miss) and emote (the face reacting while the brain is still thinking). It starts log-only behind `?sysrouter=1`. Evidence, tests and a benchmark are in [fork link]. I'd like to send it as a series of small PRs. The first is the registry and its tests, with no change to the app.

## The steps

Sizes are lines of code under review. Tests are counted separately because they are the evidence, not the change.

| Step | Pull request | Code | Tests | Page change | Users see |
|---|---|---|---|---|---|
| 1 | **The router.** `sysrouter.js`, `registry.js` | 545 + 451 | `test_router.mjs` 830, `mutants.mjs` 108, `fuzz_router.mjs` 104 | none | nothing |
| 2 | **Your readers as the first engine.** `s1-readers.js` | 31 | `test_readers_regression.mjs` 66 + golden file | none | nothing |
| 3 | **The on-device engine and fuzzy commands.** `s1-ngram.js`, `fuzzy.js`, `models/wake.ngram.json` | 148 | `test_providers.mjs`, `fuzz_readers.mjs` | none | nothing |
| 4 | **Shadow on the live page.** `boot.js` + your three insertions | 114 + 5 | `test_funnel.mjs` 161 | the insertions | nothing: rows in the journal for anyone who opens `?sysrouter=1` |
| 5 | **Emote.** `emote.js`, `models/express.ngram.json` | 70 | `test_providers.mjs` | none | nothing (shadow) |
| 6 | **Keys and hosted engines.** `keys.js`, `s1-http.js`, `env.example`, `tools/keyscan.mjs`, `tools/proxy.mjs` | 101 + 98 tools | `test_keys.mjs` 70 | none | nothing, unless they name an engine with `?s1=` and have supplied their own key or server |
| 7 | **Let one capability act.** You expose commands (below), and flip `?sysroute=fuzzy:live` on the bench | your code | your harness | `SysRouterHost` | on the bench link only: a command your readers missed is requested through your own command path |
| 8 | **Soft reflexes.** `soft-reflex.js` | 55 | `test_providers.mjs` | a branch where `scratchpad.reflex` is applied | on the bench: the creature can write "when someone says something celebratory, trill" |

Optional, any time after step 6: `s1-embed.js` (MiniLM on the ONNX runtime you already ship, 107 lines) and `s1-chat.js` (a small chat model used as a decision engine, 49 lines).

**Each step's evidence is one command**, on a fresh clone, with no key and no network: `node sysrouter/test/run-all.mjs`.

### Why this order

Steps 1–3 put code in the repo that nothing calls. Step 4 is the first time the page changes, and what it changes is provably nothing. Between 4 and 7 you have what you have asked for elsewhere in the code ("log-only first, then a shadow arm, then a flip"): real rows from real use, in your own journal. They show what each engine *would* have requested and whether the brain's reply agreed (`why:"agree"`). Step 7 is yours to take, on your evidence, for whichever capability has earned it.

### What I recommend you take first, and why

Steps 1–4 with the cascade **readers → on-device model**: no key, no vendor, no cost, no network, and nothing leaves the phone. On the held-out data, your readers alone recognise 20.1% of the command lines; `readers → ngram` recognises 57.2%, at a false-trigger rate of 0.6% on non-commands and a wrong-action rate of 1.7% on command lines (0.4% across all lines), compared with 0.6% on command lines (0.1% all lines) for `readers` alone, 0.9% (0.2% all lines) for `readers → jev`, and 0.6% (0.1% all lines) for `readers → clef-flash` (`results/TABLES.md`). The hosted engines recognise more (`readers → jev`: 83.3%). Step 6 lets a person who wants that add it with their own key. Nothing in steps 1–5 depends on any vendor.

## What you would need to decide

### Required, for anything to act (step 7)

1. **Which commands you expose, and through what.** `SysRouterHost.run` holds one entry per command you choose to expose. The contract is that **an entry is your whole command path**, not one function inside it. When your reader hears a literal "stop", `sendTxtFrom` runs:
   - `_namedHalt`, `_gsHear`, `_recHalt`, `_partsHalt("words")` and `_bodyHalt()`;
   - the face-tracker latch, the bench-answer hush, and the toast.

   The words still go to the brain. A fuzzy "stop" must do exactly the same. The clean way is to factor that branch into one function your reader also calls, for example `_applyCommand(kind, by)`, and to expose that. For walks, spin, sing and feelings, the entry is whatever your reply dispatcher already calls for those fields. These are your calls to make: they are your clamps.
2. **Where the files are served from.** The plan assumes `/sysrouter/` on growbot.dev. Any path works; `boot.js` finds its models relative to itself.
3. **Thresholds.** `models/gates.json` is fitted on this benchmark's data. Before a capability acts for real users, it should be refitted on your shadow rows.

### Optional, each independent, each yours to decline

4. **The creature's words as a stream.** One line where the reply's `say` is spoken: `SysRouter.hear(o.say, { from: 'creature' })`. Emote then reads both speakers.
5. **Sharing your sensor triggers.** One line inside `fireReflex` (or beside each call) so developers' triggers can react to `tap`, `loud`, `fall` and the rest. They read; they never change your reflexes.
6. **Reading what the router publishes.** `sr.read(stream)` and `sr.watch(stream, fn)` let your layer show results to the brain as context, or start a brain turn under your own guards. The router never calls `think()`.
7. **The creature's door.** If you want the creature to be able to use a command a developer brought (a siren, a retrieval oracle):
   - a context line that lists the commands the person exposed to the creature;
   - a reply field that names one, which your dispatcher passes to the router.

   This is the same pattern as `scratchpad.reflex` (`SPEC.md` §9.4).
8. **A block list.** A list your server publishes, as `/api/config` does today, naming third-party extensions the loader must refuse (`SPEC.md` §9.5).
9. **A house lane for hosted engines.** If `/api/llm` forwarded `target=openrouter-systemone` to OpenRouter's `/api/v1/systemone` the way it forwards chat, decision engines would ride the funding and metering you already have. `keys.js` already has the lane; it stays off until the server offers it.

## Undoing it

`?sysrouter=0` for one person. Remove the fenced insertions for everyone. Delete the folder and nothing else is affected: nothing outside `sysrouter/` imports it.
