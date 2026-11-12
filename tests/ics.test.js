import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs } from '../js/ics.js';

test('genera eventos semanales desde la fecha de inicio', () => {
  const ics = buildIcs([
    { title: 'Cálculo 2', group: { label: '1', startDate: '2027-01-25', endDate: '2027-05-29', dates: [], sessions: [{ day: 2, start: 780, end: 870 }] } },
  ]);
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /DTSTART:20270127T130000/); // primer miércoles
  assert.match(ics, /DTEND:20270127T143000/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;UNTIL=20270529T235959/);
});

test('fechas específicas generan un evento por fecha', () => {
  const ics = buildIcs([
    { title: 'Seminario', group: { label: '1', startDate: '2027-01-25', endDate: '2027-05-29', dates: ['2027-01-29', '2027-02-12'], sessions: [{ day: 4, start: 660, end: 780 }] } },
  ]);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.match(ics, /DTSTART:20270212T110000/);
  assert.doesNotMatch(ics, /RRULE/);
});
