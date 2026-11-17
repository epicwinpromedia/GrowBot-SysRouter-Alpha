// s1-http.js — any engine that speaks the shared decision contract (research/VENDORS.md §1):
// TypeSafe Jev, Cloudflare Clef and Clef-flash, and OpenRouter's route to them. One body shape
// goes out ({ model, state, questions }), one comes back ({ model, answers, usage }), so a new
// engine is a new line of configuration, not a new provider (R-RT-2).
//
// The provider never sees a key. `send(body, signal)` comes from the key resolver (keys.js),
// which binds each key to its one host (R-SEC-3). Usage:
//   sr.provider('clef-flash', httpProvider({ model: 'cloudflare/clef-flash', send: keys.sender('systemone') }));
//
// usdPerMTok prices a call when the reply carries no cost of its own (TypeSafe and Cloudflare
// report tokens; OpenRouter reports usage.cost). Prices are configuration with a source and a
// date, never constants in code (sysrouter/bench/arms.json).

export function httpProvider(cfg) {
  const model = String(cfg.model || ''), price = +cfg.usdPerMTok || 0;
  return {
    model, types: ['noul', 'choice', 'score'],
    async ask(req, ctx) {
      const res = await cfg.send(Object.assign({ model, state: req.state, questions: req.questions }, cfg.extra), ctx && ctx.signal);   // extra: host routing such as OpenRouter's { provider }
      const r = res && res.result && res.result.answers ? res.result : res;          // Cloudflare REST wraps the reply in { result }
      if (!r || !r.answers) throw new Error('s1-http: no answers');
      const u = r.usage || {}, tok = +u.input_tokens || 0, up = u.cost_details && u.cost_details.upstream_inference_cost;
      // what the call cost at the engine: OpenRouter reports it as upstream cost when the call ran on the user's own vendor key (usage.cost is then 0)
      return { model: r.model || model, answers: r.answers, usage: { input_tokens: tok },
        usd: typeof up === 'number' ? up : typeof u.cost === 'number' ? u.cost : price ? tok * price / 1e6 : undefined };
    }
  };
}
