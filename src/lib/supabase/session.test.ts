import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canSkipReload, isSameAppSession, resolveSession, type SessionDeps, type SessionResolution } from './session';

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
    expect(resolution).toEqual({ screen: 'app', userId: 'u1', workshopId: 'w1' });
  });
  it('reporta error y va a auth si falla la consulta de membresía, sin caer en onboarding', async () => {
    const resolution = await resolveSession(deps({ getMembership: async () => ({ data: null, error: new Error('db caída') }) }));
    expect(resolution).toEqual({ screen: 'auth', error: 'db caída' });
  });
  it('va a invitation cuando hay una invitación pendiente', async () => {
    const pending = { id: 'i1', workshop_id: 'w1', workshop_name: 'Taller', invited_by_email: 'a@b.com' };
    const resolution = await resolveSession(deps({ getPendingInvitation: async () => pending }));
    expect(resolution).toEqual({ screen: 'invitation', userId: 'u1', pending });
  });
  it('va a onboarding solo cuando la consulta de invitación se resuelve y no encuentra ninguna', async () => {
    const resolution = await resolveSession(deps({ getPendingInvitation: async () => null }));
    expect(resolution).toEqual({ screen: 'onboarding', userId: 'u1' });
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

describe('isSameAppSession: una renovación de token no recarga el panel', () => {
  const onScreen = { userId: 'u1', workshopId: 'w1' };
  const app = (userId: string, workshopId: string): SessionResolution => ({ screen: 'app', userId, workshopId });
  it('mismo usuario y mismo taller ya en pantalla: es la misma sesión revalidada', () => {
    expect(isSameAppSession(onScreen, app('u1', 'w1'))).toBe(true);
  });
  it('otro usuario en el mismo taller (cambio de cuenta) es un cambio real', () => {
    expect(isSameAppSession(onScreen, app('u2', 'w1'))).toBe(false);
  });
  it('el mismo usuario en otro taller es un cambio real', () => {
    expect(isSameAppSession(onScreen, app('u1', 'w2'))).toBe(false);
  });
  it('retirado del taller, con invitación, sin sesión o con error: nunca es la misma sesión', () => {
    const pending = { id: 'i1', workshop_id: 'w1', workshop_name: 'Taller', invited_by_email: 'a@b.com' };
    for (const resolution of [{ screen: 'onboarding', userId: 'u1' }, { screen: 'invitation', userId: 'u1', pending }, { screen: 'auth' }, { screen: 'auth', error: 'x' }] as SessionResolution[]) expect(isSameAppSession(onScreen, resolution)).toBe(false);
  });
  it('sin ninguna sesión en pantalla (primera carga, tras cerrar sesión o tras un error) siempre se carga', () => {
    expect(isSameAppSession(null, app('u1', 'w1'))).toBe(false);
  });
});

describe('workspace.tsx: cableado de la sesión en pantalla', () => {
  // Source-level, like the test above: no React render harness here.
  // Whitespace is removed so reformatting doesn't break these; comments
  // are stripped so they can't satisfy or break a match.
  const source = readFileSync('src/components/workspace.tsx', 'utf8').split('\n').map(line => line.replace(/\/\/.*/, '')).join('\n').replace(/\s+/g, '');
  const session = source.slice(source.indexOf('asyncfunctionsession(){'), source.indexOf('voidsession();'));
  it('session() solo omite la recarga después de las comprobaciones del servidor y de vigencia, y antes de cualquier rama', () => {
    const skip = session.indexOf('if(canSkipReload(appSessionRef.current,repository.current,resolution))return;');
    expect(skip).toBeGreaterThan(session.indexOf('awaitresolveSession({'));
    expect(skip).toBeGreaterThan(session.indexOf('if(sessionEpochRef.current!==epochAtStart)return;'));
    expect(skip).toBeGreaterThan(session.indexOf('if(authGenerationRef.current!==authGeneration)return;'));
    expect(skip).toBeLessThan(session.indexOf("if(resolution.screen==='app')"));
    expect(skip).toBeLessThan(session.indexOf('endSession();'));
  });
  it('la sesión en pantalla solo se fija donde load() pone la pantalla en app, con el usuario de esa sesión', () => {
    expect(source.match(/appSessionRef\.current=userId\?\{userId,workshopId:next\.workshop\.id,repo\}:null;setScreen\('app'\);/g)).toHaveLength(1);
    expect(source.match(/appSessionRef\.current=\{/g)).toBeNull();
    expect(session).toContain("if(resolution.screen==='app'){awaitload(newSupabaseRepository(resolution.workshopId),resolution.userId);return;}");
    for (const call of source.match(/load\(newSupabaseRepository\([^)]*\)[^;]*\)/g) ?? []) expect(call).toMatch(/,(resolution\.userId|sessionUserIdRef\.current)\)$/);
  });
  it('se borra en cada salida del panel: cierre de sesión, invitación u onboarding, error de carga y recuperación de contraseña', () => {
    expect(source).toContain('functionendSession(){lastWorkshopIdRef.current=null;appSessionRef.current=null;');
    expect(session).toContain("appSessionRef.current=null;if(resolution.screen==='invitation')");
    expect(source).toContain("appSessionRef.current=null;setError(errinstanceofError?err.message:'Nosehanpodidocargarlosdatos.');setScreen('auth');");
    expect(source).toContain("if(event==='PASSWORD_RECOVERY'){recovering.current=true;appSessionRef.current=null;setScreen('reset-password');return;}");
  });
});

describe('canSkipReload: sin recarga solo si nada está sustituyendo lo que se ve', () => {
  const repoA1 = { name: 'A1' }, repoB = { name: 'B' };
  const app = (userId: string, workshopId: string): SessionResolution => ({ screen: 'app', userId, workshopId });
  it('renovación del token de A con el repositorio de A activo: se omite la recarga', () => {
    expect(canSkipReload({ userId: 'uA', workshopId: 'wA', repo: repoA1 }, repoA1, app('uA', 'wA'))).toBe(true);
  });
  it('A en pantalla, load(B) en vuelo (otra pestaña cambió a B) y vuelta a A sin SIGNED_OUT: se recarga A', () => {
    // load(B) swapped the active repository the moment it started, while the
    // shown session (only updated when a load() applies) is still A.
    const shown = { userId: 'uA', workshopId: 'wA', repo: repoA1 };
    expect(canSkipReload(shown, repoB, app('uA', 'wA'))).toBe(false);
  });
  it('sin sesión en pantalla o sin repositorio activo nunca se omite', () => {
    expect(canSkipReload(null, repoA1, app('uA', 'wA'))).toBe(false);
    expect(canSkipReload({ userId: 'uA', workshopId: 'wA', repo: repoA1 }, null, app('uA', 'wA'))).toBe(false);
  });
  it('con el repositorio correcto, otro usuario u otro taller siguen siendo un cambio real', () => {
    const shown = { userId: 'uA', workshopId: 'wA', repo: repoA1 };
    expect(canSkipReload(shown, repoA1, app('uB', 'wA'))).toBe(false);
    expect(canSkipReload(shown, repoA1, app('uA', 'wB'))).toBe(false);
    expect(canSkipReload(shown, repoA1, { screen: 'onboarding', userId: 'uA' })).toBe(false);
  });
});

describe('workspace.tsx: una carga sustituida no se aplica', () => {
  const source = readFileSync('src/components/workspace.tsx', 'utf8').split('\n').map(line => line.replace(/\/\/.*/, '')).join('\n').replace(/\s+/g, '');
  it('el éxito de load() se descarta si empezó un session()/load() más reciente, antes de tocar estado, aviso o pantalla', () => {
    const load = source.slice(source.indexOf('constload=useCallback(async(repo:WorkshopRepository'), source.indexOf('},[reads]);'));
    const success = load.slice(0, load.indexOf('}catch(err){'));
    const check = success.indexOf('if(authGenerationRef.current!==authGeneration)return;');
    expect(check).toBeGreaterThan(success.indexOf('constnext=awaitrepo.load(defaultQuery);'));
    for (const effect of ['checkForNewRequests(', 'lastWorkshopIdRef.current=next.workshop.id', 'setState(', 'appSessionRef.current=', "setScreen('app')"]) expect(check).toBeLessThan(success.indexOf(effect));
  });
});
