// soft-reflex.js — meaning triggers beside the eleven sensor triggers (MISSION "why" 3, R-REG-4).
// The reflex table lets the creature write "when <sense>, <sound>" (TRIGS / ACTS, next.html).
// A soft reflex is the same idea with a MEANING for the trigger: "when someone says something
// celebratory, trill". The creature writes it through the same kind of whitelist-clamped
// record, and it becomes one yes/no route.
//
// What keeps this safe:
//   • the act is one of SOFT_ACTS, each a sound or light the reflex table already plays.
//     Not `word` or `move`: those carry text or steps the model authored, and a soft reflex
//     may only SELECT (the router's first law).
//   • it is registered through an extension facade named "creature": extension tier, granted
//     only these acts and the providers the page chose, rate-capped, never pre-empting.
//   • `not` is required: the rule must say what it should not fire on (R-REG-5).
//   • at most MAX_SOFT rules, a 4 s cooldown each, shadow until the page says otherwise.

export const SOFT_ACTS = ['beep', 'trill', 'droop', 'hum', 'glow'];
export const MAX_SOFT = 6;

// rule: { when: "someone says something celebratory", not: "ordinary talk", act: "trill" }
// Returns a route spec, or null when the rule is not a clean soft reflex (the caller then
// leaves it as an ordinary rule, exactly as reflexFromRule does for sense rules).
export function softReflexRoute(rule, n) {
  if (!rule || typeof rule !== 'object') return null;
  const when = String(rule.when || '').replace(/\s+/g, ' ').trim(), not = String(rule.not || '').replace(/\s+/g, ' ').trim(), act = String(rule.act || '');
  if (when.length < 8 || when.length > 120 || not.length < 12 || not.length > 120 || !SOFT_ACTS.includes(act)) return null;
  if (!(n >= 0 && n < MAX_SOFT)) return null;
  return {
    id: 'soft.' + n,
    question: { type: 'noul', instructions: 'A person is speaking to a small robot creature. Does what they just said match this description: ' + when + '?',
      criteria: { true: when, false: 'Anything else, including: ' + not } },
    notFor: not,
    on: { true: 'reflex_' + act },
    policy: 'single', mode: 'shadow', budgetMs: 700, cooldownMs: 4000
  };
}

// The page registers the acts once (each `play[act]` is a call fireReflex already makes),
// then hands back add/remove for the creature's rules.
//   const soft = softReflexes(sr, { beep: () => sfx('beep'), ... }, 'clef-flash');
//   soft.add({ when, not, act })  ->  route id or ""      soft.remove(id)
export function softReflexes(sr, play, provider) {
  for (const a of SOFT_ACTS) sr.action('reflex_' + a, { run: play[a], resource: 'voice', holdMs: 1200, exposeTo: ['third-party'] });
  if (typeof sr.exposeStream === 'function') sr.exposeStream('speech', ['third-party']);
  const ext = sr.extension('creature', { actions: SOFT_ACTS.map((a) => 'reflex_' + a), providers: [provider], streams: ['speech'], perMin: 30 }), used = new Array(MAX_SOFT).fill(false);
  return {
    add(rule) {
      const n = used.indexOf(false), spec = softReflexRoute(rule, n);
      if (!spec) return '';
      spec.providers = [provider];
      try { ext.route(spec); } catch (e) { return ''; }
      used[n] = true;
      return spec.id;
    },
    remove(id) { const n = +String(id).slice(5); if (!ext.unroute(id)) return false; used[n] = false; return true; }
  };
}
