import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isPastDay, isPastSlot, suggestedStart } from './calendar-layout';
import { applyCommand, localDateParts, zonedTimeToUtc, type State } from './domain';

const at = (iso: string) => new Date(iso).getTime();

describe('calendario: días y huecos pasados en la hora del taller', () => {
  it('un día anterior al de hoy del taller es pasado; hoy y los siguientes no', () => {
    expect(isPastDay('2026-10-01', '2026-10-02')).toBe(true);
    expect(isPastDay('2026-10-02', '2026-10-02')).toBe(false);
    expect(isPastDay('2026-10-03', '2026-10-02')).toBe(false);
    expect(isPastDay('2025-12-31', '2026-01-01')).toBe(true);
  });
  it('hoy, solo los huecos cuyo inicio ya llegó (como el servidor, que rechaza inicio <= ahora)', () => {
    const now = at('2026-10-02T08:10:00Z'); // 10:10 en Madrid
    const slot = (time: string) => zonedTimeToUtc('2026-10-02', time, 'Europe/Madrid');
    expect(isPastSlot('2026-10-02', slot('09:30'), '2026-10-02', now)).toBe(true);
    expect(isPastSlot('2026-10-02', slot('10:00'), '2026-10-02', now)).toBe(true);
    expect(isPastSlot('2026-10-02', slot('10:30'), '2026-10-02', now)).toBe(false);
    expect(isPastSlot('2026-10-02', at('2026-10-02T08:10:00Z'), '2026-10-02', now)).toBe(true);
    expect(isPastSlot('2026-10-03', slot('08:00') + 86400000, '2026-10-02', now)).toBe(false);
    expect(isPastSlot('2026-10-01', at('2030-01-01T00:00:00Z'), '2026-10-02', now)).toBe(true);
  });
  it('"hoy" es el del taller, no el UTC ni el del dispositivo', () => {
    const now = new Date('2026-10-02T22:30:00Z'); // ya es 3 de octubre en Madrid, aún 2 en Canarias
    expect(localDateParts(now, 'Europe/Madrid').date).toBe('2026-10-03');
    expect(localDateParts(now, 'Atlantic/Canary').date).toBe('2026-10-02');
    expect(isPastDay('2026-10-02', localDateParts(now, 'Europe/Madrid').date)).toBe(true);
    expect(isPastDay('2026-10-02', localDateParts(now, 'Atlantic/Canary').date)).toBe(false);
  });
  it('el día del cambio de hora compara instantes reales', () => {
    const now = at('2026-10-25T01:45:00Z'); // 02:45 de la segunda vez (CET) en Madrid
    const firstHalfPast2 = at('2026-10-25T00:30:00Z'); // 02:30 CEST
    const secondHalfPast2 = zonedTimeToUtc('2026-10-25', '02:30', 'Europe/Madrid'); // 02:30 CET = 01:30Z
    const three = zonedTimeToUtc('2026-10-25', '03:00', 'Europe/Madrid'); // 02:00Z
    expect(isPastSlot('2026-10-25', firstHalfPast2, '2026-10-25', now)).toBe(true);
    expect(isPastSlot('2026-10-25', secondHalfPast2, '2026-10-25', now)).toBe(true);
    expect(isPastSlot('2026-10-25', three, '2026-10-25', now)).toBe(false);
  });
});

describe('excepciones de horario con fecha pasada', () => {
  const base = (): State => ({ workshop: { version: 1, hours_version: 1, id: 'w1', name: 'Taller', phone: '', address: '', hours: '', timezone: 'Europe/Madrid', appointment_minutes: 60 }, customers: [], vehicles: [], conversations: [], requests: [], appointments: [], resources: [], audit: [], hours: [], hour_exceptions: [], role: 'owner' });
  const exception = (date: string) => ({ type: 'workshop_hour_exception' as const, exception: { id: crypto.randomUUID(), workshop_id: 'w1', exception_date: date, closed: true, opens_at: null, closes_at: null } });
  const now = new Date('2026-10-02T22:30:00Z'); // 3 de octubre en Madrid
  it('la demo rechaza una fecha anterior al hoy del taller y acepta hoy y después', () => {
    expect(() => applyCommand(base(), exception('2026-10-02'), now)).toThrow('hoy o posterior');
    expect(applyCommand(base(), exception('2026-10-03'), now).hour_exceptions).toHaveLength(1);
    expect(applyCommand(base(), exception('2026-12-25'), now).hour_exceptions).toHaveLength(1);
  });
});

// Same constraint as error-pages.test.ts: no React render harness here, so
// the components' wiring is pinned at the source level (whitespace collapsed).
describe('calendario y Horarios: cableado', () => {
  const calendar = readFileSync('src/components/calendar.tsx', 'utf8').replace(/\s+/g, ' ');
  const hours = readFileSync('src/components/hours.tsx', 'utf8').replace(/\s+/g, ' ');
  it('la vista día muestra los huecos pasados neutros y desactivados, y no afirma el horario de un día pasado', () => {
    expect(calendar).toContain('const ranges = pastDay ? null : businessHoursForDate(state, dateISO);');
    expect(calendar).toContain("if (pastDay && !appointments.length) return <Empty title=\"Día pasado\">");
    expect(calendar).toContain("if (isPastSlot(dateISO, boundaries[row], todayISO, now)) return <button key={col.id + '-s-' + row} type=\"button\" disabled className=\"day-grid-slot past\" aria-label={'Pasado, ' + label}");
  });
  it('la hora actual sale de un estado que se refresca cada minuto, no de leerla durante el render', () => {
    expect(calendar).toContain('const [now, setNow] = useState(() => Date.now());');
    expect(calendar).toContain('const id = setInterval(() => setNow(Date.now()), intervalMs);');
    expect(calendar).toContain('return [now, () => setNow(Date.now())] as const;');
    expect(calendar).toContain('const [now, refreshNow] = useNow();');
    expect(calendar.split('const [now, refreshNow] = useNow();')).toHaveLength(3);
    expect(calendar).toContain('const todayISO = localDateParts(new Date(now), tz).date;');
  });
  it('la vista semana no marca como cerrado un día pasado ni ofrece «Nueva cita» en él', () => {
    expect(calendar).toContain('const closed = !pastDay && ranges !== null && ranges.length === 0;');
    expect(calendar).toContain('{firstActiveResource && !closed && !pastDay && <button');
  });
  it('Horarios no admite fechas pasadas y avisa si se alcanza el tope de excepciones cargadas', () => {
    expect(hours).toContain('<input required type="date" min={todayISO}');
    expect(hours).toContain("if (exception.exception_date < localDateParts(new Date(), state.workshop.timezone).date) { setExceptionError('La fecha debe ser hoy o posterior.'); return; }");
    expect(hours).toContain('{exceptions.length >= LOADED_EXCEPTIONS_CAP && <p className="muted">Se muestran las próximas {LOADED_EXCEPTIONS_CAP} excepciones.</p>}');
  });
  it('el tope de la interfaz coincide con el de workspace_snapshot en la migración vigente', () => {
    expect(hours).toContain('export const LOADED_EXCEPTIONS_CAP = 100;');
    const sql = readFileSync('supabase/migrations/202609290014_entity_detail.sql', 'utf8');
    expect(sql).toMatch(/workshop_hour_exceptions where workshop_id=p_workshop_id and exception_date>=workshop_today order by exception_date limit 100\)/);
  });
  it('los huecos pasados tienen su propio estilo neutro', () => {
    expect(readFileSync('src/app/globals.css', 'utf8')).toContain('.day-grid-slot.past{background:#fafafc;cursor:default}');
  });
});

describe('ronda 1 de Codex: casos límite', () => {
  it('cambio de hora de primavera: la hora que se salta no existe, se comparan instantes reales', () => {
    // 29-03-2026 en Madrid: de 02:00 se pasa a 03:00 (01:00Z).
    const three = zonedTimeToUtc('2026-03-29', '03:00', 'Europe/Madrid');
    expect(new Date(three).toISOString()).toBe('2026-03-29T01:00:00.000Z');
    expect(isPastSlot('2026-03-29', three, '2026-03-29', at('2026-03-29T00:59:00Z'))).toBe(false);
    expect(isPastSlot('2026-03-29', three, '2026-03-29', at('2026-03-29T01:00:00Z'))).toBe(true);
    expect(isPastSlot('2026-03-29', zonedTimeToUtc('2026-03-29', '01:30', 'Europe/Madrid'), '2026-03-29', at('2026-03-29T00:59:00Z'))).toBe(true);
  });
  it('«Nueva cita» propone la apertura, o hoy la siguiente media hora que aún no ha pasado', () => {
    const tz = 'Europe/Madrid';
    const iso = (n: number | null) => n === null ? null : new Date(n).toISOString();
    const now = at('2026-10-02T13:00:00Z'); // 15:00 en Madrid
    expect(iso(suggestedStart('2026-10-05', 9 * 60, '2026-10-02', now, tz))).toBe('2026-10-05T07:00:00.000Z'); // otro día: 09:00
    expect(iso(suggestedStart('2026-10-02', 16 * 60, '2026-10-02', now, tz))).toBe('2026-10-02T14:00:00.000Z'); // hoy, apertura futura: 16:00
    expect(iso(suggestedStart('2026-10-02', 9 * 60, '2026-10-02', now, tz))).toBe('2026-10-02T13:30:00.000Z'); // hoy, apertura pasada: 15:30
    expect(iso(suggestedStart('2026-10-02', 9 * 60, '2026-10-02', at('2026-10-02T13:30:00Z'), tz))).toBe('2026-10-02T14:00:00.000Z'); // a las 15:30 en punto: 16:00
    expect(suggestedStart('2026-10-02', 9 * 60, '2026-10-02', at('2026-10-02T21:40:00Z'), tz)).toBeNull(); // 23:40: no queda media hora hoy
    // Primavera a las 01:50: las 02:00 no existen; propone las 03:00 reales.
    expect(iso(suggestedStart('2026-03-29', 0, '2026-03-29', at('2026-03-29T00:50:00Z'), tz))).toBe('2026-03-29T01:00:00.000Z');
  });
  it('el clic en un hueco y en «Nueva cita» se comprueba con la hora exacta del clic', () => {
    const calendar = readFileSync('src/components/calendar.tsx', 'utf8').replace(/\s+/g, ' ');
    expect(calendar).toContain("if (isPastSlot(dateISO, boundaries[row], localDateParts(new Date(), tz).date, Date.now())) refreshNow(); else onCreate(col.id, new Date(boundaries[row]).toISOString());");
    expect(calendar).toContain('const clickToday = localDateParts(new Date(), tz).date; if (isPastDay(dayISO, clickToday)) { refreshNow(); return; } const start = suggestedStart(dayISO, openMinutes, clickToday, Date.now(), tz); onCreate(firstActiveResource.id, start === null ? undefined : new Date(start).toISOString());');
    expect(calendar).toContain('onCreate: (resourceId: string, startsAtIso?: string) => void;');
  });
});

describe('ronda 2 de Codex: «Nueva cita» de un día que acaba de pasar a medianoche', () => {
  it('sin comprobarlo al clic se propondría una hora ya pasada; la comprobación lo detecta', () => {
    const tz = 'Europe/Madrid';
    const justAfterMidnight = at('2026-10-02T22:00:30Z'); // 00:00:30 del 3 de octubre en Madrid
    const clickToday = localDateParts(new Date(justAfterMidnight), tz).date;
    expect(clickToday).toBe('2026-10-03');
    // The button may still be showing for the 2nd (rendered before midnight):
    const proposed = suggestedStart('2026-10-02', 9 * 60, clickToday, justAfterMidnight, tz);
    expect(proposed).not.toBeNull();
    expect(proposed!).toBeLessThan(justAfterMidnight); // what the guard prevents
    expect(isPastDay('2026-10-02', clickToday)).toBe(true); // what the click-time check uses
  });
});
