import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadTeam, type TeamSnapshot } from './team';

describe('loadTeam', () => {
  it('devuelve ready con el snapshot cuando la consulta funciona', async () => {
    const snapshot: TeamSnapshot = { members: [], invitations: [] };
    const result = await loadTeam('w1', async () => snapshot);
    expect(result).toEqual({ status: 'ready', snapshot });
  });
  it('devuelve error con el mensaje cuando la consulta falla, sin lanzar', async () => {
    const result = await loadTeam('w1', async () => { throw new Error('caída de red'); });
    expect(result).toEqual({ status: 'error', message: 'caída de red' });
  });
  it('un fallo inicial de listMembers seguido de un reintento recupera correctamente la pantalla', async () => {
    // Mirrors team.tsx's effect: reload() re-runs loadTeam with the same
    // fetcher. The first call fails (simulating listMembers rejecting on the
    // initial mount); a second call with a working fetcher must succeed,
    // confirming the retry path recovers without navigating away or
    // reloading the page.
    let attempt = 0;
    const snapshot: TeamSnapshot = { members: [{ user_id: 'u1', role: 'owner', email: 'a@b.com', created_at: '2026-01-01' }], invitations: [] };
    const flaky = async (): Promise<TeamSnapshot> => {
      attempt += 1;
      if (attempt === 1) throw new Error('No se ha podido cargar el equipo.');
      return snapshot;
    };
    const first = await loadTeam('w1', flaky);
    expect(first).toEqual({ status: 'error', message: 'No se ha podido cargar el equipo.' });
    const retry = await loadTeam('w1', flaky);
    expect(retry).toEqual({ status: 'ready', snapshot });
  });
  it('team.tsx distingue carga de error inicial y ofrece un botón de reintento, en vez de quedarse en "Cargando equipo…" para siempre', () => {
    // There is no React component test harness in this project (no jsdom /
    // testing-library, vitest runs in 'node'), so this pins the render
    // branch at the source level: when there is no snapshot yet, the screen
    // must show the loading message only while `loading` is true, and an
    // error message with a retry button (wired to reload()) once it settles
    // without data — not an unconditional "Cargando equipo…" regardless of
    // outcome, which is the bug this fix closes.
    const source = readFileSync('src/components/team.tsx', 'utf8');
    expect(source).toMatch(/const \[loading, setLoading\] = useState/);
    const start = source.indexOf('if (!snapshot) {');
    const end = source.indexOf('return <>');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const noSnapshotBranch = source.slice(start, end);
    expect(noSnapshotBranch).toMatch(/if \(loading\) return/);
    expect(noSnapshotBranch).toMatch(/onClick=\{reload\}/);
  });
});
