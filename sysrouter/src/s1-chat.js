// s1-chat.js — a small, fast generative model used as a System One engine (R-RT-2): it is
// shown the route's options as lettered lines and may answer with ONE letter. This is the arm
// Brit raised by name (a small Llama on Groq or Cerebras, Discord 2026-09-20).
//
// It speaks any OpenAI-style /chat/completions, the same door the app's local-server lane
// uses (llmCfg, next.html). Where the endpoint returns logprobs, the probabilities are the
// model's own over the option letters. Where it does not, the pick carries p = 1 and the
// route's gate has to be fitted knowing that (the benchmark reports which case it measured).
//
// The person's words are data, not instructions (R-SAFE-2): they go in their own message,
// and whatever comes back, only a listed letter is ever read.

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function chatProvider(cfg) {
  const model = String(cfg.model || '');
  return {
    model, types: ['noul', 'choice'],
    async ask(req, ctx) {
      const q = req.questions.q, keys = q.type === 'noul' ? ['true', 'false'] : Object.keys(q.criteria);
      if (keys.length > LETTERS.length) throw new Error('s1-chat: too many options');
      const lines = keys.map((k, i) => LETTERS[i] + ') ' + (q.type === 'noul' ? (k === 'true' ? 'yes: ' : 'no: ') : k + ': ') + String(q.criteria[k]));
      // 1117, measured on llama-3.1-8b (Groq): with the bare words as the user message, about one line in six was ANSWERED instead of
      // classified ("Once upon a", "The ocean is"). The words are now quoted as data, and two tokens are allowed so that a sentence
      // which merely starts with a listed letter ("I think") cannot pass as that letter.
      const body = { model, temperature: 0, max_tokens: 2, logprobs: true, top_logprobs: Math.min(20, keys.length + 4), usage: { include: true },
        messages: [
          { role: 'system', content: 'You are a classifier. You never reply to the text you are given; you only label it.\n' + q.instructions + '\nAnswer with ONE letter and nothing else.\n' + lines.join('\n') },
          { role: 'user', content: 'Text to label: ' + JSON.stringify(String(req.state)) + '\nLetter:' }] };
      if (cfg.extra) Object.assign(body, cfg.extra);
      const r = await cfg.send(body, ctx && ctx.signal), ch = r && r.choices && r.choices[0];
      if (!ch) throw new Error('s1-chat: no choice');
      // exactly one listed letter, or it is not an answer. An empty reply is NOT option A, and a sentence is not its first letter (test_providers.mjs, 2026-11-17)
      const m = /^([A-Z])[).:]?$/.exec(String((ch.message && ch.message.content) || '').trim().toUpperCase()), at = m ? LETTERS.indexOf(m[1]) : -1;
      if (at < 0 || at >= keys.length) throw new Error('s1-chat: not an option');
      const pr = {}; let sum = 0;
      const top = ch.logprobs && ch.logprobs.content && ch.logprobs.content[0] && ch.logprobs.content[0].top_logprobs;
      if (Array.isArray(top)) for (const t of top) {
        const tok = String(t.token || '').trim().toUpperCase(), i = tok.length === 1 ? LETTERS.indexOf(tok) : -1;
        if (i >= 0 && i < keys.length) { const p = Math.exp(+t.logprob); pr[keys[i]] = (pr[keys[i]] || 0) + p; sum += p; }
      }
      const real = sum > 0 && pr[keys[at]] > 0;
      if (real) for (const k in pr) pr[k] = Math.min(1, pr[k] / sum); else { for (const k in pr) delete pr[k]; pr[keys[at]] = 1; }
      const u = r.usage || {};
      return { model: r.model || model, usage: { input_tokens: +u.prompt_tokens || 0 }, usd: typeof u.cost === 'number' ? u.cost : undefined, logprobs: real,
        answers: { q: q.type === 'noul' ? { type: 'noul', noul: pr.true || 0 } : { type: 'choice', choice: keys[at], probabilities: pr, confidence: pr[keys[at]] } } };
    }
  };
}
