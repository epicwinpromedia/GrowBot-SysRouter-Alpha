// test_boot.mjs — boots src/boot.js against a fake window serving real models/ files (#40, #28, #29).
//   node sysrouter/test/test_boot.mjs

import { readFileSync } from "node:fs";
import { boot } from "../src/boot.js";
import { FUZZY } from "../src/fuzzy.js";
import { ROOT } from "../bench/lib.mjs";
import { check, done } from "./t.mjs";

function modelFetch(opts) {
  opts = opts || {};
  return async (url) => {
    const name = String(url).split("/").pop();
    if (opts.skip && opts.skip.includes(name)) return { ok: false, status: 404 };
    try {
      const txt = readFileSync(ROOT + "models/" + name, "utf8");
      return { ok: true, json: async () => JSON.parse(txt), text: async () => txt };
    } catch (e) {
      return { ok: false, status: 404 };
    }
  };
}

// 1. Default off unless ?sysrouter=1
{
  const w = { location: { search: "", origin: "https://growbot.dev" }, localStorage: {} };
  const port = await boot(w, { fetch: modelFetch() });
  check("boot stays off by default when ?sysrouter=1 is absent", port === null && w.SysRouter === null);
}

// 2. Frozen port, n-gram gate lookup, and exposure filter with SysRouterHost.command() (default 4 kinds)
{
  const rows = [], called = [];
  const w = {
    location: { search: "?sysrouter=1&sysroute=fuzzy:live", origin: "https://growbot.dev" },
    localStorage: {},
    logEv: (e, d) => { if (e === "sysroute") rows.push(d); },
    SysRouterHost: { command: (kind, by) => called.push([kind, by]) }
  };
  const port = await boot(w, { fetch: modelFetch() });
  check("boot publishes frozen port on window.SysRouter with no system-lane methods",
    w.SysRouter === port && Object.isFrozen(port) && !("route" in port) && !("seal" in port) && !("provider" in port));
  const fuzzy = port.list().find((r) => r.id === "fuzzy");
  check("boot with host.command() exposes only the 4 default kinds (halt, still, follow, unfollow)",
    fuzzy && Object.keys(fuzzy.on).sort().join() === "follow,halt,still,unfollow", fuzzy);
  await port.hear("stop that right now").done;
  check("n-gram gate (ngram-fuzzy@wake.ngram-v1) is found and acts on exposed command",
    called.length === 1 && called[0][0] === "halt" && called[0][1] === "sysrouter", [called, rows]);
  called.length = 0;
  await port.hear("please spin around").done;
  check("unexposed spin logs why:unexposed with did:0 and never calls host.command",
    called.length === 0 && rows.some((r) => r.r === "fuzzy" && r.a === "spin" && r.why === "unexposed" && r.did === 0), [called, rows]);
}

// 3. Explicit SysRouterHost.commands list + run fallback
{
  const ran = [];
  const w = {
    location: { search: "?sysrouter=1&sysroute=fuzzy:live", origin: "https://growbot.dev" },
    localStorage: {},
    SysRouterHost: { commands: ["halt", "spin"], run: { halt: () => ran.push("halt"), spin: () => ran.push("spin"), sing: () => ran.push("sing") } }
  };
  const port = await boot(w, { fetch: modelFetch() });
  const fuzzy = port.list().find((r) => r.id === "fuzzy");
  check("SysRouterHost.commands filters exposed command table to declared kinds",
    fuzzy && Object.keys(fuzzy.on).sort().join() === "halt,spin", fuzzy);
  await port.hear("please spin around").done;
  check("exposed spin runs when declared in SysRouterHost.commands", ran.join() === "spin", ran);
}

// 4. Composed emote (embed -> choice) wired when MiniLM is present, n-gram fallback when absent (#29)
{
  const head = JSON.parse(readFileSync(ROOT + "models/express.minilm-head.json", "utf8"));
  const happyIdx = head.classes.indexOf("happy");
  const happyVec = Float32Array.from(head.W[happyIdx]);
  const rows = [], reacted = [];
  const w = {
    location: { search: "?sysrouter=1&sysroute=emote:live", origin: "https://growbot.dev" },
    localStorage: {},
    logEv: (e, d) => { if (e === "sysroute") rows.push(d); },
    SysRouterHost: { react: (fields, id) => reacted.push(id) }
  };
  const port = await boot(w, { fetch: modelFetch(), embed: async () => happyVec });
  check("boot wires composed emote capability instead of n-gram route when MiniLM is available",
    !port.list().some((r) => r.id === "emote"));
  await port.hear("that is wonderful news!").done;
  port.replied({ say: "yay!", emotion: "happy" }, "event");
  check("composed emote decides on port.hear(), publishes to emote, reacts, and writes agree row",
    port.read("emote") && port.read("emote").data === "happy" && reacted.includes("feel_happy") &&
    rows.some((r) => r.r === "emote" && r.why === "agree" && r.a === "happy" && r.ok === 1),
    [port.read("emote"), reacted, rows]);

  // Fallback when MiniLM is absent
  const w2 = { location: { search: "?sysrouter=1", origin: "https://growbot.dev" }, localStorage: {} };
  const port2 = await boot(w2, { fetch: modelFetch({ skip: ["express.minilm-head.json"] }) });
  check("boot falls back to n-gram emote route when MiniLM is not loaded",
    port2.list().some((r) => r.id === "emote" && r.providers.includes("ngram-emote")), port2.list());
}

void FUZZY;
done("boot path");
