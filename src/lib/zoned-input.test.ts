import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { appointmentTimeHint, instantToZonedInput, zonedInputToInstant, zonedTimeToUtc } from './domain';

// The appointment editor works in the WORKSHOP's timezone (like the
// calendar), never the device's. Vitest's worker threads ignore runtime TZ
// changes, so device independence is proven in separate processes below.
const ZONES = ['Europe/Madrid', 'Atlantic/Canary', 'America/Mexico_City', 'America/Bogota', 'America/Argentina/Buenos_Aires'];
const DEVICES = ['Europe/Madrid', 'Atlantic/Canary', 'America/Mexico_City', 'Asia/Tokyo', 'UTC'];
const ok = (value: string, tz: string) => { const r = zonedInputToInstant(value, tz); if (!r.ok) throw new Error(`${value} @ ${tz}: ${r.reason}`); return r; };

describe('hora del taller en el editor de citas', () => {
  it('convierte la hora del taller al instante correcto en todas las zonas del selector, en invierno y en verano', () => {
    const expected: Record<string, [string, string]> = {
      'Europe/Madrid': ['2026-01-15T09:00:00.000Z', '2026-07-15T08:00:00.000Z'],
      'Atlantic/Canary': ['2026-01-15T10:00:00.000Z', '2026-07-15T09:00:00.000Z'],
      'America/Mexico_City': ['2026-01-15T16:00:00.000Z', '2026-07-15T16:00:00.000Z'],
      'America/Bogota': ['2026-01-15T15:00:00.000Z', '2026-07-15T15:00:00.000Z'],
      'America/Argentina/Buenos_Aires': ['2026-01-15T13:00:00.000Z', '2026-07-15T13:00:00.000Z'],
    };
    for (const tz of ZONES) {
      expect(ok('2026-01-15T10:00', tz).iso).toBe(expected[tz][0]);
      expect(ok('2026-07-15T10:00', tz).iso).toBe(expected[tz][1]);
      expect(instantToZonedInput(expected[tz][0], tz)).toBe('2026-01-15T10:00');
      expect(instantToZonedInput(expected[tz][1], tz)).toBe('2026-07-15T10:00');
    }
  });
  it('ida y vuelta exacta a lo largo del año', () => {
    for (const tz of ZONES) {
      for (let month = 0; month < 12; month++) {
        const iso = new Date(Date.UTC(2026, month, 10, 7, 45)).toISOString();
        expect(ok(instantToZonedInput(iso, tz), tz).iso).toBe(iso);
      }
    }
  });
  it('muestra en el editor la misma hora que el hueco del calendario en el que se hizo clic', () => {
    for (const tz of ZONES) {
      const slot = new Date(zonedTimeToUtc('2026-07-15', '10:00', tz)).toISOString();
      expect(instantToZonedInput(slot, tz)).toBe('2026-07-15T10:00');
      expect(ok('2026-07-15T10:00', tz).iso).toBe(slot);
    }
  });
  it('detecta la hora que no existe al adelantar el reloj, sin desplazarla en silencio', () => {
    expect(zonedInputToInstant('2026-03-29T02:30', 'Europe/Madrid')).toEqual({ ok: false, reason: 'nonexistent' });
    expect(zonedInputToInstant('2026-03-29T01:30', 'Atlantic/Canary')).toEqual({ ok: false, reason: 'nonexistent' });
    expect(ok('2026-03-29T03:30', 'Europe/Madrid')).toEqual({ ok: true, iso: '2026-03-29T01:30:00.000Z', ambiguous: false });
  });
  it('resuelve la hora repetida al retrasar el reloj igual que el servidor (la segunda vez) y lo señala', () => {
    expect(ok('2026-10-25T02:30', 'Europe/Madrid')).toEqual({ ok: true, iso: '2026-10-25T01:30:00.000Z', ambiguous: true });
    expect(ok('2026-10-25T01:30', 'Atlantic/Canary')).toEqual({ ok: true, iso: '2026-10-25T01:30:00.000Z', ambiguous: true });
    expect(new Date(zonedTimeToUtc('2026-10-25', '02:30', 'Europe/Madrid')).toISOString()).toBe('2026-10-25T01:30:00.000Z');
    expect(ok('2026-10-25T04:00', 'Europe/Madrid').ambiguous).toBe(false);
    expect(ok('2026-10-25T02:30', 'America/Bogota').ambiguous).toBe(false);
  });
  it('rechaza valores que no son una fecha y hora válidas, incluidos años de menos de cuatro cifras', () => {
    for (const value of ['', 'hola', '2026-02-30T10:00', '2026-01-01T24:00', '2026-01-01T10:60', '2026-01-01 10:00', '2026-01-01T10:00:30', '2026-13-01T10:00', '0099-06-01T10:00', '0100-06-01T10:00', '0999-06-01T10:00', '10000-06-01T10:00']) {
      expect(zonedInputToInstant(value, 'Europe/Madrid')).toEqual({ ok: false, reason: 'invalid' });
    }
    expect(ok('2026-01-01T10:00:00', 'Europe/Madrid').iso).toBe('2026-01-01T09:00:00.000Z');
    expect(ok('1000-06-01T10:00', 'UTC').iso).toBe('1000-06-01T10:00:00.000Z');
    expect(instantToZonedInput('no es una fecha', 'Europe/Madrid')).toBe('');
    expect(instantToZonedInput('0999-06-01T10:00:00.000Z', 'UTC')).toBe('');
    expect(instantToZonedInput('+010000-06-01T10:00:00.000Z', 'UTC')).toBe('');
  });
  it('el texto bajo el campo avisa de otra zona en el dispositivo y de los cambios de hora', () => {
    expect(appointmentTimeHint('2026-07-15T10:00', 'Europe/Madrid', 'Europe/Madrid')).toBeUndefined();
    expect(appointmentTimeHint('', 'Atlantic/Canary', 'Europe/Madrid')).toBe('Tu dispositivo está en Europe/Madrid; introduce la hora del taller.');
    expect(appointmentTimeHint('2026-10-25T02:30', 'Europe/Madrid', 'Europe/Madrid')).toBe('Esa hora se repite por el cambio de hora; se usará la segunda vez que ocurre.');
    expect(appointmentTimeHint('2026-10-25T02:30', 'Europe/Madrid', 'Europe/Madrid', true)).toBe('Esa hora se repite por el cambio de hora; se mantiene la de la cita.');
    expect(appointmentTimeHint('2026-03-29T02:30', 'Europe/Madrid', 'Europe/Madrid')).toBe('Esa hora no existe en la zona del taller por el cambio de hora.');
  });
  it('una cita en la PRIMERA hora repetida se muestra igual que la segunda: por eso el editor conserva el instante original si no se toca', () => {
    const first = '2026-10-25T00:30:00.000Z';
    expect(instantToZonedInput(first, 'Europe/Madrid')).toBe('2026-10-25T02:30');
    expect(ok('2026-10-25T02:30', 'Europe/Madrid').iso).not.toBe(first);
  });
});

describe('independencia de la zona del dispositivo (procesos hijo con TZ real)', () => {
  it('cada proceso está en su zona; la fórmula antigua cambia con ella y la nueva no', () => {
    const results = DEVICES.map(device => {
      const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--configLoader', 'native', 'src/lib/zoned-input.device.test.ts'],
        { env: { ...process.env, TZ: device, TALLERIA_DEVICE_TZ: device, NO_COLOR: '1', FORCE_COLOR: '0' }, encoding: 'utf8', timeout: 120000 });
      // Colour codes stripped so matching never depends on the reporter's styling.
      const output = ((run.stdout ?? '') + (run.stderr ?? '')).replace(/\u001b\[[0-9;]*m/g, '');
      // A spawn failure, timeout or signal must say so, not look like a wrong result.
      const failure = `device ${device}: status=${run.status} signal=${run.signal} error=${run.error?.message ?? 'none'}\n${output.slice(-2000)}`;
      expect(run.error, failure).toBeUndefined();
      expect(run.status, failure).toBe(0);
      expect(output, failure).toMatch(/Tests\s+3 passed/);
      const result = new RegExp(`DEVICE_RESULT ${device.replace('/', '\\/')} OLD=(\\S+) NEW=(\\S+)`).exec(output);
      const demo = new RegExp(`DEMO_RESULT ${device.replace('/', '\\/')} (\\S+)`).exec(output);
      expect(result, output.slice(-2000)).not.toBeNull();
      return { old: result![1], fresh: result![2], demo: demo?.[1] };
    });
    // Control: the old device-local formula really gave different hours.
    expect(new Set(results.map(r => r.old)).size).toBeGreaterThan(1);
    expect(results.map(r => r.fresh)).toEqual(Array(DEVICES.length).fill('2026-07-15T10:00'));
    expect(results.map(r => r.demo)).toEqual(Array(DEVICES.length).fill('10:00'));
  }, 600000);
});

// Same constraint as error-pages.test.ts: no React render harness here, so
// the editor's wiring is pinned at the source level (whitespace collapsed).
describe('editor de citas: usa siempre la hora del taller', () => {
  const source = readFileSync('src/components/editors.tsx', 'utf8').replace(/\s+/g, ' ');
  it('rellena y guarda con la zona del taller, sin la zona del dispositivo', () => {
    expect(source).toContain('const originalInput = initial ? instantToZonedInput(initial.starts_at, timeZone) : ');
    expect(source).toContain('instantToZonedInput(initialStartsAt, timeZone)');
    expect(source).toContain('zonedInputToInstant(value, timeZone)');
    expect(source).toContain('starts_at: parsed.iso');
    expect(source).not.toContain('getTimezoneOffset');
    expect(source).not.toContain('localInput');
    expect(source).not.toMatch(/new Date\(String\(new FormData/);
  });
  it('conserva el instante original de una cita si el campo no se ha tocado', () => {
    expect(source).toContain('const parsed = initial && value === originalInput ? { ok: true as const, iso: initial.starts_at, ambiguous: false } : zonedInputToInstant(value, timeZone);');
    expect(source).toContain('const keepsOriginal = !!initial && starts === originalInput;');
  });
  it('etiqueta el campo con la zona del taller y calcula el aviso solo cuando cambian la hora o la zona', () => {
    expect(source).toContain("label={'Fecha y hora (hora del taller: ' + timeZone + ')'}");
    expect(source).toContain('const startsHint = useMemo(() => appointmentTimeHint(starts, timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone, keepsOriginal), [starts, timeZone, keepsOriginal]);');
    expect(source).toContain('hint={startsHint}');
    expect(source).toContain("'Esa hora no existe en la zona del taller por el cambio de hora; elige otra.'");
  });
});

describe('demo: la cita de ejemplo en la hora del taller', () => {
  it('ya no se calcula con la hora del dispositivo', () => {
    const source = readFileSync('src/lib/demo.ts', 'utf8').replace(/\s+/g, ' ');
    expect(source).not.toContain('setHours(');
    expect(source).toContain("zonedTimeToUtc(tomorrow, '10:00', state.workshop.timezone)");
  });
});
