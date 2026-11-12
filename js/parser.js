// Convierte las filas de la hoja de oferta en un modelo de materias,
// componentes (p. ej. laboratorio / magistral) y grupos con sesiones.
// No depende del DOM: se puede probar en Node.

export const DAYS = [
  { idx: 0, key: 'LUNES', short: 'Lun', tiny: 'Lu', long: 'Lunes' },
  { idx: 1, key: 'MARTES', short: 'Mar', tiny: 'Ma', long: 'Martes' },
  { idx: 2, key: 'MIERCOLES', short: 'Mié', tiny: 'Mi', long: 'Miércoles' },
  { idx: 3, key: 'JUEVES', short: 'Jue', tiny: 'Ju', long: 'Jueves' },
  { idx: 4, key: 'VIERNES', short: 'Vie', tiny: 'Vi', long: 'Viernes' },
  { idx: 5, key: 'SABADO', short: 'Sáb', tiny: 'Sá', long: 'Sábado' },
  { idx: 6, key: 'DOMINGO', short: 'Dom', tiny: 'Do', long: 'Domingo' },
];

export function norm(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function clean(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------- valores

/** Devuelve minutos desde medianoche o null. Acepta fracciones de día de Excel y textos. */
export function parseTime(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) return null;
    const frac = v - Math.floor(v);
    if (frac === 0) return v <= 24 ? v * 60 : null; // "7" o "13" escrito como número
    const m = Math.round(frac * 1440);
    return m >= 1440 ? null : m;
  }
  const s = norm(v).replace(/\./g, '').replace(/\s+/g, '');
  const m = /^(\d{1,2})(?:[:H](\d{2}))?(?::\d{2})?(AM|PM|A|P|M)?$/.exec(s);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3];
  if (ap && ap.startsWith('P') && h < 12) h += 12;
  if (ap && ap.startsWith('A') && h === 12) h = 0;
  if (ap === 'M' && h < 12) h += 12; // "12 m" = mediodía
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Fecha ISO (AAAA-MM-DD) desde un número de serie de Excel o un texto. */
export function parseDate(v, date1904 = false) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 1) return null;
    const days = Math.floor(v) + (date1904 ? 1462 : 0);
    const d = new Date(Math.round((days - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${pad(m[2])}-${pad(m[1])}`;
  }
  return null;
}

function parseDateList(v, date1904) {
  if (v === null || v === undefined || v === '') return [];
  if (typeof v === 'number') {
    const d = parseDate(v, date1904);
    return d ? [d] : [];
  }
  return String(v)
    .split(/[,;\n|]+|\s{2,}/)
    .map((s) => parseDate(s.trim(), date1904))
    .filter(Boolean)
    .sort();
}

export function parsePrograms(v) {
  if (v === null || v === undefined) return [];
  return String(v)
    .split(/,|;|\/|\n|&|\s+y\s+/i)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export function parseSemester(v) {
  const raw = clean(v);
  const n = norm(raw);
  if (!raw) return { raw: '', label: '', nums: [], elective: false, electiveArea: '' };
  if (n.includes('ELECTIV')) {
    const area = raw.split(/\s[-–:]\s|[-–:]/).slice(1).join(' - ').trim();
    return { raw, label: 'Electiva', nums: [], elective: true, electiveArea: area };
  }
  const m = /^(\d{1,2})(?:\s*(?:-|–|A|Y|,)\s*(\d{1,2}))?$/.exec(n);
  if (m) {
    const a = parseInt(m[1], 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    const nums = [];
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) nums.push(i);
    return { raw, label: a === b ? `${a}` : `${a}–${b}`, nums, elective: false, electiveArea: '' };
  }
  return { raw, label: raw, nums: [], elective: false, electiveArea: '' };
}

function parseCode(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return String(Math.round(v));
  return clean(v);
}

function parseCodeList(v) {
  if (v === null || v === undefined || v === '') return [];
  if (typeof v === 'number') return [String(Math.round(v))];
  return String(v)
    .split(/[\s,;/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------- encabezados

function findHeader(rows) {
  const limit = Math.min(rows.length, 40);
  for (let r = 0; r < limit; r++) {
    const cells = (rows[r] || []).map((c) => (typeof c === 'string' ? norm(c) : ''));
    const map = mapColumns(cells);
    if (map.name >= 0 && map.days.length >= 3) return { row: r, map, nameHeader: cells[map.name] };
  }
  return null;
}

function mapColumns(cells) {
  const find = (pred) => cells.findIndex((c, i) => c && pred(c, i));
  const map = {
    level: find((c) => c.includes('PREGRADO') || c.includes('POSGRADO') || c === 'NIVEL DE FORMACION'),
    program: find((c) => c.includes('PROGRAMA')),
    semester: find((c) => c.includes('SEMESTRE')),
    area: find((c) => c === 'AREA' || c.startsWith('AREA ')),
    code: find((c) => (c.startsWith('CODIGO') || c === 'COD' || c === 'COD.') && !c.includes('COMPARTIDO')),
    shared: find((c) => c.includes('COMPARTIDO')),
    name: find((c) => c.includes('ASIGNATURA') || c === 'NOMBRE' || c === 'MATERIA' || c === 'CURSO' || c === 'NOMBRE CURSO'),
    group: find((c) => c.startsWith('GRUPO') || c === 'GR' || c.startsWith('SECCION')),
    start: find((c) => c.includes('INICIO') && !DAYS.some((d) => c.startsWith(d.key))),
    end: find((c) => (c.includes('FECHA FIN') || c === 'FIN' || c.includes('FINALIZACION')) && !DAYS.some((d) => c.startsWith(d.key))),
    sede: find((c) => c.includes('SEDE')),
    classDates: find((c) => c.includes('FECHAS CLASE') || c.includes('FECHAS DE CLASE') || c === 'FECHAS'),
    teacher: find((c) => c.includes('DOCENTE') || c.includes('PROFESOR')),
    room: find((c) => c.includes('SALON') || c.includes('AULA')),
    modality: find((c) => c.includes('MODALIDAD')),
    days: [],
  };

  for (const d of DAYS) {
    const cols = [];
    cells.forEach((c, i) => {
      if (c === d.key || c.startsWith(d.key + ' ')) cols.push(i);
    });
    if (!cols.length) continue;
    let startCol = cols[0];
    let endCol = cols[1] ?? startCol + 1;
    // Encabezado combinado ("LUNES" repetido en la celda de al lado) cuenta como una sola columna doble.
    if (cols.length >= 2 && cols[1] === cols[0] + 1) endCol = cols[1];
    const endHeader = cells[endCol];
    if (cols.length === 1 && endHeader && !endHeader.includes('FIN') && !endHeader.includes('HASTA')) {
      // Solo una columna para el día: se espera un rango "7:00 - 9:00".
      endCol = -1;
    }
    map.days.push({ day: d.idx, startCol, endCol });
  }
  return map;
}

function splitRange(v) {
  if (typeof v !== 'string') return null;
  const parts = v.split(/\s*(?:-|–|—|\bA\b|\ba\b)\s*(?=\d)/);
  if (parts.length !== 2) return null;
  const a = parseTime(parts[0]);
  const b = parseTime(parts[1]);
  return a !== null && b !== null ? [a, b] : null;
}

// ---------------------------------------------------------------- nombres

function commonWordPrefix(names) {
  const split = names.map((n) => n.split(' '));
  const first = split[0];
  let k = 0;
  while (k < first.length && split.every((w) => w[k] === first[k])) k++;
  return first.slice(0, k).join(' ');
}

const SMALL = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'a', 'al', 'para', 'por', 'con', 'o', 'u', 'of', 'and', 'the', 'for', 'in', 'to', 'tu', 'que', 'su', 'sus']);
const KEEP_UPPER = new Set(['ADN', 'NMC', 'CAD', 'CAE', 'CAD-CAE', 'TIC', 'TI', 'IA', 'AI', 'ML', 'IOT', 'UR']);

/** Convierte "CÁLCULO 2" en "Cálculo 2" respetando siglas y números romanos. */
export function titleCase(s) {
  const words = clean(s).split(' ');
  return words
    .map((w, i) => {
      const bare = w.replace(/[^\p{L}\d-]/gu, '');
      if (KEEP_UPPER.has(norm(bare))) return w.toUpperCase();
      if (/^(I{1,3}|IV|V|VI{0,3}|IX|X)$/i.test(bare) && i > 0) return w.toUpperCase();
      if (/\d/.test(bare) && /^[A-Z0-9-]+$/i.test(bare) && bare.length <= 4 && /[A-Z]/i.test(bare)) return w.toUpperCase();
      const lower = w.toLocaleLowerCase('es');
      if (i > 0 && SMALL.has(lower) && !/[:.]$/.test(words[i - 1])) return lower;
      return lower.replace(/^(\P{L}*)(\p{L})/u, (m, pre, ch) => pre + ch.toLocaleUpperCase('es'));
    })
    .join(' ');
}

// ---------------------------------------------------------------- principal

/**
 * Busca la hoja de oferta dentro del libro y la convierte en el modelo de la app.
 * @param {{date1904: boolean, sheets: {name: string, hidden: boolean, rows: any[][]}[]}} workbook
 */
export function parseOffer(workbook) {
  const candidates = [...workbook.sheets].sort((a, b) => Number(a.hidden) - Number(b.hidden));
  for (const sheet of candidates) {
    const header = findHeader(sheet.rows);
    if (header) return buildOffer(sheet, header, workbook.date1904);
  }
  const err = new Error(
    'No se encontró la tabla de oferta. Se esperaba una fila de encabezados con columnas como “NOMBRE ASIGNATURA”, “GRUPO” y los días (LUNES, MARTES…).',
  );
  err.code = 'no-header';
  throw err;
}

function buildOffer(sheet, header, date1904) {
  const { map } = header;
  const get = (row, col) => (col >= 0 ? row[col] : undefined);
  const warnings = [];
  const records = [];

  for (let r = header.row + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] || [];
    const name = clean(get(row, map.name));
    if (!name || norm(name) === header.nameHeader) continue;
    const code = parseCode(get(row, map.code));
    const programs = parsePrograms(get(row, map.program));
    const groupRaw = get(row, map.group);
    const hasDayData = map.days.some((d) => get(row, d.startCol) !== undefined);
    // Filas de notas o firmas: sin código, programa, grupo ni horario.
    if (!code && !programs.length && (groupRaw === undefined || groupRaw === '') && !hasDayData) continue;

    const sessions = [];
    for (const d of map.days) {
      const a = get(row, d.startCol);
      const b = d.endCol >= 0 ? get(row, d.endCol) : undefined;
      if ((a === undefined || a === '') && (b === undefined || b === '')) continue;
      let start = parseTime(a);
      let end = parseTime(b);
      if (end === null) {
        const range = splitRange(a);
        if (range) [start, end] = range;
      }
      if (start === null || end === null || end <= start) {
        warnings.push({ row: r + 1, message: `Hora no reconocida en ${DAYS[d.day].long.toLowerCase()} (${name})` });
        continue;
      }
      sessions.push({ day: d.day, start, end });
    }

    records.push({
      row: r + 1,
      name,
      code,
      programs,
      level: clean(get(row, map.level)).replace(/^\d+\s*-\s*/, ''),
      semester: parseSemester(get(row, map.semester)),
      area: clean(get(row, map.area)),
      sharedCodes: parseCodeList(get(row, map.shared)),
      group: groupRaw === undefined || groupRaw === '' ? '' : typeof groupRaw === 'number' ? String(Math.round(groupRaw)) : clean(groupRaw),
      startDate: parseDate(get(row, map.start), date1904),
      endDate: parseDate(get(row, map.end), date1904),
      classDates: parseDateList(get(row, map.classDates), date1904),
      sede: clean(get(row, map.sede)),
      teacher: clean(get(row, map.teacher)),
      room: clean(get(row, map.room)),
      modality: clean(get(row, map.modality)),
      sessions,
      hidden: sheet.hiddenRows?.includes(r) || false,
    });
  }

  if (!records.length) {
    const err = new Error('La hoja de oferta no tiene filas con materias.');
    err.code = 'empty';
    throw err;
  }

  // Agrupar: materia (por código) -> componente (por nombre) -> grupo.
  const subjects = new Map();
  for (const rec of records) {
    const key = rec.code ? `c:${rec.code}` : `n:${norm(rec.name)}`;
    let s = subjects.get(key);
    if (!s) {
      s = {
        key,
        code: rec.code,
        names: [],
        components: new Map(),
        programs: new Set(),
        sharedCodes: new Set(),
        level: rec.level,
        semester: rec.semester,
        area: rec.area,
      };
      subjects.set(key, s);
    }
    if (!s.area && rec.area) s.area = rec.area;
    if (!s.semester.raw && rec.semester.raw) s.semester = rec.semester;
    rec.programs.forEach((p) => s.programs.add(p));
    rec.sharedCodes.filter((c) => c !== rec.code).forEach((c) => s.sharedCodes.add(c));

    const compKey = norm(rec.name);
    let comp = s.components.get(compKey);
    if (!comp) {
      comp = { key: compKey, name: rec.name, groups: new Map() };
      s.components.set(compKey, comp);
      s.names.push(rec.name);
    }

    const gKey = rec.group || '·';
    let g = comp.groups.get(gKey);
    if (!g) {
      g = {
        id: `${key}|${compKey}|${gKey}`,
        label: rec.group,
        sessions: [],
        startDate: rec.startDate,
        endDate: rec.endDate,
        dates: rec.classDates,
        sede: rec.sede,
        teacher: rec.teacher,
        room: rec.room,
        modality: rec.modality,
        programs: [...rec.programs],
        rows: [],
      };
      comp.groups.set(gKey, g);
    } else {
      // Mismo grupo repetido en otra fila: se suman sus sesiones.
      if (rec.teacher && !g.teacher.includes(rec.teacher)) g.teacher = g.teacher ? `${g.teacher}, ${rec.teacher}` : rec.teacher;
      if (rec.room && !g.room.includes(rec.room)) g.room = g.room ? `${g.room}, ${rec.room}` : rec.room;
      rec.classDates.forEach((d) => g.dates.includes(d) || g.dates.push(d));
      g.dates.sort();
    }
    g.rows.push(rec.row);
    for (const ses of rec.sessions) {
      if (!g.sessions.some((x) => x.day === ses.day && x.start === ses.start && x.end === ses.end)) g.sessions.push(ses);
    }
  }

  const out = [];
  for (const s of subjects.values()) {
    const components = [...s.components.values()];
    let name = s.names[0];
    if (components.length > 1) {
      const prefix = commonWordPrefix(s.names.map(clean));
      if (prefix) name = prefix;
    }
    const comps = components.map((c) => {
      let label = '';
      if (components.length > 1) {
        label = clean(c.name).slice(name.length).trim() || 'Principal';
        if (!s.names.every((n) => clean(n).startsWith(name))) label = c.name;
      }
      const groups = [...c.groups.values()]
        .map((g) => {
          g.sessions.sort((a, b) => a.day - b.day || a.start - b.start);
          return { ...g, minutes: g.sessions.reduce((t, x) => t + x.end - x.start, 0) };
        })
        .sort((a, b) => a.label.localeCompare(b.label, 'es', { numeric: true }));
      return { key: c.key, label, name: c.name, groups };
    });

    const programs = [...s.programs].sort();
    out.push({
      key: s.key,
      code: s.code,
      name,
      displayName: titleCase(name),
      search: norm([name, ...s.names, s.code, ...s.sharedCodes, s.area].join(' ')),
      sharedCodes: [...s.sharedCodes],
      level: s.level,
      semester: s.semester,
      area: s.area,
      programs,
      components: comps.map((c) => ({ ...c, displayLabel: titleCase(c.label) })),
    });
  }
  out.sort((a, b) => a.displayName.localeCompare(b.displayName, 'es'));

  const programs = [...new Set(out.flatMap((s) => s.programs))].sort();
  const groups = out.flatMap((s) => s.components.flatMap((c) => c.groups));
  const semesters = [...new Set(out.flatMap((s) => s.semester.nums))].sort((a, b) => a - b);

  return {
    sheetName: sheet.name,
    subjects: out,
    programs,
    semesters,
    hasElectives: out.some((s) => s.semester.elective),
    stats: {
      rows: records.length,
      subjects: out.length,
      groups: groups.length,
      unscheduled: groups.filter((g) => !g.sessions.length).length,
    },
    warnings,
  };
}

/** Huella de cada grupo, para detectar cambios entre versiones del archivo. */
export function offerSignature(offer) {
  const sig = {};
  for (const s of offer.subjects) {
    for (const c of s.components) {
      for (const g of c.groups) {
        sig[g.id] = {
          name: s.displayName + (c.displayLabel ? ` · ${c.displayLabel}` : ''),
          label: g.label,
          subjectKey: s.key,
          when: g.sessions.map((x) => `${x.day}@${x.start}-${x.end}`).join(',') + `|${g.dates.join(',')}|${g.startDate || ''}-${g.endDate || ''}`,
        };
      }
    }
  }
  return sig;
}

export function diffSignatures(prev, next) {
  const added = [];
  const removed = [];
  const changed = [];
  for (const [id, g] of Object.entries(next)) {
    if (!prev[id]) added.push(g);
    else if (prev[id].when !== g.when) changed.push(g);
  }
  for (const [id, g] of Object.entries(prev)) if (!next[id]) removed.push(g);
  return { added, removed, changed };
}
