// registry.js — stateless validation, primitive output checkers, and manifest hashing for SysRouter. Zero dependencies.

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
export const ID = /^[a-z][a-z0-9_.-]{0,39}$/;
export const KEY = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/;
export const GATE = /^[a-z][A-Za-z0-9_.@\/:~-]{0,95}$/;
export const dict = () => Object.create(null);
export const copyDict = (o) => { if (!o || typeof o !== 'object' || Array.isArray(o)) return null; const d = dict(); for (const k of Object.keys(o)) d[k] = o[k]; return d; };

export function checkArgs(schema, raw) {
  if (!schema) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const k of Object.keys(schema)) {
    const d = schema[k], v = has(raw, k) ? raw[k] : undefined;
    if (d.type === 'number') { if (typeof v !== 'number' || !Number.isFinite(v) || (d.min !== undefined && v < d.min) || (d.max !== undefined && v > d.max)) return null; }
    else if (d.type === 'string') { if (typeof v !== 'string' || (d.maxLen !== undefined && v.length > d.maxLen)) return null; }
    else if (d.type === 'boolean') { if (typeof v !== 'boolean') return null; }
    else if (d.type === 'enum') { if (typeof v !== 'string' || !d.values.includes(v)) return null; }
    out[k] = v;
  }
  return out;
}

export function readPrimitive(prim, spec, raw, readAnswer) {
  if (prim === 'noul' || prim === 'choice' || prim === 'score' || prim === 'match') return readAnswer(spec, raw);
  if (prim === 'generate') return typeof raw === 'string' ? (raw.length > 2000 ? raw.slice(0, 2000) : raw) : null;
  if (prim === 'embed') return Array.isArray(raw) && raw.length > 0 && raw.every((v) => typeof v === 'number' && Number.isFinite(v)) ? raw.slice() : null;
  if (prim === 'query') {
    if (!Array.isArray(raw)) return null;
    const schema = spec && spec.out && typeof spec.out === 'object' && !Array.isArray(spec.out) ? spec.out : null;
    const out = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const rec = {};
      if (schema) {
        for (const k of Object.keys(schema)) {
          if (!KEY.test(k) || (k in Object.prototype) || !has(item, k)) return null;
          const t = schema[k], v = item[k];
          if (t === 'number' ? (typeof v !== 'number' || !Number.isFinite(v)) : typeof v !== t) return null;
          rec[k] = v;
        }
      } else {
        for (const k of Object.keys(item)) if (KEY.test(k) && !(k in Object.prototype)) rec[k] = item[k];
      }
      out.push(rec);
    }
    return out;
  }
  if (prim === 'sense') {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (typeof raw.stream !== 'string' || !ID.test(raw.stream) || typeof raw.type !== 'string' || !KEY.test(raw.type)) return null;
    const data = typeof raw.data === 'string' ? (raw.data.length > 600 ? raw.data.slice(0, 600) : raw.data) : raw.data;
    return { stream: raw.stream, type: raw.type, data };
  }
  if (prim === 'actuate') {
    if (typeof raw === 'boolean') return { ok: raw };
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && typeof raw.ok === 'boolean') return { ok: raw.ok };
    return null;
  }
  return null;
}

export function canonJson(v) {   // AUDIT-PHASE2 A8 (#22): lets functions/undefined through (JSON.stringify(fn) is undefined), so manifests whose run() differs hash identically. Throw on any non-JSON value.
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map((x) => x === undefined ? 'null' : canonJson(x)).join(',') + ']';
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonJson(v[k])).join(',') + '}';
}

export async function sha256Hex(v) {
  const bytes = new TextEncoder().encode(typeof v === 'string' ? v : canonJson(v));
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
