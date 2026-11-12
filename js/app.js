import { readWorkbook } from './xlsx.js';
import { parseOffer, DAYS, norm, titleCase, offerSignature, diffSignatures } from './parser.js';
import { plan, hasSolution, overlapsBetween, SORTS } from './scheduler.js';
import { buildIcs } from './ics.js';

// ---------------------------------------------------------------- utilidades

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtTime = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
const fmtRange = (a, b) => `${fmtTime(a)}–${fmtTime(b)}`;
const fmtHours = (min) => {
  const h = min / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1).replace('.', ',')} h`;
};
const fmtDate = (iso) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }).replace('.', '');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const sessionText = (s) => `${DAYS[s.day].tiny} ${fmtRange(s.start, s.end)}`;
const hoverCapable = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

const ICON = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  alert: '<path d="M12 3.5 21.5 20h-19z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  ok: '<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.7 2.7L16 9.7"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.7"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4 19h16"/>',
  print: '<path d="M7 9V3.5h10V9"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v6.5H7z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.1"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
};
const icon = (name, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

const HUES = [212, 152, 28, 276, 348, 188, 46, 248, 112, 318, 4, 196];

// ---------------------------------------------------------------- persistencia

const KEYS = { offer: 'hp.offer.v1', selection: 'hp.selection.v1', prefs: 'hp.prefs.v1', ui: 'hp.ui.v1' };
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* sin almacenamiento */
    }
  },
};

// ---------------------------------------------------------------- estado

const state = {
  offer: null, // { meta: {fileName, loadedAt}, data }
  selection: [], // [{ key, color, pins: {compKey: groupId}, name }]
  prefs: { sort: 'compact', avoidDays: [] },
  ui: { tab: 'offer', program: 'ALL', semester: 'ALL', query: '', onlyFits: false },
  optionIndex: 0,
  preview: null, // grupo que se previsualiza al pasar el cursor
  notices: [], // avisos persistentes en pantalla
};

let subjectsByKey = new Map();
let planCache = { sig: '', result: null };
let fitCache = { sig: '', map: new Map() };

function loadState() {
  const offer = store.get(KEYS.offer, null);
  if (offer?.data?.subjects) state.offer = offer;
  state.selection = store.get(KEYS.selection, []).filter((s) => s && s.key);
  state.prefs = { ...state.prefs, ...store.get(KEYS.prefs, {}) };
  state.ui = { ...state.ui, ...store.get(KEYS.ui, {}), query: '' };
  if (!SORTS[state.prefs.sort]) state.prefs.sort = 'compact';
  indexOffer();
}

function saveSelection() {
  store.set(KEYS.selection, state.selection);
}
function savePrefs() {
  store.set(KEYS.prefs, state.prefs);
}
function saveUi() {
  const { tab, program, semester, onlyFits } = state.ui;
  store.set(KEYS.ui, { tab, program, semester, onlyFits });
}

function indexOffer() {
  subjectsByKey = new Map((state.offer?.data.subjects || []).map((s) => [s.key, s]));
  if (state.offer && state.ui.program !== 'ALL' && !state.offer.data.programs.includes(state.ui.program)) state.ui.program = 'ALL';
  planCache = { sig: '', result: null };
  fitCache = { sig: '', map: new Map() };
}

// ---------------------------------------------------------------- planificación

function planItems() {
  return state.selection
    .filter((s) => subjectsByKey.has(s.key))
    .map((s) => ({ subject: subjectsByKey.get(s.key), pins: s.pins || {} }));
}

function selectionSig() {
  return JSON.stringify([state.selection.map((s) => [s.key, s.pins]), state.prefs, state.offer?.meta.loadedAt]);
}

function currentPlan() {
  const sig = selectionSig();
  if (planCache.sig !== sig) {
    planCache = { sig, result: plan(planItems(), state.prefs) };
    state.optionIndex = 0;
  }
  return planCache.result;
}

function currentOption() {
  const result = currentPlan();
  if (!result.options.length) return null;
  state.optionIndex = Math.min(Math.max(0, state.optionIndex), result.options.length - 1);
  return result.options[state.optionIndex];
}

/** ¿La materia cabe sin cruces junto a lo que ya está seleccionado? */
function fitsSubject(subject) {
  const sig = selectionSig();
  if (fitCache.sig !== sig) fitCache = { sig, map: new Map() };
  if (!fitCache.map.has(subject.key)) {
    fitCache.map.set(subject.key, hasSolution([...planItems(), { subject, pins: {} }]));
  }
  return fitCache.map.get(subject.key);
}

const isSelected = (key) => state.selection.some((s) => s.key === key);
const selEntry = (key) => state.selection.find((s) => s.key === key);

function hueOf(key) {
  const e = selEntry(key);
  return HUES[(e?.color ?? 0) % HUES.length];
}

function nextColor() {
  const used = new Set(state.selection.map((s) => s.color));
  for (let i = 0; i < HUES.length; i++) if (!used.has(i)) return i;
  return state.selection.length % HUES.length;
}

function addSubject(key, pins = {}) {
  const subject = subjectsByKey.get(key);
  if (!subject) return;
  const existing = selEntry(key);
  if (existing) {
    existing.pins = { ...existing.pins, ...pins };
  } else {
    state.selection.push({ key, color: nextColor(), pins, name: subject.displayName });
    toast(`${subject.displayName} agregada`);
  }
  saveSelection();
}

function removeSubject(key) {
  const subject = subjectsByKey.get(key);
  state.selection = state.selection.filter((s) => s.key !== key);
  saveSelection();
  toast(`${subject?.displayName || 'Materia'} quitada`);
}

function setPin(key, compKey, groupId) {
  const e = selEntry(key);
  if (!e) return;
  e.pins = { ...e.pins };
  if (groupId) e.pins[compKey] = groupId;
  else delete e.pins[compKey];
  saveSelection();
}

// ---------------------------------------------------------------- carga de archivo

async function loadFile(file) {
  if (!file) return;
  toast('Leyendo archivo…', 0);
  try {
    const buffer = await file.arrayBuffer();
    const workbook = await readWorkbook(buffer);
    const data = parseOffer(workbook);
    const prevSig = state.offer ? offerSignature(state.offer.data) : null;
    const prevName = state.offer?.meta.fileName;

    state.offer = { meta: { fileName: file.name, loadedAt: Date.now() }, data };
    indexOffer();
    const stored = store.set(KEYS.offer, state.offer);

    // Limpiar grupos fijados que ya no existen.
    const lostPins = [];
    for (const e of state.selection) {
      const subject = subjectsByKey.get(e.key);
      if (!subject) continue;
      for (const [compKey, gid] of Object.entries(e.pins || {})) {
        const comp = subject.components.find((c) => c.key === compKey);
        if (!comp || !comp.groups.some((g) => g.id === gid)) {
          delete e.pins[compKey];
          lostPins.push(subject.displayName);
        }
      }
      e.name = subject.displayName;
    }
    saveSelection();

    state.notices = state.notices.filter((n) => n.type !== 'diff' && n.type !== 'error');
    if (prevSig) {
      const diff = diffSignatures(prevSig, offerSignature(data));
      const total = diff.added.length + diff.removed.length + diff.changed.length;
      if (total) {
        state.notices.push({ type: 'diff', diff, lostPins, prevName });
        hideToast();
      } else {
        toast('Oferta cargada: sin cambios respecto a la versión anterior');
      }
    } else {
      toast(`Oferta cargada: ${plural(data.stats.subjects, 'materia', 'materias')}, ${plural(data.stats.groups, 'grupo', 'grupos')}`);
    }
    if (!stored) {
      state.notices.push({ type: 'info', text: 'No se pudo guardar la oferta en este navegador (modo privado o sin espacio). Tendrás que cargarla de nuevo la próxima vez.' });
    }
    if (data.warnings.length) {
      state.notices.push({ type: 'warn', text: `${plural(data.warnings.length, 'fila tiene', 'filas tienen')} horas que no se pudieron leer. Revisa los detalles en el menú del archivo.` });
    }
    render();
  } catch (err) {
    console.error(err);
    hideToast();
    state.notices = state.notices.filter((n) => n.type !== 'error');
    state.notices.push({ type: 'error', text: err?.message || 'No se pudo leer el archivo.' });
    renderNotices();
  }
}

function pickFile() {
  $('#fileInput').click();
}

// ---------------------------------------------------------------- render: general

function render() {
  const hasOffer = !!state.offer;
  $('#welcome').hidden = hasOffer;
  $('#app').hidden = !hasOffer;
  $('#tabbar').hidden = !hasOffer;
  $('#fileButton').hidden = !hasOffer;
  document.body.dataset.tab = state.ui.tab;
  renderNotices();
  if (!hasOffer) return;
  $('#fileButtonLabel').textContent = state.offer.meta.fileName.replace(/\.xlsx$/i, '');
  renderFilters();
  renderSubjectList();
  renderPlan();
  renderTabs();
}

function renderTabs() {
  document.body.dataset.tab = state.ui.tab;
  document.querySelectorAll('#tabbar [data-tab]').forEach((b) => {
    b.setAttribute('aria-current', b.dataset.tab === state.ui.tab ? 'page' : 'false');
  });
  const badge = $('#planBadge');
  const n = state.selection.length;
  badge.hidden = n === 0;
  badge.textContent = n;
  const result = currentPlan();
  badge.classList.toggle('is-bad', result.status === 'conflict');
}

function renderNotices() {
  const el = $('#notices');
  el.innerHTML = state.notices
    .map((n, i) => {
      if (n.type === 'diff') return diffNotice(n, i);
      const ic = n.type === 'error' ? 'alert' : n.type === 'warn' ? 'alert' : 'info';
      return `<div class="notice notice-${n.type}">${icon(ic)}<div class="notice-body">${esc(n.text)}</div>
        <button class="icon-btn" data-action="dismiss" data-index="${i}" aria-label="Cerrar aviso">${icon('x')}</button></div>`;
    })
    .join('');
}

function diffNotice(n, i) {
  const { added, removed, changed } = n.diff;
  const parts = [];
  if (added.length) parts.push(plural(added.length, 'grupo nuevo', 'grupos nuevos'));
  if (removed.length) parts.push(plural(removed.length, 'grupo eliminado', 'grupos eliminados'));
  if (changed.length) parts.push(plural(changed.length, 'grupo con cambios de horario', 'grupos con cambios de horario'));
  const mine = new Set(state.selection.map((s) => s.key));
  const affected = [...new Set([...removed, ...changed].filter((g) => mine.has(g.subjectKey)).map((g) => g.name))];
  const list = (title, arr) =>
    arr.length ? `<p class="diff-title">${title}</p><ul>${arr.map((g) => `<li>${esc(g.name)}${g.label ? ` · G${esc(g.label)}` : ''}</li>`).join('')}</ul>` : '';
  return `<div class="notice notice-diff">${icon('info')}<div class="notice-body">
      <strong>Oferta actualizada.</strong> ${parts.join(' · ')}.
      ${affected.length ? `<div class="diff-affected">Afecta a tus materias: ${affected.map(esc).join(', ')}</div>` : ''}
      ${n.lostPins.length ? `<div class="diff-affected">Algunos grupos fijados ya no existen y pasaron a automático.</div>` : ''}
      <details><summary>Ver cambios</summary>${list('Nuevos', added)}${list('Con cambios de horario', changed)}${list('Eliminados', removed)}</details>
    </div><button class="icon-btn" data-action="dismiss" data-index="${i}" aria-label="Cerrar aviso">${icon('x')}</button></div>`;
}

// ---------------------------------------------------------------- render: oferta

function renderFilters() {
  const { data } = state.offer;
  const counts = {};
  for (const s of data.subjects) for (const p of s.programs) counts[p] = (counts[p] || 0) + 1;
  const chip = (value, label, count) =>
    `<button type="button" class="chip" data-action="program" data-program="${esc(value)}" aria-pressed="${state.ui.program === value}">${esc(label)}${count !== undefined ? `<small>${count}</small>` : ''}</button>`;
  $('#programChips').innerHTML = chip('ALL', 'Todos', data.subjects.length) + data.programs.map((p) => chip(p, p, counts[p])).join('');

  const opts = [`<option value="ALL">Todos los semestres</option>`]
    .concat(data.semesters.map((n) => `<option value="${n}">Semestre ${n}</option>`))
    .concat(data.hasElectives ? [`<option value="ELECTIVA">Electivas</option>`] : []);
  const sel = $('#semesterFilter');
  sel.innerHTML = opts.join('');
  if (![...sel.options].some((o) => o.value === state.ui.semester)) state.ui.semester = 'ALL';
  sel.value = state.ui.semester;
  $('#onlyFits').checked = state.ui.onlyFits;
}

function filteredSubjects() {
  const { program, semester, query, onlyFits } = state.ui;
  const terms = norm(query).split(' ').filter(Boolean);
  const canFit = state.selection.length > 0 && currentPlan().status === 'ok';
  const q = terms.join(' ');
  const rank = (s) => {
    if (!q) return 0;
    const name = norm(s.name);
    if (name.startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    if (terms.every((t) => name.includes(t))) return 2;
    return 3;
  };
  const list = state.offer.data.subjects.filter((s) => {
    if (program !== 'ALL' && !s.programs.includes(program)) return false;
    if (semester === 'ELECTIVA' && !s.semester.elective) return false;
    if (semester !== 'ALL' && semester !== 'ELECTIVA' && !s.semester.nums.includes(Number(semester))) return false;
    if (terms.length && !terms.every((t) => s.search.includes(t))) return false;
    if (onlyFits && canFit && !isSelected(s.key) && !fitsSubject(s)) return false;
    return true;
  });
  return q ? list.map((s, i) => [rank(s), i, s]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]) : list;
}

function semesterText(s) {
  if (s.semester.elective) return s.semester.electiveArea ? `Electiva · ${s.semester.electiveArea}` : 'Electiva';
  if (s.semester.nums.length) return `Sem. ${s.semester.label}`;
  return s.semester.label;
}

function groupLines(subject) {
  const multi = subject.components.length > 1;
  return subject.components
    .flatMap((c) =>
      c.groups.map((g) => {
        const when = g.sessions.length ? g.sessions.map(sessionText).join(' · ') : '<em>Sin horario definido</em>';
        const tag = `${multi ? `${esc(c.displayLabel)} ` : ''}G${esc(g.label || '–')}`;
        return `<li data-preview="${esc(g.id)}" data-key="${esc(subject.key)}"><span class="gtag">${tag}</span><span>${when}${g.dates.length ? ` <span class="muted">(${g.dates.length} fechas)</span>` : ''}</span></li>`;
      }),
    )
    .join('');
}

function renderSubjectList() {
  const list = filteredSubjects();
  const canFit = state.selection.length > 0 && currentPlan().status === 'ok';
  const el = $('#subjectList');
  if (!list.length) {
    el.innerHTML = `<div class="empty-small">No hay materias con estos filtros.${state.ui.query ? ' Prueba con otra búsqueda.' : ''}</div>`;
    return;
  }
  const head = `<div class="list-count">${plural(list.length, 'materia', 'materias')}${state.ui.program !== 'ALL' ? ` en ${esc(state.ui.program)}` : ''}</div>`;
  el.innerHTML =
    head +
    list
      .map((s) => {
        const selected = isSelected(s.key);
        let badge = '';
        if (selected) badge = `<span class="fit fit-in" style="--h:${hueOf(s.key)}">En tu horario</span>`;
        else if (canFit) badge = fitsSubject(s) ? `<span class="fit fit-yes">Cabe</span>` : `<span class="fit fit-no">Se cruza</span>`;
        const meta = [s.code, semesterText(s), s.area].filter(Boolean).map(esc).join(' · ');
        return `<article class="subj${selected ? ' is-selected' : ''}" style="--h:${selected ? hueOf(s.key) : 220}" data-action="open" data-key="${esc(s.key)}">
          <div class="subj-main">
            <button type="button" class="subj-title" data-action="open" data-key="${esc(s.key)}">${esc(s.displayName)}</button>
            <span class="subj-meta">${meta}</span>
            <ul class="subj-groups">${groupLines(s)}</ul>
            ${badge}
          </div>
          <button type="button" class="add-btn" data-action="toggle" data-key="${esc(s.key)}" aria-pressed="${selected}" aria-label="${selected ? 'Quitar' : 'Agregar'} ${esc(s.displayName)}">${icon(selected ? 'check' : 'plus')}</button>
        </article>`;
      })
      .join('');
}

// ---------------------------------------------------------------- render: horario

function renderPlan() {
  const result = currentPlan();
  const option = currentOption();
  renderOptionNav(result);
  renderStatus(result, option);
  renderTools();
  renderCalendar(option);
  renderSelected(result, option);
  renderActions(option);
}

function renderOptionNav(result) {
  const el = $('#optionNav');
  const n = result.options.length;
  if (!n || result.status === 'empty') {
    el.innerHTML = '';
    return;
  }
  const totalText = result.status === 'ok' ? `${result.total}${result.truncated ? '+' : ''}` : `${n}`;
  if (n === 1) {
    el.innerHTML = `<span class="option-label">${result.status === 'ok' ? 'Única opción' : 'Mejor opción posible'}</span>`;
    return;
  }
  el.innerHTML = `<button class="icon-btn" data-action="option" data-step="-1" aria-label="Opción anterior" ${state.optionIndex === 0 ? 'disabled' : ''}>${icon('left')}</button>
    <span class="option-label">Opción <b>${state.optionIndex + 1}</b> de ${totalText}</span>
    <button class="icon-btn" data-action="option" data-step="1" aria-label="Opción siguiente" ${state.optionIndex >= n - 1 ? 'disabled' : ''}>${icon('right')}</button>`;
}

function subjectName(key) {
  return subjectsByKey.get(key)?.displayName || selEntry(key)?.name || 'Materia';
}

function renderStatus(result, option) {
  const el = $('#planStatus');
  const missing = state.selection.filter((s) => !subjectsByKey.has(s.key));
  if (result.status === 'empty') {
    el.innerHTML = `<div class="empty-plan">
      ${icon('calendar', 'big')}
      <p><strong>Tu horario está vacío.</strong><br>Agrega las materias que quieres ver; el planificador elige los grupos para que no se crucen.</p>
      <button type="button" class="btn btn-primary only-mobile" data-action="tab" data-tab="offer">Ver oferta</button>
    </div>`;
    return;
  }
  const m = option.metrics;
  const summary = `<div class="summary">
      <span><b>${plural(state.selection.length - missing.length, 'materia', 'materias')}</b></span>
      <span>${fmtHours(m.minutes)}/semana</span>
      <span>${plural(m.days, 'día', 'días')}</span>
      ${m.gaps ? `<span>${fmtHours(m.gaps)} de huecos</span>` : '<span>sin huecos</span>'}
    </div>`;

  if (result.status === 'ok') {
    el.innerHTML = `<div class="status status-ok">${icon('ok')}<div><strong>Sin cruces.</strong> ${
      result.total > 1 ? `Hay ${result.truncated ? 'más de ' : ''}${result.total} combinaciones posibles; usa las flechas para compararlas.` : 'Esta es la única combinación posible.'
    }</div></div>${summary}`;
    return;
  }

  const d = result.diagnosis;
  const lines = [];
  if (d.pinsBlocking) {
    lines.push(`<li>Los grupos que fijaste causan el cruce. En automático hay ${d.autoCount} ${d.autoCount === 1 ? 'opción' : 'opciones'} sin cruces.
      <button type="button" class="link-btn" data-action="unpin-all">Pasar todo a automático</button></li>`);
  }
  for (const key of d.single) {
    lines.push(`<li><b>${esc(subjectName(key))}</b>: sus componentes o grupos fijados se cruzan entre sí.</li>`);
  }
  for (const p of d.pairs) {
    const where = p.overlaps.length ? ` (${p.overlaps.map((o) => `${DAYS[o.day].tiny} ${fmtRange(o.start, o.end)}`).join(', ')})` : '';
    lines.push(`<li><b>${esc(subjectName(p.a))}</b> y <b>${esc(subjectName(p.b))}</b> siempre se cruzan${where}.</li>`);
  }
  if (!d.pairs.length && !d.single.length && !d.pinsBlocking) {
    lines.push('<li>Cada par de materias tiene grupos compatibles, pero no existe una combinación de todas sin cruces.</li>');
  }
  const suggestions = d.removable.slice(0, 3).map(
    (r) => `<button type="button" class="suggest" data-action="remove" data-key="${esc(r.key)}">Quitar <b>${esc(subjectName(r.key))}</b><small>${r.truncated ? 'más de ' : ''}${r.count} ${r.count === 1 ? 'opción' : 'opciones'} sin cruces</small></button>`,
  );
  el.innerHTML = `<div class="status status-bad">${icon('alert')}<div>
      <strong>No hay combinación sin cruces.</strong> Te mostramos la que menos se cruza (bloques en rojo).
      <ul>${lines.join('')}</ul>
      ${suggestions.length ? `<div class="suggest-row"><span>Para resolverlo:</span>${suggestions.join('')}</div>` : d.pairs.length > 1 ? '<p class="hint">Quitar una sola materia no basta: quita una de cada par o cambia alguna por otra.</p>' : ''}
    </div></div>${summary}`;
}

function renderTools() {
  const el = $('#planTools');
  if (!state.selection.length) {
    el.innerHTML = '';
    return;
  }
  const sortOpts = Object.entries(SORTS)
    .map(([k, v]) => `<option value="${k}" ${state.prefs.sort === k ? 'selected' : ''}>${v.label}</option>`)
    .join('');
  const days = DAYS.slice(0, 6)
    .map((d) => `<button type="button" class="day-toggle" data-action="avoid" data-day="${d.idx}" aria-pressed="${state.prefs.avoidDays.includes(d.idx)}" title="Evitar ${d.long.toLowerCase()}">${d.tiny}</button>`)
    .join('');
  el.innerHTML = `<label class="inline-field"><span>Priorizar</span><select id="sortSelect">${sortOpts}</select></label>
    <div class="inline-field" role="group" aria-label="Días que prefieres libres"><span>Días libres</span><div class="day-toggles">${days}</div></div>`;
}

function optionBlocks(option) {
  if (!option) return [];
  const conflictIds = new Set(option.conflicts.flatMap((c) => [c.a.groupId, c.b.groupId]));
  const blocks = [];
  for (const p of option.picks) {
    const subject = subjectsByKey.get(p.subjectKey);
    const comp = subject.components.find((c) => c.key === p.compKey);
    for (const s of p.group.sessions) {
      blocks.push({
        ...s,
        key: p.subjectKey,
        hue: hueOf(p.subjectKey),
        title: subject.displayName,
        sub: `${comp.displayLabel ? `${comp.displayLabel} · ` : ''}G${p.group.label || '–'}`,
        partial: p.group.dates.length > 0,
        conflict: conflictIds.has(p.group.id) && option.conflicts.some((c) => (c.a.groupId === p.group.id || c.b.groupId === p.group.id) && c.overlaps.some((o) => o.day === s.day && o.start < s.end && s.start < o.end)),
      });
    }
  }
  return blocks;
}

function layoutDay(items) {
  items.sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = [];
    for (const it of cluster) {
      let lane = lanes.findIndex((end) => end <= it.start);
      if (lane < 0) {
        lane = lanes.length;
        lanes.push(0);
      }
      lanes[lane] = it.end;
      it.lane = lane;
    }
    for (const it of cluster) it.lanes = lanes.length;
    cluster = [];
    clusterEnd = -1;
  };
  for (const it of items) {
    if (cluster.length && it.start >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) flush();
  return items;
}

function renderCalendar(option) {
  const el = $('#calendar');
  if (!state.selection.length && !state.preview) {
    el.innerHTML = '';
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const blocks = optionBlocks(option);
  const preview = state.preview
    ? state.preview.group.sessions.map((s) => ({ ...s, preview: true, hue: 220, title: state.preview.title, sub: state.preview.sub }))
    : [];
  const all = [...blocks, ...preview];

  const days = [0, 1, 2, 3, 4];
  if (all.some((b) => b.day === 5)) days.push(5);
  if (all.some((b) => b.day === 6)) days.push(6);
  let min = 7 * 60;
  let max = 18 * 60;
  if (all.length) {
    min = Math.min(min, Math.floor(Math.min(...all.map((b) => b.start)) / 60) * 60);
    max = Math.max(max, Math.ceil(Math.max(...all.map((b) => b.end)) / 60) * 60);
  }
  const hours = (max - min) / 60;
  const pct = (m) => ((m - min) / (max - min)) * 100;

  const head = `<div class="cal-head"><div></div>${days.map((d) => `<div><span class="d-long">${DAYS[d].short}</span><span class="d-tiny">${DAYS[d].tiny}</span></div>`).join('')}</div>`;
  const times = [];
  for (let h = min; h < max; h += 60) times.push(`<span style="top:${pct(h)}%">${h / 60}:00</span>`);

  const cols = days
    .map((d) => {
      const items = layoutDay(all.filter((b) => b.day === d).map((b) => ({ ...b })));
      const html = items
        .map((b) => {
          const style = `--h:${b.hue};top:${pct(b.start)}%;height:${pct(b.end) - pct(b.start)}%;left:${(b.lane / b.lanes) * 100}%;width:${100 / b.lanes}%`;
          const cls = ['blk', b.conflict ? 'is-conflict' : '', b.preview ? 'is-preview' : '', b.end - b.start <= 60 ? 'is-short' : ''].join(' ');
          const label = `${b.title}, ${DAYS[b.day].long} ${fmtRange(b.start, b.end)}, ${b.sub}${b.conflict ? ', se cruza' : ''}`;
          if (b.preview) {
            return `<div class="${cls}" style="${style}" aria-hidden="true"><span class="blk-title">${esc(b.title)}</span><span class="blk-sub">${fmtRange(b.start, b.end)}</span></div>`;
          }
          return `<button type="button" class="${cls}" style="${style}" data-action="open" data-key="${esc(b.key)}" aria-label="${esc(label)}">
            <span class="blk-title">${esc(b.title)}</span>
            <span class="blk-sub">${fmtRange(b.start, b.end)} · ${esc(b.sub)}${b.partial ? ' · fechas' : ''}</span>
          </button>`;
        })
        .join('');
      return `<div class="cal-day${state.prefs.avoidDays.includes(d) ? ' is-avoided' : ''}">${html}</div>`;
    })
    .join('');

  el.style.setProperty('--hours', hours);
  el.style.setProperty('--days', days.length);
  el.innerHTML = `${head}<div class="cal-body"><div class="cal-times">${times.join('')}</div>${cols}</div>`;
}

function componentSelect(subject, comp, entry, option) {
  const pinned = entry.pins?.[comp.key] || '';
  const chosen = option?.picks.find((p) => p.subjectKey === subject.key && p.compKey === comp.key)?.group;
  const autoLabel = chosen ? `Automático (G${chosen.label || '–'})` : 'Automático';
  const opts = [`<option value="">${esc(autoLabel)}</option>`]
    .concat(
      comp.groups.map((g) => {
        const when = g.sessions.length ? g.sessions.map(sessionText).join(', ') : 'sin horario';
        return `<option value="${esc(g.id)}" ${pinned === g.id ? 'selected' : ''}>G${esc(g.label || '–')} · ${esc(when)}</option>`;
      }),
    )
    .join('');
  const label = comp.displayLabel || 'Grupo';
  if (comp.groups.length === 1) {
    return `<div class="comp-select is-single"><span>${esc(label)}</span><span class="comp-fixed">G${esc(comp.groups[0].label || '–')} · único grupo</span></div>`;
  }
  return `<label class="comp-select${pinned ? ' is-pinned' : ''}">
      <span>${esc(label)}${pinned ? icon('lock', 'tiny') : ''}</span>
      <select data-action="pin" data-key="${esc(subject.key)}" data-comp="${esc(comp.key)}" aria-label="Grupo de ${esc(subject.displayName)} ${esc(comp.displayLabel)}">${opts}</select>
    </label>`;
}

function renderSelected(result, option) {
  const el = $('#selectedList');
  if (!state.selection.length) {
    el.innerHTML = '';
    return;
  }
  const cards = state.selection.map((entry) => {
    const subject = subjectsByKey.get(entry.key);
    if (!subject) {
      return `<article class="sel is-missing" style="--h:${hueOf(entry.key)}">
        <div class="sel-main"><div class="sel-title">${esc(entry.name || entry.key)}</div>
        <div class="sel-note">${icon('alert', 'tiny')} Ya no aparece en la oferta cargada.</div></div>
        <button type="button" class="icon-btn" data-action="remove" data-key="${esc(entry.key)}" aria-label="Quitar">${icon('x')}</button></article>`;
    }
    const picks = option ? option.picks.filter((p) => p.subjectKey === subject.key) : [];
    const minutes = picks.reduce((t, p) => t + p.group.minutes, 0);
    const conflicts = option
      ? option.conflicts.filter((c) => c.a.subjectKey === subject.key || c.b.subjectKey === subject.key)
      : [];
    const conflictText = conflicts
      .map((c) => {
        const other = c.a.subjectKey === subject.key ? c.b.subjectKey : c.a.subjectKey;
        const where = c.overlaps.map((o) => `${DAYS[o.day].tiny} ${fmtRange(o.start, o.end)}`).join(', ');
        return `Se cruza con ${other === subject.key ? 'otro componente' : esc(subjectName(other))} (${where})`;
      })
      .join('<br>');
    const noSchedule = picks.length && picks.every((p) => !p.group.sessions.length);
    const partial = picks.some((p) => p.group.dates.length);
    return `<article class="sel${conflicts.length ? ' is-conflict' : ''}" style="--h:${hueOf(subject.key)}">
      <div class="sel-main">
        <button type="button" class="sel-title" data-action="open" data-key="${esc(subject.key)}">${esc(subject.displayName)}</button>
        <div class="sel-meta">${[subject.code, minutes ? `${fmtHours(minutes)}/sem` : ''].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="comp-selects">${subject.components.map((c) => componentSelect(subject, c, entry, option)).join('')}</div>
        ${conflictText ? `<div class="sel-note is-bad">${icon('alert', 'tiny')} ${conflictText}</div>` : ''}
        ${noSchedule ? `<div class="sel-note">${icon('info', 'tiny')} Sin horario definido en la oferta.</div>` : ''}
        ${partial ? `<div class="sel-note">${icon('info', 'tiny')} Solo se dicta en fechas específicas.</div>` : ''}
      </div>
      <button type="button" class="icon-btn" data-action="remove" data-key="${esc(subject.key)}" aria-label="Quitar ${esc(subject.displayName)}">${icon('x')}</button>
    </article>`;
  });
  el.innerHTML = `<h3>Materias seleccionadas</h3>${cards.join('')}`;
}

function renderActions(option) {
  const el = $('#planActions');
  if (!state.selection.length) {
    el.innerHTML = '';
    return;
  }
  const allPinned =
    option &&
    option.picks.length &&
    option.picks.every((p) => {
      const subject = subjectsByKey.get(p.subjectKey);
      const comp = subject.components.find((c) => c.key === p.compKey);
      return comp.groups.length === 1 || selEntry(p.subjectKey)?.pins?.[p.compKey] === p.group.id;
    });
  const anyPin = state.selection.some((s) => Object.keys(s.pins || {}).length);
  el.innerHTML = `
    ${option ? (allPinned && anyPin ? `<button type="button" class="btn" data-action="unpin-all">${icon('unlock')}Liberar grupos</button>` : `<button type="button" class="btn" data-action="pin-all" title="Mantener estos grupos aunque agregues más materias">${icon('lock')}Fijar estos grupos</button>`) : ''}
    ${option ? `<button type="button" class="btn" data-action="ics">${icon('download')}Exportar calendario</button>` : ''}
    <button type="button" class="btn only-desktop" data-action="print">${icon('print')}Imprimir</button>
    <button type="button" class="btn btn-danger-ghost" data-action="clear">${icon('trash')}Vaciar</button>`;
}

// ---------------------------------------------------------------- hoja de detalle

function openSheet(html) {
  const dlg = $('#sheet');
  dlg.innerHTML = html;
  if (!dlg.open) {
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }
  document.body.classList.add('has-sheet');
}

function closeSheet() {
  const dlg = $('#sheet');
  if (dlg.open) {
    if (typeof dlg.close === 'function') dlg.close();
    else dlg.removeAttribute('open');
  }
  document.body.classList.remove('has-sheet');
  state.sheetKey = null;
}

function openSubject(key) {
  const subject = subjectsByKey.get(key);
  if (!subject) return;
  state.sheetKey = key;
  const entry = selEntry(key);
  const option = currentOption();
  const others = option ? option.picks.filter((p) => p.subjectKey !== key) : [];

  const comps = subject.components
    .map((comp) => {
      const chosen = option?.picks.find((p) => p.subjectKey === key && p.compKey === comp.key)?.group;
      const pinned = entry?.pins?.[comp.key];
      const groups = comp.groups
        .map((g) => {
          const clashes = others
            .map((p) => ({ p, o: overlapsBetween(g, p.group) }))
            .filter((x) => x.o.length)
            .map((x) => `${esc(subjectName(x.p.subjectKey))} (${x.o.map((o) => `${DAYS[o.day].tiny} ${fmtRange(o.start, o.end)}`).join(', ')})`);
          const fit = !state.selection.length || (entry && others.length === 0) ? '' : clashes.length ? `<div class="g-fit is-bad">${icon('alert', 'tiny')} Se cruza con ${clashes.join(', ')}</div>` : `<div class="g-fit is-ok">${icon('ok', 'tiny')} No se cruza con tu horario</div>`;
          const facts = [
            g.sede && `Sede ${esc(g.sede === g.sede.toUpperCase() ? titleCase(g.sede) : g.sede)}`,
            g.room && `Salón ${esc(g.room)}`,
            g.teacher && esc(g.teacher),
            g.modality && esc(g.modality),
            g.startDate && g.endDate && `Del ${fmtDate(g.startDate)} al ${fmtDate(g.endDate)}`,
          ].filter(Boolean);
          const isPinned = pinned === g.id;
          const isChosen = chosen?.id === g.id;
          let action;
          if (isPinned) action = `<button type="button" class="btn btn-small is-on" data-action="unpin" data-key="${esc(key)}" data-comp="${esc(comp.key)}">${icon('lock')}Fijado</button>`;
          else action = `<button type="button" class="btn btn-small" data-action="use-group" data-key="${esc(key)}" data-comp="${esc(comp.key)}" data-group="${esc(g.id)}">${isChosen ? 'Fijar este grupo' : 'Usar este grupo'}</button>`;
          return `<li class="g-card${isChosen ? ' is-chosen' : ''}">
            <div class="g-head"><strong>Grupo ${esc(g.label || '–')}</strong>${isChosen ? '<span class="pill">En tu horario</span>' : ''}${comp.groups.length > 1 || !entry ? action : ''}</div>
            <div class="g-when">${g.sessions.length ? g.sessions.map((s) => `<span>${DAYS[s.day].long} ${fmtRange(s.start, s.end)}</span>`).join('') : '<span class="muted">Sin horario definido</span>'}</div>
            ${g.dates.length ? `<div class="g-dates">Solo estas fechas: ${g.dates.map(fmtDate).join(', ')}</div>` : ''}
            ${facts.length ? `<div class="g-facts">${facts.join(' · ')}</div>` : ''}
            ${fit}
          </li>`;
        })
        .join('');
      return `${subject.components.length > 1 ? `<h4>${esc(comp.displayLabel)}</h4>` : ''}<ul class="g-list">${groups}</ul>`;
    })
    .join('');

  const facts = [
    subject.code && `<div><dt>Código</dt><dd>${esc(subject.code)}</dd></div>`,
    subject.sharedCodes.length && `<div><dt>Código compartido</dt><dd>${subject.sharedCodes.map(esc).join(', ')}</dd></div>`,
    subject.semester.label && `<div><dt>Semestre</dt><dd>${esc(semesterText(subject))}</dd></div>`,
    subject.area && `<div><dt>Área</dt><dd>${esc(subject.area)}</dd></div>`,
    subject.level && `<div><dt>Nivel</dt><dd>${esc(subject.level.charAt(0) + subject.level.slice(1).toLowerCase())}</dd></div>`,
  ].filter(Boolean);

  openSheet(`<div class="sheet-inner">
    <header class="sheet-head">
      <div><h2 id="sheetTitle">${esc(subject.displayName)}</h2></div>
      <button type="button" class="icon-btn" data-action="close-sheet" aria-label="Cerrar">${icon('x')}</button>
    </header>
    <div class="sheet-body">
      <dl class="facts">${facts.join('')}</dl>
      ${subject.programs.length ? `<div class="prog-list">${subject.programs.map((p) => `<span>${esc(p)}</span>`).join('')}</div>` : ''}
      ${subject.components.length > 1 ? `<p class="muted small">Esta materia tiene ${subject.components.length} componentes; se inscribe un grupo de cada uno.</p>` : ''}
      ${comps}
    </div>
    <footer class="sheet-foot">
      ${entry ? `<button type="button" class="btn btn-danger-ghost" data-action="remove" data-key="${esc(key)}">${icon('trash')}Quitar del horario</button>` : `<button type="button" class="btn btn-primary" data-action="toggle" data-key="${esc(key)}">${icon('plus')}Agregar al horario</button>`}
    </footer>
  </div>`);
}

function openFileInfo() {
  const { meta, data } = state.offer;
  const when = new Date(meta.loadedAt).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
  const warnings = data.warnings.length
    ? `<details class="warn-details"><summary>${plural(data.warnings.length, 'advertencia', 'advertencias')}</summary><ul>${data.warnings.map((w) => `<li>Fila ${w.row}: ${esc(w.message)}</li>`).join('')}</ul></details>`
    : '';
  openSheet(`<div class="sheet-inner">
    <header class="sheet-head"><div><h2 id="sheetTitle">Archivo de oferta</h2></div>
      <button type="button" class="icon-btn" data-action="close-sheet" aria-label="Cerrar">${icon('x')}</button></header>
    <div class="sheet-body">
      <dl class="facts">
        <div><dt>Archivo</dt><dd>${esc(meta.fileName)}</dd></div>
        <div><dt>Cargado</dt><dd>${esc(when)}</dd></div>
        <div><dt>Hoja</dt><dd>${esc(data.sheetName)}</dd></div>
        <div><dt>Contenido</dt><dd>${plural(data.stats.subjects, 'materia', 'materias')} · ${plural(data.stats.groups, 'grupo', 'grupos')}${data.stats.unscheduled ? ` · ${data.stats.unscheduled} sin horario` : ''}</dd></div>
        <div><dt>Programas</dt><dd>${data.programs.map(esc).join(', ')}</dd></div>
      </dl>
      ${warnings}
      <p class="muted small">Cuando publiquen una nueva versión del Excel, cárgala aquí: tu selección se conserva y verás qué grupos cambiaron. Los datos se guardan solo en este navegador.</p>
    </div>
    <footer class="sheet-foot">
      <button type="button" class="btn btn-danger-ghost" data-action="forget">${icon('trash')}Borrar datos</button>
      <button type="button" class="btn btn-primary" data-action="pick-file">${icon('upload')}Cargar nueva versión</button>
    </footer>
  </div>`);
}

// ---------------------------------------------------------------- acciones

function exportIcs() {
  const option = currentOption();
  if (!option) return;
  const entries = option.picks
    .filter((p) => p.group.sessions.length)
    .map((p) => {
      const subject = subjectsByKey.get(p.subjectKey);
      const comp = subject.components.find((c) => c.key === p.compKey);
      return {
        title: `${subject.displayName}${comp.displayLabel ? ` (${comp.displayLabel})` : ''}`,
        group: p.group,
        location: [p.group.sede, p.group.room].filter(Boolean).join(' · '),
        description: `Código ${subject.code || '—'} · Grupo ${p.group.label || '—'}${p.group.teacher ? ` · ${p.group.teacher}` : ''}`,
      };
    });
  const ics = buildIcs(entries, 'Mi horario');
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mi-horario.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Calendario descargado. Ábrelo para importarlo a tu calendario.');
}

function refreshAfterChange({ keepSheet = true } = {}) {
  renderSubjectList();
  renderPlan();
  renderTabs();
  if (keepSheet && state.sheetKey && $('#sheet').open) openSubject(state.sheetKey);
}

function handleAction(btn) {
  const { action, key } = btn.dataset;
  switch (action) {
    case 'tab':
      state.ui.tab = btn.dataset.tab;
      saveUi();
      renderTabs();
      window.scrollTo({ top: 0 });
      break;
    case 'program':
      state.ui.program = btn.dataset.program;
      saveUi();
      renderFilters();
      renderSubjectList();
      break;
    case 'toggle':
      if (isSelected(key)) removeSubject(key);
      else addSubject(key);
      refreshAfterChange();
      break;
    case 'remove':
      removeSubject(key);
      if (state.sheetKey === key) closeSheet();
      refreshAfterChange();
      break;
    case 'open':
      openSubject(key);
      break;
    case 'use-group':
      if (!isSelected(key)) addSubject(key, { [btn.dataset.comp]: btn.dataset.group });
      else setPin(key, btn.dataset.comp, btn.dataset.group);
      refreshAfterChange();
      break;
    case 'unpin':
      setPin(key, btn.dataset.comp, null);
      refreshAfterChange();
      break;
    case 'unpin-all':
      state.selection.forEach((s) => (s.pins = {}));
      saveSelection();
      refreshAfterChange();
      toast('Todos los grupos están en automático');
      break;
    case 'pin-all': {
      const option = currentOption();
      if (!option) break;
      for (const p of option.picks) {
        const e = selEntry(p.subjectKey);
        if (e) e.pins = { ...e.pins, [p.compKey]: p.group.id };
      }
      saveSelection();
      refreshAfterChange();
      toast('Grupos fijados. Se mantendrán al agregar otras materias.');
      break;
    }
    case 'option': {
      const n = currentPlan().options.length;
      state.optionIndex = Math.min(n - 1, Math.max(0, state.optionIndex + Number(btn.dataset.step)));
      renderPlan();
      break;
    }
    case 'avoid': {
      const d = Number(btn.dataset.day);
      const set = new Set(state.prefs.avoidDays);
      if (set.has(d)) set.delete(d);
      else set.add(d);
      state.prefs.avoidDays = [...set].sort();
      savePrefs();
      renderPlan();
      break;
    }
    case 'ics':
      exportIcs();
      break;
    case 'print':
      window.print();
      break;
    case 'clear':
      if (confirm('¿Quitar todas las materias de tu horario?')) {
        state.selection = [];
        saveSelection();
        refreshAfterChange();
      }
      break;
    case 'dismiss':
      state.notices.splice(Number(btn.dataset.index), 1);
      renderNotices();
      break;
    case 'file-info':
      openFileInfo();
      break;
    case 'pick-file':
      closeSheet();
      pickFile();
      break;
    case 'forget':
      if (confirm('Se borrarán la oferta cargada y tu selección de este navegador. ¿Continuar?')) {
        Object.values(KEYS).forEach((k) => store.remove(k));
        state.offer = null;
        state.selection = [];
        state.notices = [];
        indexOffer();
        closeSheet();
        render();
      }
      break;
    case 'close-sheet':
      closeSheet();
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------- toast

let toastTimer;
function toast(text, ms = 2600) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(hideToast, ms);
}
function hideToast() {
  $('#toast').classList.remove('is-visible');
}

// ---------------------------------------------------------------- eventos

function bindEvents() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.tagName === 'SELECT' || btn.disabled) return;
    handleAction(btn);
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('select[data-action="pin"]')) {
      setPin(t.dataset.key, t.dataset.comp, t.value || null);
      refreshAfterChange();
    } else if (t.id === 'sortSelect') {
      state.prefs.sort = t.value;
      savePrefs();
      renderPlan();
    } else if (t.id === 'semesterFilter') {
      state.ui.semester = t.value;
      saveUi();
      renderSubjectList();
    } else if (t.id === 'onlyFits') {
      state.ui.onlyFits = t.checked;
      saveUi();
      renderSubjectList();
    } else if (t.id === 'fileInput') {
      loadFile(t.files?.[0]);
      t.value = '';
    }
  });

  let searchTimer;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.ui.query = e.target.value;
      renderSubjectList();
    }, 120);
  });

  // Vista previa al pasar el cursor sobre un grupo (solo con mouse).
  if (hoverCapable) {
    const list = $('#subjectList');
    list.addEventListener('mouseover', (e) => {
      const li = e.target.closest('[data-preview]');
      const id = li?.dataset.preview || null;
      if ((state.preview?.group.id || null) === id) return;
      if (!li) {
        state.preview = null;
      } else {
        const subject = subjectsByKey.get(li.dataset.key);
        const comp = subject?.components.find((c) => c.groups.some((g) => g.id === id));
        const group = comp?.groups.find((g) => g.id === id);
        state.preview = group && group.sessions.length ? { group, title: subject.displayName, sub: `G${group.label}` } : null;
      }
      renderCalendar(currentOption());
    });
    list.addEventListener('mouseleave', () => {
      if (!state.preview) return;
      state.preview = null;
      renderCalendar(currentOption());
    });
  }

  const sheet = $('#sheet');
  sheet.addEventListener('close', () => {
    document.body.classList.remove('has-sheet');
    state.sheetKey = null;
  });
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) closeSheet(); // clic en el fondo
  });

  // Arrastrar y soltar el Excel en cualquier parte.
  let dragDepth = 0;
  const overlay = $('#dropOverlay');
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    overlay.hidden = false;
  });
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) overlay.hidden = true;
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    overlay.hidden = true;
    loadFile(e.dataTransfer.files[0]);
  });

  // Teclado: flechas para cambiar de opción en escritorio.
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea, dialog[open]')) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const n = state.offer ? currentPlan().options.length : 0;
      if (n < 2) return;
      state.optionIndex = Math.min(n - 1, Math.max(0, state.optionIndex + (e.key === 'ArrowRight' ? 1 : -1)));
      renderPlan();
    }
  });
}

// ---------------------------------------------------------------- inicio

loadState();
bindEvents();
render();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
