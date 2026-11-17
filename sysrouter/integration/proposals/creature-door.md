# Proposal (b): The Creature's Door (`creature-door`)

Status: **Documented proposal** (not applied to `app/`, not tested against the creature's prompt).
Spec: `SPEC.md` §9.4, `PLAN-PHASE2.md` §2C.4(b).

## 1. Prompt context line

When building the creature's prompt context, list any commands whose `exposeTo` includes `'creature'` (supplied by the host or granted by the person):

```js
// Inside prompt context assembly (when SysRouter is present):
// e.g. "commands you may request via cmd:{id,args}: siren.on(seconds:1..30)"
```

## 2. Reply field `cmd: { id, args }`

In the reply handler (`think()`), after parsing `o` and validating its existing fields, forward an optional `o.cmd` to the router port:

```js
/*SYSROUTER{*/
try {
  if (o && o.cmd && typeof o.cmd === "object" && typeof SysRouter !== "undefined" && SysRouter) {
    SysRouter.request(o.cmd.id, o.cmd.args, { from: "creature" });
  }
} catch (_sr) {}
/*}SYSROUTER*/
```

The router enforces `exposeTo.includes('creature')`, third-party person grants, schema-checked `args`, cooldowns/holds, and the per-source rate cap (`reqPerMin`), logging `acted`, `bad_args`, `rate`, or `refused` without the page needing any extra guard.
