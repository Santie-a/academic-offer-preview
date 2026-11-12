// Motor de planificación: dado un conjunto de materias (y grupos fijados),
// encuentra combinaciones de grupos sin cruces y las ordena por preferencia.
// Si no hay ninguna sin cruces, devuelve las de menor cruce y un diagnóstico.

const SOLUTION_KEEP = 3000; // combinaciones guardadas para ordenar
const COUNT_CAP = 20000; // a partir de aquí solo se informa "más de"
const NODE_CAP = 400000; // límite de seguridad de la búsqueda

// ---------------------------------------------------------------- cruces

function inRange(date, g) {
  return (!g.startDate || date >= g.startDate) && (!g.endDate || date <= g.endDate);
}

/** ¿Los periodos de clase de dos grupos coinciden en alguna fecha? */
export function datesOverlap(a, b) {
  if (a.startDate && b.endDate && a.startDate > b.endDate) return false;
  if (b.startDate && a.endDate && b.startDate > a.endDate) return false;
  const ad = a.dates || [];
  const bd = b.dates || [];
  if (ad.length && bd.length) return ad.some((d) => bd.includes(d));
  if (ad.length) return ad.some((d) => inRange(d, b));
  if (bd.length) return bd.some((d) => inRange(d, a));
  return true;
}

/** Intervalos en los que dos grupos se cruzan (vacío si no se cruzan). */
export function overlapsBetween(a, b) {
  const out = [];
  if (!a.sessions.length || !b.sessions.length) return out;
  for (const x of a.sessions) {
    for (const y of b.sessions) {
      if (x.day !== y.day) continue;
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (start < end) out.push({ day: x.day, start, end });
    }
  }
  if (out.length && !datesOverlap(a, b)) return [];
  return out;
}

function makeConflictCache() {
  const cache = new Map();
  return (a, b) => {
    const k = a.id < b.id ? `${a.id}#${b.id}` : `${b.id}#${a.id}`;
    let v = cache.get(k);
    if (v === undefined) {
      v = overlapsBetween(a, b).reduce((t, o) => t + o.end - o.start, 0);
      cache.set(k, v);
    }
    return v;
  };
}

// ---------------------------------------------------------------- variables

/**
 * @typedef {{subject: any, pins?: Record<string, string>}} Item
 * Cada componente de cada materia es una variable; sus candidatos son los
 * grupos posibles (o solo el grupo fijado por el usuario).
 */
function buildVariables(items) {
  const vars = [];
  for (const item of items) {
    for (const comp of item.subject.components) {
      const pinned = item.pins?.[comp.key];
      const pinnedGroup = pinned ? comp.groups.find((g) => g.id === pinned) : null;
      vars.push({
        subjectKey: item.subject.key,
        compKey: comp.key,
        cands: pinnedGroup ? [pinnedGroup] : comp.groups,
      });
    }
  }
  return vars;
}

function searchOrder(vars) {
  return vars
    .map((v, i) => i)
    .sort((a, b) => vars[a].cands.length - vars[b].cands.length || a - b);
}

// ---------------------------------------------------------------- métricas

export function scheduleMetrics(groups, avoidDays = []) {
  const byDay = new Map();
  let minutes = 0;
  for (const g of groups) {
    for (const s of g.sessions) {
      if (!byDay.has(s.day)) byDay.set(s.day, []);
      byDay.get(s.day).push(s);
      minutes += s.end - s.start;
    }
  }
  let gaps = 0;
  let sumFirst = 0;
  let sumLast = 0;
  let minStart = Infinity;
  let maxEnd = -Infinity;
  let avoided = 0;
  for (const [day, list] of byDay) {
    list.sort((a, b) => a.start - b.start);
    let end = list[0].end;
    for (let i = 1; i < list.length; i++) {
      if (list[i].start > end) gaps += list[i].start - end;
      end = Math.max(end, list[i].end);
    }
    sumFirst += list[0].start;
    sumLast += end;
    minStart = Math.min(minStart, list[0].start);
    maxEnd = Math.max(maxEnd, end);
    if (avoidDays.includes(day)) avoided += list.reduce((t, s) => t + s.end - s.start, 0);
  }
  const days = byDay.size;
  return {
    days,
    gaps,
    minutes,
    avoided,
    minStart: days ? minStart : 0,
    maxEnd: days ? maxEnd : 0,
    avgFirst: days ? sumFirst / days : 0,
    avgLast: days ? sumLast / days : 0,
  };
}

export const SORTS = {
  compact: { label: 'Menos huecos', keys: (m) => [m.avoided, m.gaps, m.days, m.avgLast - m.avgFirst] },
  fewdays: { label: 'Menos días', keys: (m) => [m.avoided, m.days, m.gaps, m.avgLast - m.avgFirst] },
  late: { label: 'Empezar más tarde', keys: (m) => [m.avoided, -m.minStart, -m.avgFirst, m.gaps] },
  early: { label: 'Terminar más temprano', keys: (m) => [m.avoided, m.maxEnd, m.avgLast, m.gaps] },
};

function compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

// ---------------------------------------------------------------- búsqueda

function enumerate(vars, { stopAtFirst = false, keep = SOLUTION_KEEP } = {}) {
  const conflict = makeConflictCache();
  const order = searchOrder(vars);
  const chosen = new Array(vars.length);
  const solutions = [];
  let count = 0;
  let nodes = 0;
  let aborted = false;

  const dfs = (depth) => {
    if (count >= COUNT_CAP || (stopAtFirst && count > 0)) return;
    if (++nodes > NODE_CAP) {
      aborted = true;
      return;
    }
    if (depth === order.length) {
      count++;
      if (solutions.length < keep) solutions.push(chosen.slice());
      return;
    }
    const vi = order[depth];
    for (const g of vars[vi].cands) {
      let ok = true;
      for (let d = 0; d < depth; d++) {
        if (conflict(g, chosen[order[d]]) > 0) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      chosen[vi] = g;
      dfs(depth + 1);
      if (aborted || count >= COUNT_CAP || (stopAtFirst && count > 0)) return;
    }
  };
  dfs(0);
  return { solutions, count, truncated: count >= COUNT_CAP || aborted };
}

function minConflict(vars) {
  const conflict = makeConflictCache();
  const order = searchOrder(vars);
  const chosen = new Array(vars.length);
  let best = Infinity;
  let solutions = [];
  let nodes = 0;

  const dfs = (depth, cost) => {
    if (cost > best || ++nodes > NODE_CAP) return;
    if (depth === order.length) {
      if (cost < best) {
        best = cost;
        solutions = [];
      }
      if (solutions.length < SOLUTION_KEEP) solutions.push(chosen.slice());
      return;
    }
    const vi = order[depth];
    for (const g of vars[vi].cands) {
      let add = 0;
      for (let d = 0; d < depth; d++) {
        const m = conflict(g, chosen[order[d]]);
        if (m > 0) add += 100000 + m; // primero menos pares en cruce, luego menos minutos
      }
      chosen[vi] = g;
      dfs(depth + 1, cost + add);
    }
  };
  dfs(0, 0);
  return { solutions, cost: best };
}

function describeConflicts(vars, groups) {
  const out = [];
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const overlaps = overlapsBetween(groups[i], groups[j]);
      if (overlaps.length) {
        out.push({
          a: { subjectKey: vars[i].subjectKey, compKey: vars[i].compKey, groupId: groups[i].id },
          b: { subjectKey: vars[j].subjectKey, compKey: vars[j].compKey, groupId: groups[j].id },
          overlaps,
        });
      }
    }
  }
  return out;
}

function toOption(vars, groups, avoidDays) {
  return {
    picks: vars.map((v, i) => ({ subjectKey: v.subjectKey, compKey: v.compKey, group: groups[i] })),
    metrics: scheduleMetrics(groups, avoidDays),
    conflicts: describeConflicts(vars, groups),
  };
}

/**
 * Planifica un horario.
 * @param {Item[]} items
 * @param {{sort?: keyof SORTS, avoidDays?: number[]}} prefs
 */
export function plan(items, prefs = {}) {
  const sort = SORTS[prefs.sort] ? prefs.sort : 'compact';
  const avoidDays = prefs.avoidDays || [];
  if (!items.length) return { status: 'empty', options: [], total: 0, truncated: false };

  const vars = buildVariables(items);
  const tieBreak = (groups) => groups.map((g) => g.label).join(',');
  const rank = (list) =>
    list
      .map((groups) => ({ groups, opt: toOption(vars, groups, avoidDays) }))
      .sort((x, y) => compareKeys(SORTS[sort].keys(x.opt.metrics), SORTS[sort].keys(y.opt.metrics)) || tieBreak(x.groups).localeCompare(tieBreak(y.groups), 'es', { numeric: true }))
      .map((x) => x.opt);

  const found = enumerate(vars);
  if (found.count > 0) {
    return { status: 'ok', options: rank(found.solutions), total: found.count, truncated: found.truncated };
  }
  const fallback = minConflict(vars);
  return {
    status: 'conflict',
    options: rank(fallback.solutions),
    total: 0,
    truncated: false,
    diagnosis: diagnose(items),
  };
}

export function hasSolution(items) {
  if (!items.length) return true;
  return enumerate(buildVariables(items), { stopAtFirst: true, keep: 0 }).count > 0;
}

export function countSolutions(items) {
  const r = enumerate(buildVariables(items), { keep: 0 });
  return { count: r.count, truncated: r.truncated };
}

/**
 * Explica por qué no hay horario sin cruces: materias que siempre se cruzan
 * entre sí, materias que al quitarlas lo resuelven y si los grupos fijados son la causa.
 */
export function diagnose(items) {
  const unpinned = items.map((it) => ({ subject: it.subject, pins: {} }));
  const hasPins = items.some((it) => Object.values(it.pins || {}).some(Boolean));
  const autoCount = hasPins ? countSolutions(unpinned) : { count: 0, truncated: false };

  const single = [];
  items.forEach((it) => {
    if (!hasSolution([it])) single.push(it.subject.key);
  });

  const pairs = [];
  for (let i = 0; i < items.length; i++) {
    if (single.includes(items[i].subject.key)) continue;
    for (let j = i + 1; j < items.length; j++) {
      if (single.includes(items[j].subject.key)) continue;
      if (!hasSolution([items[i], items[j]])) {
        pairs.push({ a: items[i].subject.key, b: items[j].subject.key, overlaps: exampleOverlaps(items[i], items[j]) });
      }
    }
  }

  const removable = [];
  if (items.length > 1) {
    items.forEach((it, i) => {
      const rest = items.filter((_, k) => k !== i);
      const c = countSolutions(rest);
      if (c.count > 0) removable.push({ key: it.subject.key, count: c.count, truncated: c.truncated });
    });
    removable.sort((a, b) => b.count - a.count);
  }

  return { single, pairs, removable, pinsBlocking: autoCount.count > 0, autoCount: autoCount.count };
}

function exampleOverlaps(a, b) {
  const va = buildVariables([a]);
  const vb = buildVariables([b]);
  for (const x of va) {
    for (const y of vb) {
      // Si todas las combinaciones de estos dos componentes se cruzan, mostramos el cruce.
      let all = true;
      let sample = null;
      for (const ga of x.cands) {
        for (const gb of y.cands) {
          const o = overlapsBetween(ga, gb);
          if (!o.length) all = false;
          else if (!sample) sample = o;
        }
      }
      if (all && sample) return sample;
    }
  }
  return [];
}
