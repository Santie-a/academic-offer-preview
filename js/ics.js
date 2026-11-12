// Exporta el horario como archivo de calendario (.ics) para Google Calendar,
// Outlook o el calendario del celular. Usa hora local "flotante" (sin zona).

function pad(n) {
  return String(n).padStart(2, '0');
}

function toDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function isoOf(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function stamp(iso, minutes) {
  return `${iso.replace(/-/g, '')}T${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}00`;
}

function escapeText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function fold(line) {
  // Líneas de máximo 75 octetos (aprox. por caracteres).
  const out = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ' ' + rest.slice(74);
  }
  out.push(rest);
  return out.join('\r\n');
}

/** Primer día >= start que cae en el día de la semana pedido (0 = lunes). */
function firstWeekday(startIso, day) {
  const d = toDate(startIso);
  const current = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() + ((day - current + 7) % 7));
  return isoOf(d);
}

function defaultRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7 * 16);
  return [isoOf(start), isoOf(end)];
}

/**
 * @param {{title: string, group: any, location?: string, description?: string}[]} entries
 */
export function buildIcs(entries, calendarName = 'Mi horario') {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Planificador de horario//ES',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];
  const now = new Date();
  const dtstamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}00Z`;
  let n = 0;

  for (const e of entries) {
    const g = e.group;
    const [defStart, defEnd] = defaultRange();
    const startIso = g.startDate || defStart;
    const endIso = g.endDate || defEnd;

    for (const s of g.sessions) {
      const base = [
        `DTSTAMP:${dtstamp}`,
        `SUMMARY:${escapeText(e.title)}`,
        e.location ? `LOCATION:${escapeText(e.location)}` : null,
        e.description ? `DESCRIPTION:${escapeText(e.description)}` : null,
      ].filter(Boolean);

      if (g.dates && g.dates.length) {
        for (const d of g.dates) {
          lines.push('BEGIN:VEVENT', `UID:horario-${Date.now()}-${n++}@local`, `DTSTART:${stamp(d, s.start)}`, `DTEND:${stamp(d, s.end)}`, ...base, 'END:VEVENT');
        }
      } else {
        const first = firstWeekday(startIso, s.day);
        if (first > endIso) continue;
        lines.push(
          'BEGIN:VEVENT',
          `UID:horario-${Date.now()}-${n++}@local`,
          `DTSTART:${stamp(first, s.start)}`,
          `DTEND:${stamp(first, s.end)}`,
          `RRULE:FREQ=WEEKLY;UNTIL=${endIso.replace(/-/g, '')}T235959`,
          ...base,
          'END:VEVENT',
        );
      }
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
