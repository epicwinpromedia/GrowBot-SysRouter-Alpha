// fuzzy.js — the first co-processor: fuzzy commands (SPEC §13.1, D7, P1).
// A spoken command, in whatever words the person found, selects ONE exposed command.
// The option set is built dynamically from the commands the host (and person-granted
// extensions) exposed, plus `none`, so an unexposed command can never be picked.

export const FUZZY = {
  id: 'fuzzy',
  question: {
    type: 'choice',
    instructions: 'A person is speaking to a small two-legged robot creature. Is the person giving the robot a direct command right now? Pick the one command they are giving, or none.',
    criteria: {
      halt: 'A direct order to stop what it is doing right now: stop, halt, enough, cut it out, cancel.',
      still: 'A direct order to hold still and not move: freeze, stay still, do not move, stay put.',
      follow: 'A direct order to look at, watch, track or follow the person or their face.',
      unfollow: 'A direct order to stop looking at, watching, tracking or following the person: look away, stop staring.',
      walk_forward: 'A direct order to walk or move forward, or to come closer to the person.',
      walk_back: 'A direct order to walk or move backward, back up, or move away.',
      spin: 'A direct order to spin, turn around, rotate or twirl in place.',
      sing: 'A direct order to sing, hum or make a tune.',
      none: 'Not a direct command to the robot: conversation, a question, a story, a statement about something else, or a sentence that only mentions one of these words.'
    }
  },
  notFor: 'Sentences that mention a command word without ordering the robot (“let’s stop by the store”, “I follow a cooking channel”), questions, quoted speech, and plans for later.',
  on: { halt: 'halt', still: 'still', follow: 'follow', unfollow: 'unfollow', walk_forward: 'walk_forward', walk_back: 'walk_back', spin: 'spin', sing: 'sing' },
  addsRecall: true,
  policy: 'cascade',
  mode: 'shadow',
  budgetMs: 900,
  cooldownMs: 800
};

export const WAKE_ROUTE = FUZZY;

export function registerFuzzy(sr, run, providers, over) {
  run = run || {};
  const criteria = {}, on = {};
  const meta = {
    halt: { reserved: true },
    still: { reserved: true },
    follow: { resource: 'legs', holdMs: 0 },
    unfollow: { resource: 'legs', holdMs: 0 },
    walk_forward: { resource: 'legs', holdMs: 4000 },
    walk_back: { resource: 'legs', holdMs: 4000 },
    spin: { resource: 'legs', holdMs: 4000 },
    sing: { resource: 'voice', holdMs: 3000 }
  };
  for (const k of Object.keys(FUZZY.on)) {
    if (typeof run[k] !== 'function') continue;
    sr.command(Object.assign({ id: k, run: run[k], exposeTo: ['person'] }, meta[k] || {}));
    criteria[k] = FUZZY.question.criteria[k];
    on[k] = k;
  }
  const extra = over && over.extraCommands;
  if (Array.isArray(extra)) {
    for (const c of extra) {
      if (!c || !c.id || !c.description) continue;
      criteria[c.id] = c.description;
      on[c.id] = c.id;
    }
  }
  criteria.none = FUZZY.question.criteria.none;
  const opts = Object.assign({}, over || {});
  delete opts.extraCommands;
  return sr.route(Object.assign({}, FUZZY, { question: { type: 'choice', instructions: FUZZY.question.instructions, criteria }, on, providers }, opts));
}

export const registerWake = registerFuzzy;
