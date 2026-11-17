// wakeword.js — the first co-processor: semantic wakewording (MISSION G3, R-REG-3).
// A spoken command, in whatever words the person found, selects ONE registered action.
// Today four of these are heard by the regex readers when the phrasing fits their rules
// (halt, still, follow, unfollow) and the other four need a whole brain turn. This route
// asks the same question of every engine, so the benchmark compares them like for like.
//
// This file is DATA plus one helper. The question and its options are what Jev, Clef, the
// small model and the zero-shot embedder all read, so the descriptions are written for an
// engine that knows nothing else about GrowBot.

export const WAKE_ROUTE = {
  id: 'wake',
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
  // `none` has no action: the words go on to the brain exactly as they do today.
  on: { halt: 'halt', still: 'still', follow: 'follow', unfollow: 'unfollow', walk_forward: 'walk_forward', walk_back: 'walk_back', spin: 'spin', sing: 'sing' },
  addsRecall: true,          // halt is reserved. This route may ADD a stop the readers missed; it can never block or delay theirs (R-SAFE-1)
  policy: 'cascade',
  mode: 'shadow',
  budgetMs: 900,
  cooldownMs: 800
};

// The page supplies its own executors: each one is a call it already makes today, behind the
// clamps it already has. `halt` and `still` are registered reserved, by the page, before seal().
//   registerWake(sr, { halt: _bodyHalt, still: _bodyHalt, follow: () => _faceTrack.personFollow(), ... }, ['readers', 'ngram-wake', 'clef-flash']);
export function registerWake(sr, run, providers, over) {
  for (const k of ['halt', 'still']) sr.action(k, { run: run[k], reserved: true });
  for (const k of ['follow', 'unfollow']) sr.action(k, { run: run[k], resource: 'legs', holdMs: 0 });
  for (const k of ['walk_forward', 'walk_back', 'spin']) sr.action(k, { run: run[k], resource: 'legs', holdMs: 4000 });
  sr.action('sing', { run: run.sing, resource: 'voice', holdMs: 3000 });
  return sr.route(Object.assign({}, WAKE_ROUTE, { providers }, over || {}));
}
