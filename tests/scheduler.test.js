import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, hasSolution, overlapsBetween, datesOverlap, scheduleMetrics } from '../js/scheduler.js';

let n = 0;
const g = (label, sessions, extra = {}) => ({ id: `g${n++}`, label: String(label), sessions: sessions.map(([day, s, e]) => ({ day, start: s * 60, end: e * 60 })), dates: [], ...extra });
const subj = (key, ...components) => ({ key, displayName: key, components: components.map((groups, i) => ({ key: `c${i}`, label: '', groups })) });
const item = (subject, pins = {}) => ({ subject, pins });

test('overlapsBetween detecta cruces y permite clases seguidas', () => {
  assert.equal(overlapsBetween(g(1, [[0, 7, 9]]), g(1, [[0, 9, 11]])).length, 0);
  assert.deepEqual(overlapsBetween(g(1, [[0, 7, 9]]), g(1, [[0, 8, 10]])), [{ day: 0, start: 480, end: 540 }]);
  assert.equal(overlapsBetween(g(1, [[0, 7, 9]]), g(1, [[1, 7, 9]])).length, 0);
  assert.equal(overlapsBetween(g(1, []), g(1, [[0, 7, 9]])).length, 0);
});

test('fechas específicas: no hay cruce si no coinciden', () => {
  const a = g(1, [[4, 11, 13]], { dates: ['2027-01-29'] });
  const b = g(1, [[4, 11, 13]], { dates: ['2027-02-05'] });
  const c = g(1, [[4, 11, 13]], { startDate: '2027-01-25', endDate: '2027-05-29' });
  assert.equal(datesOverlap(a, b), false);
  assert.equal(overlapsBetween(a, b).length, 0);
  assert.equal(overlapsBetween(a, c).length, 1);
  const d = g(1, [[4, 11, 13]], { startDate: '2027-06-01', endDate: '2027-07-01' });
  assert.equal(overlapsBetween(c, d).length, 0);
});

test('elige el grupo que no se cruza', () => {
  const A = subj('A', [g(1, [[0, 7, 9]])]);
  const B = subj('B', [g(1, [[0, 8, 10]]), g(2, [[0, 9, 11]])]);
  const r = plan([item(A), item(B)]);
  assert.equal(r.status, 'ok');
  assert.equal(r.total, 1);
  assert.equal(r.options[0].picks.find((p) => p.subjectKey === 'B').group.label, '2');
});

test('una materia con laboratorio y magistral necesita un grupo de cada uno', () => {
  const F = subj('F', [g(1, [[1, 7, 9]]), g(2, [[1, 13, 15]])], [g(1, [[2, 11, 13]])]);
  const C = subj('C', [g(1, [[1, 13, 15]])]);
  const r = plan([item(F), item(C)]);
  assert.equal(r.status, 'ok');
  assert.equal(r.options[0].picks.length, 3);
  assert.equal(r.options[0].picks[0].group.label, '1');
});

test('respeta grupos fijados y explica cuando causan el cruce', () => {
  const A = subj('A', [g(1, [[0, 7, 9]])]);
  const b1 = g(1, [[0, 8, 10]]);
  const B = subj('B', [b1, g(2, [[0, 9, 11]])]);
  const r = plan([item(A), item(B, { c0: b1.id })]);
  assert.equal(r.status, 'conflict');
  assert.equal(r.diagnosis.pinsBlocking, true);
  assert.equal(r.diagnosis.autoCount, 1);
  assert.equal(r.options[0].conflicts.length, 1);
});

test('sin solución: reporta pares incompatibles y qué quitar', () => {
  const A = subj('A', [g(1, [[0, 7, 9]])]);
  const B = subj('B', [g(1, [[0, 8, 10]])]);
  const C = subj('C', [g(1, [[2, 7, 9]])]);
  const r = plan([item(A), item(B), item(C)]);
  assert.equal(r.status, 'conflict');
  assert.deepEqual(r.diagnosis.pairs.map((p) => [p.a, p.b]), [['A', 'B']]);
  assert.deepEqual(r.diagnosis.pairs[0].overlaps, [{ day: 0, start: 480, end: 540 }]);
  assert.deepEqual(r.diagnosis.removable.map((x) => x.key).sort(), ['A', 'B']);
  assert.equal(r.options[0].conflicts.length, 1);
});

test('ordena por preferencia y penaliza días a evitar', () => {
  const A = subj('A', [g(1, [[0, 7, 9]]), g(2, [[4, 7, 9]])]);
  const B = subj('B', [g(1, [[0, 9, 11]]), g(2, [[0, 14, 16]])]);
  const compact = plan([item(A), item(B)], { sort: 'compact' });
  assert.equal(compact.total, 4);
  assert.deepEqual(compact.options[0].picks.map((p) => p.group.label), ['1', '1']);
  const fewdays = plan([item(A), item(B)], { sort: 'fewdays', avoidDays: [0] });
  assert.equal(fewdays.options[0].picks[0].group.label, '2'); // A el viernes, evita el lunes
  const late = plan([item(A), item(B)], { sort: 'late' });
  assert.equal(late.options[0].metrics.minStart, 7 * 60);
});

test('métricas: días, huecos y minutos', () => {
  const m = scheduleMetrics([g(1, [[0, 7, 9], [0, 11, 13]]), g(1, [[2, 9, 10]])]);
  assert.equal(m.days, 2);
  assert.equal(m.gaps, 120);
  assert.equal(m.minutes, 300);
});

test('hasSolution sirve para el indicador "cabe"', () => {
  const A = subj('A', [g(1, [[0, 7, 9]])]);
  const B = subj('B', [g(1, [[0, 8, 10]])]);
  assert.equal(hasSolution([item(A)]), true);
  assert.equal(hasSolution([item(A), item(B)]), false);
});
