import { describe, expect, it, vi } from 'vitest';
import { withTimeout } from './with-timeout';

describe('withTimeout', () => {
  it('resuelve con el valor real cuando la promesa termina antes del plazo', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });
  it('rechaza cuando la promesa nunca se resuelve, en vez de esperar para siempre', async () => {
    vi.useFakeTimers();
    const hung = new Promise(() => {}); // never settles, simulating a stuck network request
    const race = withTimeout(hung, 1000);
    const assertion = expect(race).rejects.toThrow('timeout');
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    vi.useRealTimers();
  });
  it('propaga el rechazo original si la propia promesa falla antes del plazo', async () => {
    await expect(withTimeout(Promise.reject(new Error('red caída')), 1000)).rejects.toThrow('red caída');
  });
});
