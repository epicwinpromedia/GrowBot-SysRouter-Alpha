// expressive.js — the second co-processor: the expressive loop (MISSION G3, R-REG-3).
// Today every expressive channel is a field of the brain's one JSON reply (emotion, sound,
// burst, sky, expression; prompts.js buildOutputSchema), so the body cannot react until the
// whole thought is back. This route asks ONE question of what the person just said and
// selects one registered reaction, so the face and body can answer in the time a System One
// engine takes. The brain's reply still wins: when it lands, the page applies it as it does
// today and calls sr.replied(reply), which also logs whether the two agreed.
//
// This file is DATA plus one helper. The reactions are the reply schema's own emotion words
// plus "sad", which the schema has as the droop expression but not as an emotion.

export const EXPRESS_ROUTE = {
  id: 'express',
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
  notFor: 'Ordinary neutral talk and practical statements: those are “calm” and trigger nothing. Not for commands (the wake route owns those).',
  // `calm` has no action: no reaction is the right reaction to an ordinary sentence.
  on: { happy: 'feel_happy', sad: 'feel_sad', scared: 'feel_scared', alert: 'feel_alert', curious: 'feel_curious' },
  agree: 'emotion',
  policy: 'cascade',
  mode: 'shadow',
  budgetMs: 700,
  cooldownMs: 2500
};

// What each reaction drives, in the reply schema's own vocabulary. The page's executors read
// this table; nothing here reaches the body by itself. `expression` names a recipe in
// app/v3/expression.js and plays only where expressions are allowed (_expressionWhyNot).
export const REACTIONS = {
  feel_happy:   { emotion: 'happy',   burst: 'joy',     expression: 'perk' },
  feel_sad:     {                     burst: 'rain',    expression: 'droop' },
  feel_scared:  { emotion: 'scared',  burst: 'shiver',  expression: 'shiver' },
  feel_alert:   { emotion: 'alert',   burst: 'pulse' },
  feel_curious: { emotion: 'curious', burst: 'sparkle' }
};

// react(reaction, id): the page's one executor. It sets the same fields a reply would have
// set, through the same dispatchers, so every existing gate and clamp still applies.
//   registerExpress(sr, (rx) => _applyExpressive(rx), ['ngram-express', 'clef-flash']);
export function registerExpress(sr, react, providers, over) {
  for (const id in REACTIONS) sr.action(id, { run: () => react(REACTIONS[id], id), resource: 'face', holdMs: 2500 });
  return sr.route(Object.assign({}, EXPRESS_ROUTE, { providers }, over || {}));
}
