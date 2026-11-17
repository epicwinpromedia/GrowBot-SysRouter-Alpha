// s1-ngram.js — the smallest on-device System One engine: a linear model over hashed word
// and character n-grams. No network, no key, no runtime besides this file: the weights are
// one JSON file and the forward pass is the loop below, the same pattern as growbot_policy.js
// (a trained net as JSON, run by a few lines of JS). It is `sync`: it answers in the tick.
//
// It is NOT exact. It gives probabilities and needs a fitted gate like any other model.
// One model file serves one route (its classes are that route's options); it is trained by
// sysrouter/bench/train-ngram.mjs on the tuning split only.
//
// Usage:
//   const m = await (await fetch('/sysrouter/models/wake.ngram.json')).json();
//   sr.provider('ngram-wake', ngramProvider(m));

// FNV-1a over UTF-16 code units, folded into the table size
function hash(s, dim) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % dim; }

// lowercase, straight apostrophes, letters digits and apostrophes kept, everything else a space
export function words(text) {
  return String(text).toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean).slice(0, 64);
}

// word 1-grams and 2-grams, and character 3..5-grams of each padded word; L2-normalised counts
export function features(text, dim) {
  const w = words(text), x = new Map(), add = (k) => { const i = hash(k, dim); x.set(i, (x.get(i) || 0) + 1); };
  for (let i = 0; i < w.length; i++) {
    add('w:' + w[i]);
    add('b:' + (i ? w[i - 1] : '^') + ' ' + w[i]);
    const p = '<' + w[i] + '>';
    for (let n = 3; n <= 5; n++) for (let j = 0; j + n <= p.length; j++) add('c:' + p.slice(j, j + n));
  }
  if (w.length) add('b:' + w[w.length - 1] + ' $');
  add('n:' + Math.min(w.length, 12));                       // utterance length is a signal: a bare "stop" is not a sentence about stopping
  let norm = 0; for (const v of x.values()) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return { idx: Array.from(x.keys()), val: Array.from(x.values(), (v) => v / norm) };
}

// weights travel as int8 with one scale per class (a 9-class, 16384-wide model is ~200 kB of JSON)
function unpack(m) {
  const bin = atob(m.w), W = new Int8Array(bin.length);
  for (let i = 0; i < bin.length; i++) W[i] = (bin.charCodeAt(i) << 24) >> 24;
  return W;
}

export function ngramProvider(m) {
  const W = unpack(m), dim = m.dim, C = m.classes.length;
  if (W.length !== dim * C) throw new Error('s1-ngram: weight size does not match dim x classes');
  function probs(text) {
    const f = features(text, dim), z = new Array(C);
    let top = -Infinity, sum = 0;
    for (let c = 0; c < C; c++) { let s = m.b[c]; const off = c * dim, sc = m.scale[c]; for (let k = 0; k < f.idx.length; k++) s += W[off + f.idx[k]] * sc * f.val[k]; z[c] = s / m.temp; if (z[c] > top) top = z[c]; }
    for (let c = 0; c < C; c++) { z[c] = Math.exp(z[c] - top); sum += z[c]; }
    for (let c = 0; c < C; c++) z[c] /= sum;
    return z;
  }
  return {
    sync: true, model: m.id, types: ['choice'], probs,
    ask(req) {
      const q = req.questions.q, z = probs(String(req.state)), pr = {};
      let best = 0;
      for (let c = 0; c < C; c++) { if (!Object.prototype.hasOwnProperty.call(q.criteria, m.classes[c])) return { model: m.id, answers: { q: { abstain: true } } }; pr[m.classes[c]] = z[c]; if (z[c] > z[best]) best = c; }
      return { model: m.id, answers: { q: { type: 'choice', choice: m.classes[best], probabilities: pr, confidence: z[best] } } };
    }
  };
}
