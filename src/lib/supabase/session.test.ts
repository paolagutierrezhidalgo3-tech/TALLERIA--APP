import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveSession, type SessionDeps } from './session';

function deps(overrides: Partial<SessionDeps>): SessionDeps {
  return {
    getUser: async () => ({ user: { id: 'u1' }, error: null }),
    getMembership: async () => ({ data: null, error: null }),
    getPendingInvitation: async () => null,
    ...overrides,
  };
}

describe('resolveSession', () => {
  it('va a auth cuando no hay usuario o falla la autenticación', async () => {
    expect(await resolveSession(deps({ getUser: async () => ({ user: null, error: null }) }))).toEqual({ screen: 'auth' });
    expect(await resolveSession(deps({ getUser: async () => ({ user: null, error: new Error('nope') }) }))).toEqual({ screen: 'auth' });
  });
  it('va a app con el workshop_id cuando el usuario ya pertenece a un taller', async () => {
    const resolution = await resolveSession(deps({ getMembership: async () => ({ data: { workshop_id: 'w1' }, error: null }) }));
    expect(resolution).toEqual({ screen: 'app', workshopId: 'w1' });
  });
  it('reporta error y va a auth si falla la consulta de membresía, sin caer en onboarding', async () => {
    const resolution = await resolveSession(deps({ getMembership: async () => ({ data: null, error: new Error('db caída') }) }));
    expect(resolution).toEqual({ screen: 'auth', error: 'db caída' });
  });
  it('va a invitation cuando hay una invitación pendiente', async () => {
    const pending = { id: 'i1', workshop_id: 'w1', workshop_name: 'Taller', invited_by_email: 'a@b.com' };
    const resolution = await resolveSession(deps({ getPendingInvitation: async () => pending }));
    expect(resolution).toEqual({ screen: 'invitation', pending });
  });
  it('va a onboarding solo cuando la consulta de invitación se resuelve y no encuentra ninguna', async () => {
    const resolution = await resolveSession(deps({ getPendingInvitation: async () => null }));
    expect(resolution).toEqual({ screen: 'onboarding' });
  });
  it('un fallo al consultar la invitación pendiente no debe interpretarse como ausencia de invitación ni permitir onboarding', async () => {
    const resolution = await resolveSession(deps({ getPendingInvitation: async () => { throw new Error('RPC caída'); } }));
    expect(resolution).toEqual({ screen: 'auth', error: 'RPC caída' });
    expect(resolution.screen).not.toBe('onboarding');
  });
  it('un fallo al construir el cliente de Supabase (p.ej. falta configuración) nunca deja la app colgada en loading', async () => {
    // getSupabase() throws synchronously when NEXT_PUBLIC_SUPABASE_URL/KEY are
    // missing or invalid; workspace.tsx calls it lazily inside getUser/
    // getMembership so that throw lands here, inside resolveSession's own
    // try/catch, instead of escaping as an unhandled rejection that leaves
    // the component stuck on the initial 'loading' screen forever.
    const configError = 'Falta configurar la URL y la clave pública de Supabase. Consulta el README.';
    const viaGetUser = await resolveSession(deps({ getUser: async () => { throw new Error(configError); } }));
    expect(viaGetUser).toEqual({ screen: 'auth', error: configError });
    const viaGetMembership = await resolveSession(deps({ getMembership: async () => { throw new Error(configError); } }));
    expect(viaGetMembership).toEqual({ screen: 'auth', error: configError });
  });
  it('workspace.tsx no debe llamar a getSupabase() fuera de resolveSession dentro de session()', () => {
    // There is no React component test harness in this project (no jsdom /
    // testing-library, vitest runs in 'node'), so this pins the fix at the
    // source level: workspace.tsx's session() must call getSupabase() only
    // inside the deps closures it hands to resolveSession, never before —
    // a call before that point runs outside resolveSession's try/catch and,
    // since session() is invoked as `void session()`, an unhandled rejection
    // there leaves the screen stuck on 'loading' forever instead of showing
    // the configuration error.
    const source = readFileSync('src/components/workspace.tsx', 'utf8');
    const start = source.indexOf('async function session() {');
    const resolveCallIndex = source.indexOf('resolveSession({', start);
    expect(start).toBeGreaterThan(-1);
    expect(resolveCallIndex).toBeGreaterThan(start);
    const codeBeforeResolveSession = source.slice(start, resolveCallIndex)
      .split('\n').map(line => line.replace(/\/\/.*/, '')).join('\n');
    expect(codeBeforeResolveSession).not.toMatch(/getSupabase\(\)/);
  });
});
