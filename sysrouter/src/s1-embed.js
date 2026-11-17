// s1-embed.js — an on-device System One engine that reads MEANING: a small sentence-embedding
// model (all-MiniLM-L6-v2, Apache-2.0, 23 MB quantized ONNX) run by ONNX Runtime Web, which
// the app already ships for its voice detector (/ml/ort.min.js runs Silero, next.html). No
// network call per decision, no key, no per-call cost.
//
// Two ways to turn an embedding into an answer:
//   • a trained HEAD (one linear layer per route, fitted on the tuning split), or
//   • ZERO-SHOT: no training at all. Each option's own description from the route's criteria
//     is embedded once and the words are matched to the nearest. This is what lets a route
//     that was registered a second ago (an extension's, or a rule the creature just wrote)
//     work with no data. The benchmark measures what that convenience costs in accuracy.
//
// The model file and the runtime are INJECTED: this module imports nothing.
//   const session = await ort.InferenceSession.create('/ml/all-MiniLM-L6-v2.q.onnx');
//   sr.provider('embed', embedProvider({ ort, session, vocab, head }));     // head optional

// BERT uncased WordPiece, the standard greedy longest-match.
export function tokenizer(vocabText) {
  const vocab = new Map(vocabText.split('\n').map((t, i) => [t.replace(/\r$/, ''), i]));
  const CLS = vocab.get('[CLS]'), SEP = vocab.get('[SEP]'), UNK = vocab.get('[UNK]');
  return function ids(text, max) {
    const clean = String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[‘’ʼ]/g, "'");
    const pieces = clean.split(/\s+/).flatMap((w) => w.split(/([^a-z0-9À-￿])/).filter(Boolean)), out = [CLS];
    for (const w of pieces) {
      if (out.length >= (max || 64) - 1) break;
      if (w.length > 100) { out.push(UNK); continue; }
      let start = 0; const sub = [];
      while (start < w.length) {
        let end = w.length, id = -1;
        while (start < end) { const s = (start ? '##' : '') + w.slice(start, end); if (vocab.has(s)) { id = vocab.get(s); break; } end--; }
        if (id < 0) { sub.length = 0; sub.push(UNK); break; }
        sub.push(id); start = end;
      }
      for (const id of sub) if (out.length < (max || 64) - 1) out.push(id);
    }
    out.push(SEP);
    return out;
  };
}

export function embedder(ort, session, vocabText) {
  const ids = tokenizer(vocabText), cache = new Map();
  return async function embed(text) {
    if (cache.has(text)) return cache.get(text);
    const t = ids(text, 64), n = t.length, big = (a) => new ort.Tensor('int64', BigInt64Array.from(a, (v) => BigInt(v)), [1, n]);
    const out = await session.run({ input_ids: big(t), attention_mask: big(t.map(() => 1)), token_type_ids: big(t.map(() => 0)) });
    const h = out.last_hidden_state || out[Object.keys(out)[0]], d = h.dims[2], v = new Float32Array(d);
    for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) v[j] += h.data[i * d + j];      // mean pool (no padding: one sentence at a time)
    let norm = 0; for (let j = 0; j < d; j++) norm += v[j] * v[j];
    norm = Math.sqrt(norm) || 1; for (let j = 0; j < d; j++) v[j] /= norm;
    if (cache.size > 256) cache.delete(cache.keys().next().value);                             // bounded: option texts recur, utterances rarely do
    cache.set(text, v);
    return v;
  };
}

function softmax(z) { const m = Math.max(...z), e = z.map((v) => Math.exp(v - m)), s = e.reduce((a, b) => a + b, 0); return e.map((v) => v / s); }

// cfg: { ort, session, vocab, head?, id?, temp? }.  head = { id, classes, W: number[][], b: number[], temp }
export function embedProvider(cfg) {
  const embed = cfg.embed || embedder(cfg.ort, cfg.session, cfg.vocab), head = cfg.head || null;
  const id = head ? head.id : (cfg.id || 'minilm-zeroshot'), temp = head ? head.temp : (cfg.temp || 0.05);
  return {
    model: id, types: ['choice', 'noul'], embed,
    async ask(req) {
      const q = req.questions.q, v = await embed(String(req.state));
      const keys = q.type === 'noul' ? ['true', 'false'] : Object.keys(q.criteria);
      let z;
      if (head) {
        if (head.classes.length !== keys.length || !head.classes.every((c) => keys.includes(c))) return { model: id, answers: { q: { abstain: true } } };   // this head was trained for another route
        z = head.classes.map((_, c) => { let s = head.b[c]; for (let j = 0; j < v.length; j++) s += head.W[c][j] * v[j]; return s / temp; });
        return answer(q, head.classes, softmax(z), id);
      }
      z = [];
      for (const k of keys) { const p = await embed(String(q.criteria[k])); let s = 0; for (let j = 0; j < v.length; j++) s += p[j] * v[j]; z.push(s / temp); }
      return answer(q, keys, softmax(z), id);
    }
  };
}

function answer(q, keys, pr, id) {
  let best = 0; const probabilities = {};
  keys.forEach((k, i) => { probabilities[k] = pr[i]; if (pr[i] > pr[best]) best = i; });
  if (q.type === 'noul') return { model: id, answers: { q: { type: 'noul', noul: probabilities.true } } };
  return { model: id, answers: { q: { type: 'choice', choice: keys[best], probabilities, confidence: pr[best] } } };
}
