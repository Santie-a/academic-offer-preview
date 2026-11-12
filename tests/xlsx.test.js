import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWorkbook, colIndex, decodeXml } from '../js/xlsx.js';
import { makeXlsx, t } from './helpers.js';

test('colIndex convierte letras de columna', () => {
  assert.equal(colIndex('A1'), 0);
  assert.equal(colIndex('Z9'), 25);
  assert.equal(colIndex('AA3'), 26);
  assert.equal(colIndex('AZ1'), 51);
});

test('decodeXml resuelve entidades y escapes de Excel', () => {
  assert.equal(decodeXml('A &amp; B &lt;x&gt; &#233;'), 'A & B <x> é');
  assert.equal(decodeXml('línea_x000D_'), 'línea\r');
});

test('lee cadenas compartidas, números y huecos', async () => {
  const buf = makeXlsx([
    ['NOMBRE', null, 'HORA'],
    ['Cálculo & Física', 3, t(7, 30)],
  ]);
  const wb = await readWorkbook(buf);
  assert.equal(wb.sheets.length, 1);
  const rows = wb.sheets[0].rows;
  assert.equal(rows[0][0], 'NOMBRE');
  assert.equal(rows[0][1], undefined);
  assert.equal(rows[1][0], 'Cálculo & Física');
  assert.equal(rows[1][1], 3);
  assert.ok(Math.abs(rows[1][2] - t(7, 30)) < 1e-9);
});

test('rellena celdas combinadas', async () => {
  const buf = makeXlsx([['A'], ['x'], [null]], { merges: ['A2:A3'] });
  const wb = await readWorkbook(buf);
  assert.equal(wb.sheets[0].rows[2][0], 'x');
});

test('rechaza archivos que no son .xlsx', async () => {
  await assert.rejects(() => readWorkbook(new TextEncoder().encode('hola, esto es un csv')), /xlsx/);
});
