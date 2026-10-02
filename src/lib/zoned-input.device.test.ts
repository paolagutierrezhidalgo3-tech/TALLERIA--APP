import { describe, expect, it } from 'vitest';
import { createDemo } from './demo';
import { instantToZonedInput, localDateParts, zonedInputToInstant, zonedTimeToUtc } from './domain';

// Runs ONLY inside a child process started by zoned-input.test.ts with TZ set
// before Node starts (vitest's worker threads ignore runtime TZ changes), once
// per simulated device timezone. Skipped in a normal test run.
const DEVICE = process.env.TALLERIA_DEVICE_TZ;
const ZONES = ['Europe/Madrid', 'Atlantic/Canary', 'America/Mexico_City', 'America/Bogota', 'America/Argentina/Buenos_Aires'];

describe.runIf(!!DEVICE)('editor de citas con el dispositivo en otra zona (proceso hijo)', () => {
  it('el proceso está de verdad en la zona pedida', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(DEVICE);
  });
  it('la conversión y la ida y vuelta no dependen de la zona del dispositivo', () => {
    const instant = '2026-07-15T08:00:00.000Z';
    // Control: the old device-local formula, which DOES depend on the device.
    const d = new Date(instant);
    const old = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    console.log(`\nDEVICE_RESULT ${DEVICE} OLD=${old} NEW=${instantToZonedInput(instant, 'Europe/Madrid')}`);
    const expected: Record<string, [string, string]> = {
      'Europe/Madrid': ['2026-01-15T09:00:00.000Z', '2026-07-15T08:00:00.000Z'],
      'Atlantic/Canary': ['2026-01-15T10:00:00.000Z', '2026-07-15T09:00:00.000Z'],
      'America/Mexico_City': ['2026-01-15T16:00:00.000Z', '2026-07-15T16:00:00.000Z'],
      'America/Bogota': ['2026-01-15T15:00:00.000Z', '2026-07-15T15:00:00.000Z'],
      'America/Argentina/Buenos_Aires': ['2026-01-15T13:00:00.000Z', '2026-07-15T13:00:00.000Z'],
    };
    for (const tz of ZONES) {
      expect(zonedInputToInstant('2026-01-15T10:00', tz)).toEqual({ ok: true, iso: expected[tz][0], ambiguous: false });
      expect(zonedInputToInstant('2026-07-15T10:00', tz)).toEqual({ ok: true, iso: expected[tz][1], ambiguous: false });
      for (let month = 0; month < 12; month++) {
        const iso = new Date(Date.UTC(2026, month, 10, 7, 45)).toISOString();
        expect(zonedInputToInstant(instantToZonedInput(iso, tz), tz)).toMatchObject({ ok: true, iso });
      }
      const slot = new Date(zonedTimeToUtc('2026-07-15', '10:00', tz)).toISOString();
      expect(instantToZonedInput(slot, tz)).toBe('2026-07-15T10:00');
    }
    expect(zonedInputToInstant('2026-03-29T02:30', 'Europe/Madrid')).toEqual({ ok: false, reason: 'nonexistent' });
    expect(zonedInputToInstant('2026-10-25T02:30', 'Europe/Madrid')).toEqual({ ok: true, iso: '2026-10-25T01:30:00.000Z', ambiguous: true });
  });
  it('la cita de ejemplo de la demo queda mañana a las 10:00 en la hora del taller', () => {
    const demo = createDemo();
    const value = instantToZonedInput(demo.appointments[0].starts_at, demo.workshop.timezone);
    // Tomorrow in the workshop's own calendar, whatever the device's date is.
    const [y, m, d] = localDateParts(new Date(), demo.workshop.timezone).date.split('-').map(Number);
    const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    expect(value).toBe(`${tomorrow}T10:00`);
    console.log(`\nDEMO_RESULT ${DEVICE} ${value.slice(11)}`);
  });
});
