import { describe, expect, it } from 'vitest';
import { zonedTimeToUtc } from './domain';
import { addDaysISO, calendarQueryFor, endRowExclusive, rangeDatesForMode, rowContaining } from './calendar-layout';

describe('Calendario: aritmética de fechas', () => {
  it('addDaysISO suma/resta días de calendario sin pasar por una zona horaria', () => {
    expect(addDaysISO('2030-01-31', 1)).toBe('2030-02-01');
    expect(addDaysISO('2030-03-01', -1)).toBe('2030-02-28');
    expect(addDaysISO('2030-12-31', 1)).toBe('2031-01-01');
  });
  it('rangeDatesForMode: día es [fecha, fecha+1); semana empieza en lunes', () => {
    expect(rangeDatesForMode('2030-01-02', 'day')).toEqual({ startISO: '2030-01-02', endISO: '2030-01-03' });
    // 2030-01-02 is a Wednesday; its week runs Monday 2029-12-31 to Sunday 2030-01-06 (exclusive end).
    expect(rangeDatesForMode('2030-01-02', 'week')).toEqual({ startISO: '2029-12-31', endISO: '2030-01-07' });
    // A Sunday belongs to the week that already started the Monday before it, not the next one.
    expect(rangeDatesForMode('2030-01-06', 'week')).toEqual({ startISO: '2029-12-31', endISO: '2030-01-07' });
  });
  it('calendarQueryFor produce un rango de instantes reales coherente con zonedTimeToUtc', () => {
    const q = calendarQueryFor('2030-01-02', 'day', 'Europe/Madrid');
    expect(q).toMatchObject({ view: 'calendar', offset: 0, search: '', status: 'all' });
    expect(new Date(q.range_start!).getTime()).toBe(zonedTimeToUtc('2030-01-02', '00:00', 'Europe/Madrid'));
    expect(new Date(q.range_end!).getTime()).toBe(zonedTimeToUtc('2030-01-03', '00:00', 'Europe/Madrid'));
  });
});
describe('Calendario: posicionamiento por filas (rowContaining/endRowExclusive)', () => {
  // A 30-minute grid from 00:00 to 04:00 local (Europe/Madrid), built the
  // same way DayGrid builds it: one real instant per row boundary, resolved
  // through zonedTimeToUtc -- never through wall-clock minute arithmetic.
  function madridBoundaries(dateISO: string, hours = 4) {
    return Array.from({ length: hours * 2 + 1 }, (_, i) => zonedTimeToUtc(dateISO, String(Math.floor(i / 2)).padStart(2, '0') + ':' + (i % 2 ? '30' : '00'), 'Europe/Madrid'));
  }
  it('una cita que no cruza ningún cambio de hora ocupa las filas de su duración real (caso común, horario de un taller real)', () => {
    // Ningún cambio de hora real ocurre entre la 1 y las 4 de la madrugada
    // salvo esas dos noches al año, y ningún taller abre a esas horas -- el
    // caso que sí importa en la práctica es que, un día normal, la duración
    // real decida el número de filas.
    const boundaries = madridBoundaries('2030-01-02');
    const start = zonedTimeToUtc('2030-01-02', '01:00', 'Europe/Madrid');
    const end = start + 90 * 60000; // 90 minutes -> 3 rows of 30 minutes
    const startRow = rowContaining(start, boundaries);
    const span = endRowExclusive(end, boundaries) - startRow;
    expect(startRow).toBe(2);
    expect(span).toBe(3);
  });
  it('una cita que cruza el cambio de hora (adelanto) nunca se oculta ni se sale de la cuadrícula, aunque ese caso límite no ocurre en horario real de taller', () => {
    // 2030-03-31: Europe/Madrid adelanta el reloj a la 01:00Z (02:00->03:00
    // local). Una cita de 01:30 a 60 minutos termina realmente a las 03:30
    // local. Las etiquetas nominales entre 02:00 y 03:00 no existen esa
    // noche, así que no hay una única fila "correcta" para ellas (ver el
    // comentario de rowContaining/endRowExclusive) -- lo que sí debe
    // garantizarse siempre es que la cita quede dentro de la cuadrícula y
    // con una duración de al menos una fila, nunca oculta ni fuera de rango.
    const boundaries = madridBoundaries('2030-03-31');
    const start = zonedTimeToUtc('2030-03-31', '01:30', 'Europe/Madrid');
    const end = start + 60 * 60000;
    const startRow = rowContaining(start, boundaries);
    const span = endRowExclusive(end, boundaries) - startRow;
    expect(startRow).toBeGreaterThanOrEqual(0);
    expect(startRow).toBeLessThan(boundaries.length - 1);
    expect(span).toBeGreaterThanOrEqual(1);
    expect(startRow + span).toBeLessThanOrEqual(boundaries.length - 1);
  });
  it('una cita que empieza antes de la ventana visible se recorta a la primera fila en vez de desaparecer', () => {
    const boundaries = madridBoundaries('2030-01-02');
    const start = zonedTimeToUtc('2030-01-01', '23:00', 'Europe/Madrid'); // the previous day
    const end = zonedTimeToUtc('2030-01-02', '01:00', 'Europe/Madrid');
    expect(rowContaining(start, boundaries)).toBe(0);
    expect(endRowExclusive(end, boundaries)).toBe(2); // ends at 01:00 -> row 2 boundary
  });
  it('una cita que termina después de la ventana visible se recorta a la última fila en vez de desaparecer', () => {
    const boundaries = madridBoundaries('2030-01-02'); // covers 00:00..04:00
    const start = zonedTimeToUtc('2030-01-02', '03:30', 'Europe/Madrid');
    const end = zonedTimeToUtc('2030-01-03', '06:00', 'Europe/Madrid'); // far beyond the grid
    expect(rowContaining(start, boundaries)).toBe(7); // last row (00:00..04:00 in 30min steps -> rows 0..7)
    expect(endRowExclusive(end, boundaries)).toBe(8); // clamped to the grid's own end, not hidden
  });
  it('dos citas consecutivas de 15 minutos dentro de la misma fila de 30 minutos no se confunden con una sola', () => {
    const boundaries = madridBoundaries('2030-01-02');
    const firstStart = zonedTimeToUtc('2030-01-02', '01:00', 'Europe/Madrid');
    const firstEnd = firstStart + 15 * 60000;
    const secondStart = firstEnd;
    const secondEnd = secondStart + 15 * 60000;
    const firstRow = rowContaining(firstStart, boundaries);
    const secondRow = rowContaining(secondStart, boundaries);
    // Both fall in the same 30-minute row (the grid's resolution is coarser
    // than a 15-minute cita) -- DayGrid's clustering (not this function) is
    // what must keep both visible, since a shared row is expected here.
    expect(firstRow).toBe(secondRow);
    expect(endRowExclusive(firstEnd, boundaries)).toBe(firstRow + 1);
    expect(endRowExclusive(secondEnd, boundaries)).toBe(firstRow + 1);
  });
});
