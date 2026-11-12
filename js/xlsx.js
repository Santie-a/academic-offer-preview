// Lector mínimo de archivos .xlsx sin dependencias.
// Un .xlsx es un ZIP con XML dentro: se descomprime con DecompressionStream
// (nativo del navegador) y se lee el XML con expresiones regulares.
// Todo ocurre en el dispositivo del usuario; nada se envía a un servidor.

export class XlsxError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const utf8 = new TextDecoder('utf-8');

/**
 * Lee un libro de Excel (.xlsx) y devuelve sus hojas como matrices de celdas.
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {Promise<{date1904: boolean, sheets: {name: string, hidden: boolean, rows: any[][]}[]}>}
 */
export async function readWorkbook(buffer) {
  const files = await unzip(buffer, (name) => name.startsWith('xl/'));

  const workbookXml = files.get('xl/workbook.xml');
  if (!workbookXml) {
    throw new XlsxError('not-xlsx', 'El archivo no parece ser un libro de Excel (.xlsx).');
  }

  const date1904 = /<(?:\w+:)?workbookPr\b[^>]*\bdate1904\s*=\s*["'](?:1|true)["']/.test(workbookXml);
  const rels = parseRels(files.get('xl/_rels/workbook.xml.rels') || '', 'xl/');

  let sst = [];
  const sstPath = [...rels.values()].find((r) => /sharedStrings$/i.test(r.type))?.target || 'xl/sharedstrings.xml';
  if (files.has(sstPath)) sst = parseSharedStrings(files.get(sstPath));

  const sheets = [];
  for (const m of workbookXml.matchAll(/<(?:\w+:)?sheet\b([^>]*?)\/?>/g)) {
    const a = attrs(m[1]);
    const relId = Object.entries(a).find(([k]) => k === 'id' || k.endsWith(':id'))?.[1];
    const target = rels.get(relId)?.target;
    if (!target || !files.has(target)) continue;
    const { rows, hiddenRows } = parseSheet(files.get(target), sst);
    sheets.push({
      name: decodeXml(a.name || ''),
      hidden: a.state === 'hidden' || a.state === 'veryHidden',
      rows,
      hiddenRows,
    });
  }
  if (!sheets.length) throw new XlsxError('no-sheets', 'El libro no contiene hojas legibles.');
  return { date1904, sheets };
}

// ---------------------------------------------------------------- ZIP

async function unzip(buffer, filter) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

  // Fin del directorio central (End Of Central Directory).
  let eocd = -1;
  const stop = Math.max(0, u8.length - 65557);
  for (let i = u8.length - 22; i >= stop; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new XlsxError(
      'not-zip',
      'No se pudo leer el archivo. Asegúrate de que sea un .xlsx (si es .xls, ábrelo en Excel y guárdalo como .xlsx).',
    );
  }

  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map();

  for (let n = 0; n < count; n++) {
    if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) {
      throw new XlsxError('bad-zip', 'El archivo está dañado o incompleto.');
    }
    const method = dv.getUint16(p + 10, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = utf8
      .decode(u8.subarray(p + 46, p + 46 + nameLen))
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .toLowerCase();
    p += 46 + nameLen + extraLen + commentLen;

    if (!filter(name) || name.endsWith('/')) continue;

    const localNameLen = dv.getUint16(localOffset + 26, true);
    const localExtraLen = dv.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const data = u8.subarray(start, start + compressedSize);

    let raw;
    if (method === 0) raw = data;
    else if (method === 8) raw = await inflateRaw(data);
    else throw new XlsxError('zip-method', 'El archivo usa una compresión no soportada.');
    out.set(name, utf8.decode(raw));
  }
  return out;
}

async function inflateRaw(data) {
  if (typeof DecompressionStream === 'undefined') {
    throw new XlsxError('no-decompress', 'Tu navegador es demasiado antiguo para leer archivos .xlsx. Actualízalo e intenta de nuevo.');
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------------------------------------------------------------- XML

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeXml(s) {
  return String(s)
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e] ?? m;
    })
    .replace(/_x([0-9a-fA-F]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function attrs(s) {
  const out = {};
  for (const m of String(s).matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    out[m[1]] = m[2] ?? m[3];
  }
  return out;
}

function resolvePath(base, target) {
  if (target.startsWith('/')) return target.slice(1).toLowerCase();
  const parts = (base + target).split('/');
  const stack = [];
  for (const part of parts) {
    if (part === '..') stack.pop();
    else if (part !== '.' && part !== '') stack.push(part);
  }
  return stack.join('/').toLowerCase();
}

function parseRels(xml, base) {
  const map = new Map();
  for (const m of xml.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?>/g)) {
    const a = attrs(m[1]);
    if (!a.Id || !a.Target) continue;
    map.set(a.Id, { target: resolvePath(base, decodeXml(a.Target)), type: a.Type || '' });
  }
  return map;
}

function textRuns(xml) {
  let s = '';
  const clean = xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '');
  for (const t of clean.matchAll(/<(?:\w+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g)) s += t[1] || '';
  return decodeXml(s);
}

function parseSharedStrings(xml) {
  const out = [];
  for (const m of xml.matchAll(/<(?:\w+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g)) {
    out.push(textRuns(m[1] || ''));
  }
  return out;
}

export function colIndex(ref) {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) n = n * 26 + (c - 64);
    else if (c >= 97 && c <= 122) n = n * 26 + (c - 96);
    else break;
  }
  return n - 1;
}

function parseRef(ref) {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref);
  return m ? { c: colIndex(m[1]), r: parseInt(m[2], 10) - 1 } : null;
}

function parseSheet(xml, sst) {
  const rows = [];
  const hiddenRows = [];
  const body = /<(?:\w+:)?sheetData\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?sheetData>)/.exec(xml)?.[1] || '';

  let nextRow = 0;
  for (const rm of body.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    const ra = attrs(rm[1]);
    const r = ra.r ? parseInt(ra.r, 10) - 1 : nextRow;
    nextRow = r + 1;
    if (ra.hidden === '1' || ra.hidden === 'true') hiddenRows.push(r);

    const row = [];
    let nextCol = 0;
    for (const cm of (rm[2] || '').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const ca = attrs(cm[1]);
      const col = ca.r ? colIndex(ca.r) : nextCol;
      nextCol = col + 1;
      const inner = cm[2];
      if (!inner) continue;

      const type = ca.t || 'n';
      let value;
      if (type === 'inlineStr') {
        value = textRuns(inner);
      } else {
        const vm = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner);
        if (!vm) continue;
        const raw = decodeXml(vm[1]);
        if (type === 's') value = sst[parseInt(raw, 10)];
        else if (type === 'str' || type === 'd') value = raw;
        else if (type === 'b') value = raw === '1' || raw === 'true';
        else if (type === 'e') value = null;
        else {
          const num = Number(raw);
          value = raw.trim() !== '' && Number.isFinite(num) ? num : raw;
        }
      }
      if (value !== undefined && value !== null && value !== '') row[col] = value;
    }
    rows[r] = row;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];

  // Celdas combinadas: se copia el valor de la esquina superior izquierda.
  const merges = /<(?:\w+:)?mergeCells\b[\s\S]*?<\/(?:\w+:)?mergeCells>/.exec(xml)?.[0] || '';
  for (const mm of merges.matchAll(/<(?:\w+:)?mergeCell\b([^>]*?)\/?>/g)) {
    const ref = attrs(mm[1]).ref;
    if (!ref || !ref.includes(':')) continue;
    const [a, b] = ref.split(':').map(parseRef);
    if (!a || !b) continue;
    const v = rows[a.r]?.[a.c];
    if (v === undefined) continue;
    for (let r = a.r; r <= b.r; r++) {
      if (!rows[r]) rows[r] = [];
      for (let c = a.c; c <= b.c; c++) {
        if (rows[r][c] === undefined) rows[r][c] = v;
      }
    }
  }
  return { rows, hiddenRows };
}
