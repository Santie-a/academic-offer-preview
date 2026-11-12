import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOffer, parseTime, parseDate, parsePrograms, parseSemester, titleCase, offerSignature, diffSignatures } from '../js/parser.js';
import { HEADER, row, t } from './helpers.js';

const wb = (rows) => ({ date1904: false, sheets: [{ name: 'Otra', hidden: false, rows: [['Categoria', 'Valor']] }, { name: 'OFERTA', hidden: false, rows }] });

test('parseTime acepta fracciones de Excel y textos', () => {
  assert.equal(parseTime(t(7)), 420);
  assert.equal(parseTime(t(12, 30)), 750);
  assert.equal(parseTime(46412 + t(9)), 540);
  assert.equal(parseTime('7:00'), 420);
  assert.equal(parseTime('13:30'), 810);
  assert.equal(parseTime('1:30 p. m.'), 810);
  assert.equal(parseTime('12:00 a.m.'), 0);
  assert.equal(parseTime('7'), 420);
  assert.equal(parseTime(''), null);
  assert.equal(parseTime('mañana'), null);
});

test('parseDate entiende seriales y textos', () => {
  assert.equal(parseDate(46412), '2027-01-25');
  assert.equal(parseDate(46536), '2027-05-29');
  assert.equal(parseDate('29/01/2027'), '2027-01-29');
  assert.equal(parseDate('2027-02-12'), '2027-02-12');
});

test('parsePrograms separa por comas e "y"', () => {
  assert.deepEqual(parsePrograms('MA01, MA02, , EC04 y FI01, ADM1 '), ['MA01', 'MA02', 'EC04', 'FI01', 'ADM1']);
});

test('parseSemester reconoce rangos y electivas', () => {
  assert.deepEqual(parseSemester('3-4').nums, [3, 4]);
  assert.deepEqual(parseSemester('4-6').nums, [4, 5, 6]);
  assert.deepEqual(parseSemester(7).nums, [7]);
  const e = parseSemester('ELECTIVA - INT. ARTIFICIAL');
  assert.equal(e.elective, true);
  assert.equal(e.electiveArea, 'INT. ARTIFICIAL');
});

test('titleCase respeta minúsculas y siglas', () => {
  assert.equal(titleCase('CÁLCULO 2'), 'Cálculo 2');
  assert.equal(titleCase('LÓGICA PARA CIENCIAS DE LA COMPUTACIÓN'), 'Lógica para Ciencias de la Computación');
  assert.equal(titleCase('NMC: ADN Y LA EVOLUCIÓN DEL HOMBRE'), 'NMC: ADN y la Evolución del Hombre');
  assert.equal(titleCase('HERRAMIENTAS CAD-CAE'), 'Herramientas CAD-CAE');
});

test('parseOffer agrupa materias, componentes y grupos', () => {
  const rows = [
    HEADER,
    row({ code: 11310004, name: 'CÁLCULO 2', programs: 'MA01, ISE1', semester: '3', days: { 0: [9, 11], 2: [13, [14, 30]] } }),
    row({ code: 73210064, name: 'FÍSICA 1 LABORATORIO', group: 1, days: { 1: [7, 9] } }),
    row({ code: 73210064, name: 'FÍSICA 1 LABORATORIO', group: 2, days: { 1: [13, 15] } }),
    row({ code: 73210064, name: 'FÍSICA 1 MAGISTRAL', group: 1, days: { 2: [11, [12, 30]] } }),
    row({ code: 11320039, name: 'PASANTÍA', programs: 'IIN1' }),
    row({ code: 11310028, name: 'SEMINARIO DE GRADO ', days: { 4: [11, 13] }, dates: '29/01/2027, 12/02/2027' }),
    [null, null, null, null, null, null, 'Nota al pie sin datos'],
  ];
  const offer = parseOffer(wb(rows));
  assert.equal(offer.sheetName, 'OFERTA');
  assert.equal(offer.stats.subjects, 4);
  assert.equal(offer.stats.groups, 6);
  assert.equal(offer.stats.unscheduled, 1);
  assert.deepEqual(offer.programs, ['IIN1', 'ISE1', 'MA01']);

  const calc = offer.subjects.find((s) => s.code === '11310004');
  assert.equal(calc.displayName, 'Cálculo 2');
  assert.deepEqual(calc.components[0].groups[0].sessions, [
    { day: 0, start: 540, end: 660 },
    { day: 2, start: 780, end: 870 },
  ]);
  assert.equal(calc.components[0].groups[0].startDate, '2027-01-25');

  const fis = offer.subjects.find((s) => s.code === '73210064');
  assert.equal(fis.displayName, 'Física 1');
  assert.deepEqual(fis.components.map((c) => c.displayLabel), ['Laboratorio', 'Magistral']);
  assert.equal(fis.components[0].groups.length, 2);

  const sem = offer.subjects.find((s) => s.code === '11310028');
  assert.deepEqual(sem.components[0].groups[0].dates, ['2027-01-29', '2027-02-12']);
});

test('parseOffer falla con un mensaje claro si no hay tabla', () => {
  assert.throws(() => parseOffer({ sheets: [{ name: 'x', rows: [['hola']] }] }), /tabla de oferta/);
});

test('detecta grupos nuevos, eliminados y con cambios', () => {
  const base = [HEADER, row({ code: 1, name: 'A', days: { 0: [7, 9] } }), row({ code: 2, name: 'B', days: { 1: [7, 9] } })];
  const next = [HEADER, row({ code: 1, name: 'A', days: { 0: [9, 11] } }), row({ code: 3, name: 'C', days: { 1: [7, 9] } })];
  const d = diffSignatures(offerSignature(parseOffer(wb(base))), offerSignature(parseOffer(wb(next))));
  assert.deepEqual(d.added.map((g) => g.name), ['C']);
  assert.deepEqual(d.removed.map((g) => g.name), ['B']);
  assert.deepEqual(d.changed.map((g) => g.name), ['A']);
});
