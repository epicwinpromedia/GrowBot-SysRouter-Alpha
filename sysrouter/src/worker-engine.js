// worker-engine.js — dedicated Worker adapter for SysRouter engines (SPEC §8.4, P10). Zero dependencies.
import { readPrimitive } from './sysrouter.js';

export function workerEngine(worker, decl) {
  decl = decl || {};
  const prims = decl.primitives && typeof decl.primitives === 'object' ? decl.primitives : null;
  const types = Array.isArray(decl.types) ? decl.types.slice() : (prims ? Object.keys(prims) : ['choice']);
  const model = String(decl.model || '');
  const pending = new Map();
  let nextId = 1;

  function onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.sense !== undefined) {
      if (typeof decl.onSense === 'function') {
        const ev = readPrimitive('sense', null, { stream: msg.sense, type: msg.type, data: msg.data });
        if (ev) decl.onSense(ev);
      }
      return;
    }
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (entry.signal && entry.onAbort) entry.signal.removeEventListener('abort', entry.onAbort);
    if (!msg.ok) { entry.reject(new Error(String(msg.error || 'worker error'))); return; }
    const checked = readPrimitive(entry.primitive, entry.spec, msg.output);
    if (checked === null) { entry.reject(new Error('sysrouter: bad_answer')); return; }
    const m = msg.model !== undefined ? String(msg.model) : model;
    const usd = typeof msg.usd === 'number' && Number.isFinite(msg.usd) && msg.usd >= 0 ? msg.usd : undefined;
    if (entry.isQuestion) entry.resolve({ model: m, usd, answers: { q: msg.output } });
    else entry.resolve({ model: m, usd, output: checked });
  }

  if (typeof worker.addEventListener === 'function') worker.addEventListener('message', (e) => onMessage(e && e.data));
  else if (typeof worker.on === 'function') worker.on('message', onMessage);
  else throw new Error('sysrouter: workerEngine needs a Worker');

  function ask(req, ctx) {
    const signal = (ctx && ctx.signal) || (req && req.signal) || null;
    if (signal && signal.aborted) return Promise.reject(new Error('aborted'));
    const q = req && req.questions && req.questions.q;
    const primitive = (req && req.primitive) || (q && q.type) || types[0] || 'choice';
    const spec = q || (req && req.spec) || (prims && prims[primitive]) || {};
    const input = req && req.input !== undefined ? req.input : (req ? req.state : undefined);
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        if (!pending.has(id)) return;
        pending.delete(id);
        try { worker.postMessage({ id, abort: true }); } catch (e) {}
        reject(new Error('aborted'));
      };
      pending.set(id, { resolve, reject, primitive, spec, signal, onAbort, isQuestion: !!q });
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      worker.postMessage({ id, primitive, input });
    });
  }

  const out = {
    ask, sync: false, exact: !!decl.exact, inFunnel: !!decl.inFunnel, model,
    subscribeSense: (fn) => { decl.onSense = fn; },
    terminate: () => { try { if (typeof worker.terminate === 'function') worker.terminate(); } catch (e) {} }
  };
  if (prims) out.primitives = prims; else out.types = types;
  return out;
}
