// emote.js — the second co-processor: emote (SPEC §13.2, D6, D7).
// Reads both speakers on the speech stream (person and creature). Supports either a
// composed 2-step capability (embed -> choice head) or the one-step n-gram fallback.

export const EMOTE = {
  id: 'emote',
  question: {
    type: 'choice',
    instructions: 'A person is speaking to a small pet-like robot creature. How should the creature feel in response to what the person just said?',
    criteria: {
      happy: 'The person shares good news, praises the creature, celebrates, or shows affection.',
      sad: 'The person shares a loss, a disappointment, loneliness or sorrow.',
      scared: 'The person threatens, insults or shouts angrily at the creature, or says something frightening is about to happen to it.',
      alert: 'The person gives a warning, reports something sudden or urgent, or calls for attention right now.',
      curious: 'The person offers a puzzle, a secret, a new thing to look at, or wonders about something.',
      calm: 'An ordinary, neutral remark or a practical statement with no strong feeling.'
    }
  },
  notFor: 'Ordinary neutral talk and practical statements: those are “calm” and trigger nothing. Not for commands (the fuzzy route owns those).',
  on: { happy: 'feel_happy', sad: 'feel_sad', scared: 'feel_scared', alert: 'feel_alert', curious: 'feel_curious' },
  input: 'both',
  agree: 'emotion',
  policy: 'cascade',
  mode: 'shadow',
  budgetMs: 700,
  cooldownMs: 2500
};

export const EXPRESS_ROUTE = EMOTE;

export const REACTIONS = {
  feel_happy:   { emotion: 'happy',   burst: 'joy',     expression: 'perk' },
  feel_sad:     {                     burst: 'rain',    expression: 'droop' },
  feel_scared:  { emotion: 'scared',  burst: 'shiver',  expression: 'shiver' },
  feel_alert:   { emotion: 'alert',   burst: 'pulse' },
  feel_curious: { emotion: 'curious', burst: 'sparkle' }
};

export function registerEmote(sr, react, providers, over) {
  over = over || {};
  const isComposed = !!(over.embedEngine && over.headEngine);
  for (const id in REACTIONS) {
    sr.command({ id, run: () => { if (!isComposed && typeof sr.emit === 'function') try { sr.emit('emote', { type: 'pick', data: Object.assign({ id }, REACTIONS[id]) }); } catch (e) {} react(REACTIONS[id], id); }, resource: 'face', holdMs: 2500, exposeTo: ['person'] });
  }
  if (!sr.read('emote')) {
    try { sr.stream({ id: 'emote', types: ['pick'] }); } catch (e) {}
  }
  if (over.embedEngine && over.headEngine) {   // AUDIT-PHASE2 A14 (#29): the composed capability below gets no trigger (never runs on speech) and replied() never writes its agree rows.
    return sr.capability({
      id: over.id || 'emote_composed',
      steps: [
        { primitive: 'embed', engines: [over.embedEngine] },
        { primitive: 'choice', engines: [over.headEngine], question: EMOTE.question }
      ],
      budgetMs: over.budgetMs || EMOTE.budgetMs,
      mode: over.mode || EMOTE.mode,
      agree: EMOTE.agree,
      behavior: { publish: 'emote', request: EMOTE.on }
    });
  }
  return sr.route(Object.assign({}, EMOTE, { providers }, over));
}

export const registerExpress = registerEmote;
