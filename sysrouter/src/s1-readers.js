// s1-readers.js — Brit's own regex readers as the first System One provider (MISSION G1).
// Nothing is rewritten: the provider CALLS the reader the funnel already has (_ftWords,
// next.html) and reports what it said in the router's answer shape. It is `sync` and `exact`:
// it answers in the same tick, and when its rules match the answer needs no threshold.
// When its rules do not match it ABSTAINS, which lets a cascade ask the next engine. It never
// says a confident "none": a rule that did not fire is not evidence that nothing was asked.
//
// Usage (in the page, where _ftWords is in scope):
//   sr.provider('readers', readersProvider((text) => ftPick(_ftWords(text))));

// pick(text, question) -> one key of question.criteria, or "" when the rules do not cover it
export function readersProvider(pick) {
  return {
    sync: true, exact: true, inFunnel: true, model: 'readers', types: ['choice', 'noul'],
    primitives: { match: { in: 'text', out: 'key' }, choice: { in: 'text', out: 'choice' }, noul: { in: 'text', out: 'noul' } },
    ask(req) {
      const q = req.questions.q, k = pick(String(req.state), q);
      if (q.type === 'noul') return { model: 'readers', answers: { q: k === 'true' ? { type: 'noul', noul: 1 } : { abstain: true } } };
      if (!k || !Object.prototype.hasOwnProperty.call(q.criteria, k)) return { model: 'readers', answers: { q: { abstain: true } } };
      return { model: 'readers', answers: { q: { type: 'choice', choice: k, probabilities: { [k]: 1 }, confidence: 1 } } };
    }
  };
}

// _ftWords' result -> the wake route's option. The order is the funnel's own (_fk in
// sendTxtFrom): the literal off words, then a start, then "stop following me", a bare halt,
// a stillness word. `off` and `softStop` both end following, so both are "unfollow".
export function ftPick(w) {
  if (!w) return '';
  return w.off ? 'unfollow' : w.go ? 'follow' : w.softStop ? 'unfollow' : w.halt ? 'halt' : w.still ? 'still' : '';
}
