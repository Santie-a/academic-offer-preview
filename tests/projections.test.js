import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOffer } from '../js/parser.js';
import { plan } from '../js/scheduler.js';
import {
  selectionSignature,
  buildProjection,
  evaluateProjection,
  restoreSelection,
  encodeShare,
  decodeShare,
  selectionFromShare,
} from '../js/projections.js';
import { HEADER, row } from './helpers.js';

const wb = (rows) => ({ date1904: false, sheets: [{ name: 'OFERTA', hidden: false, rows }] });
const index = (offer) => new Map(offer.subjects.map((s) => [s.key, s]));

const base = [
  HEADER,
  row({ code: 1, name: 'CÁLCULO 2', group: 1, days: { 0: [7, 9] } }),
  row({ code: 1, name: 'CÁLCULO 2', group: 2, days: { 0: [9, 11] } }),
  row({ code: 2, name: 'FÍSICA 1 LABORATORIO', group: 1, days: { 0: [9, 11] } }),
  row({ code: 2, name: 'FÍSICA 1 MAGISTRAL', group: 1, days: { 2: [11, 13] } }),
];

function snapshot(rows) {
  const offer = parseOffer(wb(rows));
  const byKey = index(offer);
  const selection = [
    { key: 'c:1', color: 0, name: 'Cálculo 2', pins: {} },
    { key: 'c:2', color: 1, name: 'Física 1', pins: {} },
  ];
  const result = plan(selection.map((e) => ({ subject: byKey.get(e.key), pins: e.pins })));
  return { offer, byKey, selection, option: result.options[0] };
}

test('selectionSignature no depende del orden', () => {
  const a = [{ key: 'b', pins: { y: '2', x: '1' } }, { key: 'a', pins: {} }];
  const b = [{ key: 'a', pins: {} }, { key: 'b', pins: { x: '1', y: '2' } }];
  assert.equal(selectionSignature(a), selectionSignature(b));
  assert.notEqual(selectionSignature(a), selectionSignature([{ key: 'a', pins: {} }]));
});

test('buildProjection fija los grupos de la opción y guarda un resumen', () => {
  const { selection, option } = snapshot(base);
  const p = buildProjection({ id: 'p1', name: '  Plan A ', selection, option, now: 5 });
  assert.equal(p.name, 'Plan A');
  assert.equal(p.selection[0].pins['CALCULO 2'], 'c:1|CALCULO 2|1'); // el G2 se cruza con el laboratorio
  assert.deepEqual(Object.keys(p.selection[1].pins).sort(), ['FISICA 1 LABORATORIO', 'FISICA 1 MAGISTRAL']);
  assert.equal(p.stats.subjects, 2);
  assert.equal(p.stats.conflicts, 0);
  assert.equal(p.blocks.length, 3);
});

test('evaluateProjection detecta cambios en la oferta', () => {
  const { selection, option, byKey } = snapshot(base);
  const p = buildProjection({ id: 'p1', name: 'A', selection, option });
  assert.equal(evaluateProjection(p, byKey).ok, true);

  const moved = [...base];
  moved[1] = row({ code: 1, name: 'CÁLCULO 2', group: 1, days: { 0: [7, 8] } });
  const r1 = evaluateProjection(p, index(parseOffer(wb(moved))));
  assert.deepEqual(r1.changedGroups, ['Cálculo 2 · G1']);

  const gone = base.filter((_, i) => i !== 1);
  const r2 = evaluateProjection(p, index(parseOffer(wb(gone))));
  assert.deepEqual(r2.missingGroups, ['Cálculo 2']);
  assert.deepEqual(restoreSelection(p, index(parseOffer(wb(gone))))[0].pins, {});

  const noFis = base.slice(0, 3);
  assert.deepEqual(evaluateProjection(p, index(parseOffer(wb(noFis)))).missingSubjects, ['Física 1']);
});

test('enlace para compartir: ida y vuelta, con tildes', () => {
  const { selection, option, byKey } = snapshot(base);
  const p = buildProjection({ id: 'p1', name: 'Opción mañana', selection, option });
  const code = encodeShare(p, byKey);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  const shared = decodeShare(code);
  assert.equal(shared.name, 'Opción mañana');
  const sel = selectionFromShare(shared, byKey);
  assert.equal(selectionSignature(sel), selectionSignature(p.selection));
});

test('decodeShare rechaza enlaces inválidos', () => {
  assert.equal(decodeShare('no-es-valido'), null);
  assert.equal(decodeShare(''), null);
});
