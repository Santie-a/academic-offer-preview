// Proyecciones: versiones guardadas del horario (materias + grupos exactos).
// Lógica pura, sin DOM, para poder probarla en Node.

import { groupWhen } from './parser.js';

/** Huella de una selección (materias y grupos fijados), sin importar el orden. */
export function selectionSignature(selection) {
  return JSON.stringify(
    [...(selection || [])]
      .map((e) => [e.key, Object.entries(e.pins || {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

/**
 * Crea una proyección a partir de la selección actual y la opción que se está viendo.
 * Todos los grupos quedan fijados, para que al abrirla se vea exactamente ese horario.
 */
export function buildProjection({ id, name, selection, option, offerFile = '', now = Date.now() }) {
  const pinsByKey = {};
  const when = {};
  const blocks = [];
  for (const p of option?.picks || []) {
    (pinsByKey[p.subjectKey] ||= {})[p.compKey] = p.group.id;
    when[p.group.id] = groupWhen(p.group);
    for (const s of p.group.sessions) blocks.push({ day: s.day, start: s.start, end: s.end, key: p.subjectKey });
  }
  const lockedSelection = selection.map((e) => ({
    key: e.key,
    color: e.color,
    name: e.name,
    pins: pinsByKey[e.key] ? { ...pinsByKey[e.key] } : { ...(e.pins || {}) },
  }));
  return {
    id,
    name: String(name || '').trim() || 'Proyección',
    createdAt: now,
    updatedAt: now,
    offerFile,
    selection: lockedSelection,
    when,
    blocks,
    stats: {
      subjects: lockedSelection.length,
      minutes: option?.metrics.minutes || 0,
      days: option?.metrics.days || 0,
      conflicts: option?.conflicts.length || 0,
    },
  };
}

/** Compara una proyección con la oferta cargada: materias o grupos que ya no existen y horarios que cambiaron. */
export function evaluateProjection(proj, subjectsByKey) {
  const missingSubjects = [];
  const missingGroups = [];
  const changedGroups = [];
  for (const e of proj.selection) {
    const subject = subjectsByKey.get(e.key);
    if (!subject) {
      missingSubjects.push(e.name || e.key);
      continue;
    }
    for (const [compKey, gid] of Object.entries(e.pins || {})) {
      const comp = subject.components.find((c) => c.key === compKey);
      const group = comp?.groups.find((g) => g.id === gid);
      const label = `${subject.displayName}${comp?.displayLabel ? ` · ${comp.displayLabel}` : ''}`;
      if (!group) missingGroups.push(label);
      else if (proj.when?.[gid] !== undefined && proj.when[gid] !== groupWhen(group)) changedGroups.push(`${label} · G${group.label}`);
    }
  }
  return {
    missingSubjects,
    missingGroups,
    changedGroups,
    ok: !missingSubjects.length && !missingGroups.length && !changedGroups.length,
  };
}

/** Selección lista para usar: descarta grupos fijados que ya no existen (pasan a automático). */
export function restoreSelection(proj, subjectsByKey) {
  return proj.selection.map((e) => {
    const subject = subjectsByKey.get(e.key);
    const pins = {};
    if (subject) {
      for (const [compKey, gid] of Object.entries(e.pins || {})) {
        const comp = subject.components.find((c) => c.key === compKey);
        if (comp?.groups.some((g) => g.id === gid)) pins[compKey] = gid;
      }
    }
    return { key: e.key, color: e.color, name: subject?.displayName || e.name, pins };
  });
}

// ---------------------------------------------------------------- compartir por enlace

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/**
 * Codifica una proyección en texto corto para un enlace. Se guardan los grupos
 * por número (no por id) para que el enlace funcione con cualquier copia del Excel.
 */
export function encodeShare(proj, subjectsByKey) {
  const s = proj.selection.map((e) => {
    const subject = subjectsByKey.get(e.key);
    const labels = subject
      ? subject.components.map((c) => {
          const gid = e.pins?.[c.key];
          return c.groups.find((g) => g.id === gid)?.label ?? null;
        })
      : [];
    return [e.key, labels, e.name || subject?.displayName || ''];
  });
  return toBase64Url(JSON.stringify({ v: 1, n: proj.name, s }));
}

export function decodeShare(code) {
  try {
    const data = JSON.parse(fromBase64Url(String(code)));
    if (data?.v !== 1 || !Array.isArray(data.s)) return null;
    const items = data.s
      .filter((x) => Array.isArray(x) && typeof x[0] === 'string')
      .map(([key, labels, name]) => ({ key, labels: Array.isArray(labels) ? labels : [], name: typeof name === 'string' ? name : '' }));
    if (!items.length) return null;
    return { name: typeof data.n === 'string' && data.n.trim() ? data.n.trim().slice(0, 80) : 'Proyección compartida', items };
  } catch {
    return null;
  }
}

/** Convierte una proyección compartida en una selección con grupos fijados según la oferta cargada. */
export function selectionFromShare(shared, subjectsByKey) {
  return shared.items.map((it, i) => {
    const subject = subjectsByKey.get(it.key);
    const pins = {};
    if (subject) {
      subject.components.forEach((c, ci) => {
        const label = it.labels[ci];
        const g = label !== null && label !== undefined ? c.groups.find((x) => x.label === String(label)) : null;
        if (g) pins[c.key] = g.id;
      });
    }
    return { key: it.key, color: i, name: subject?.displayName || it.name, pins };
  });
}
