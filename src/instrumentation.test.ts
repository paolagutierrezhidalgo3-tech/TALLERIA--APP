import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Comprobación a nivel de fuente (mismo enfoque que error-pages.test.ts):
// fija que Sentry solo hace monitorización de errores, sin Session Replay
// ni trazas de rendimiento, en ambos ficheros de instrumentación.
describe('instrumentación de Sentry: solo errores, sin replay ni trazas', () => {
  it('instrumentation-client.ts inicializa Sentry sin tracing ni replay', () => {
    const source = readFileSync('src/instrumentation-client.ts', 'utf8');
    expect(source).toMatch(/Sentry\.init\(/);
    expect(source).toMatch(/tracesSampleRate:\s*0/);
    expect(source).not.toMatch(/replayIntegration|[Rr]eplaysSessionSampleRate|[Rr]eplaysOnErrorSampleRate/);
  });
  it('instrumentation.ts inicializa Sentry en el servidor y reporta errores de request', () => {
    const source = readFileSync('src/instrumentation.ts', 'utf8');
    expect(source).toMatch(/export function register/);
    expect(source).toMatch(/Sentry\.init\(/);
    expect(source).toMatch(/tracesSampleRate:\s*0/);
    expect(source).toMatch(/export const onRequestError = Sentry\.captureRequestError/);
    expect(source).not.toMatch(/replayIntegration|[Rr]eplaysSessionSampleRate|[Rr]eplaysOnErrorSampleRate/);
  });
});
