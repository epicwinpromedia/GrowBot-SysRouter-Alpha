// fuzzy.js — the first co-processor: fuzzy commands (SPEC §13.1, D7, P1, #28).
// Brit's trained question (8 options + none) stays fixed so calibrated gates and on-device
// models stay valid (L3). Unexposed commands are filtered from the command table and log
// why:"unexposed", did:0. Developer commands get their own separate fuzzy.ext question.

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
  const on = {}, unexposed = [];
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
    if (typeof run[k] !== 'function') { unexposed.push(k); continue; }
    sr.command(Object.assign({ id: k, run: run[k], exposeTo: ['person'] }, meta[k] || {}));
    on[k] = k;
  }
  const opts = Object.assign({}, over || {});
  const extra = opts.extraCommands;
  delete opts.extraCommands;
  const rid = sr.route(Object.assign({}, FUZZY, { question: FUZZY.question, on, unexposed, providers }, opts));
  // Developer commands (2A.3, #28) get their own separate question, never merged into Brit's.
  if (Array.isArray(extra) && extra.length) {
    const extCrit = {}, extOn = {};
    for (const c of extra) {
      if (!c || !c.id || !c.description) continue;
      if (Array.isArray(c.exposeTo) && !c.exposeTo.includes('person')) continue;
      extCrit[c.id] = c.description;
      extOn[c.id] = c.id;
    }
    if (Object.keys(extOn).length) {
      extCrit.none = FUZZY.question.criteria.none;
      sr.route({
        id: 'fuzzy.ext',
        question: { type: 'choice', instructions: 'A person is speaking to a small robot creature. Is the person invoking one of these extension commands right now? Pick the command or none.', criteria: extCrit },
        notFor: FUZZY.notFor,
        on: extOn,
        providers,
        policy: providers.length > 1 ? 'cascade' : 'single',
        mode: 'shadow',
        budgetMs: FUZZY.budgetMs,
        cooldownMs: FUZZY.cooldownMs
      });
    }
  }
  return rid;
}

export const registerWake = registerFuzzy;
