import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyNewRequest } from './notifications';
// server-only throws unconditionally outside Next.js's own build pipeline,
// by design -- it relies on Next aliasing it away for Server Components,
// which Vitest knows nothing about. Stub it so the module under test can
// load in a plain Node test environment.
vi.mock('server-only', () => ({}));

const { calls, rpcResult, workshopClaimResult, membersResult, getUserById, emailsSend } = vi.hoisted(() => ({
  calls: [] as { table: string; method: string; args: unknown[] }[],
  rpcResult: { data: null as string | null, error: null as { message: string } | null },
  workshopClaimResult: { data: null as { id: string; name: string } | null, error: null as { message: string } | null },
  membersResult: { data: null as { user_id: string }[] | null, error: null as { message: string } | null },
  getUserById: vi.fn(),
  emailsSend: vi.fn().mockResolvedValue({ error: null }),
}));
// A minimal recording stand-in for the supabase-js query builder: every
// chained method is logged with its exact arguments (table.eq('id', x) is
// distinguishable from table.eq('channel', y)), so tests can assert on
// which columns and values a query actually filtered by -- not just on
// what it returned -- which is what proves the tenant boundary the
// cooldown/members lookups rely on, rather than just their happy-path
// shape. The whether-this-is-a-public-request-that-hasn't-been-notified
// check itself lives entirely in the real SQL function
// claim_public_request_notification, verified against a real PostgreSQL
// engine in src/lib/supabase/database.test.ts -- mocking .rpc() here would
// only re-check that this file calls admin.rpc with the right name and
// argument, not that the query is actually correct against the real
// schema (which is exactly what an earlier, purely-mocked version of
// these tests missed: it mocked a filter on requests.channel, a column
// that doesn't exist).
function chain(table: string, terminal: () => Promise<unknown>) {
  const record = (method: string, args: unknown[]) => calls.push({ table, method, args });
  const self = {
    update: (...args: unknown[]) => { record('update', args); return self; },
    eq: (...args: unknown[]) => { record('eq', args); return self; },
    or: (...args: unknown[]) => { record('or', args); return self; },
    select: (...args: unknown[]) => { record('select', args); return self; },
    maybeSingle: () => terminal(),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => terminal().then(resolve, reject),
  };
  return self;
}
vi.mock('./supabase/admin', () => ({
  getSupabaseAdmin: () => ({
    rpc: (name: string, args: unknown) => { calls.push({ table: 'rpc', method: name, args: [args] }); return Promise.resolve(rpcResult); },
    from: (table: string) => {
      if (table === 'workshops') return chain(table, () => Promise.resolve(workshopClaimResult));
      if (table === 'workshop_members') return chain(table, () => Promise.resolve(membersResult));
      throw new Error('unexpected table ' + table);
    },
    auth: { admin: { getUserById } },
  }),
}));
vi.mock('resend', () => ({ Resend: vi.fn().mockImplementation(() => ({ emails: { send: emailsSend } })) }));

function callsFor(table: string, method: string) { return calls.filter(c => c.table === table && c.method === method); }

describe('notifyNewRequest', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  const originalResendKey = process.env.RESEND_API_KEY;
  const originalFromEmail = process.env.NOTIFICATIONS_FROM_EMAIL;
  afterAll(() => {
    if (originalResendKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = originalResendKey;
    if (originalFromEmail === undefined) delete process.env.NOTIFICATIONS_FROM_EMAIL; else process.env.NOTIFICATIONS_FROM_EMAIL = originalFromEmail;
  });
  beforeEach(() => {
    calls.length = 0;
    rpcResult.data = null;
    rpcResult.error = null;
    workshopClaimResult.data = null;
    workshopClaimResult.error = null;
    membersResult.data = null;
    membersResult.error = null;
    getUserById.mockReset();
    emailsSend.mockClear();
    process.env.RESEND_API_KEY = 'test-key';
    delete process.env.NOTIFICATIONS_FROM_EMAIL;
    // Spied fresh every test (silenced) so a test that wants to assert on
    // it just reads consoleError, and restored in afterEach below even if
    // an earlier assertion in the test throws first -- vi.restoreAllMocks
    // would do the same, but it also wipes the default mockResolvedValue
    // set on the hoisted getUserById/emailsSend vi.fn()s below (they're
    // plain mocks, not spies on a real method, so "restoring" them clears
    // their implementation entirely), which broke every test that runs
    // after the first one to use it.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleError.mockRestore();
    delete process.env.NOTIFICATIONS_FROM_EMAIL;
  });

  it('reclama la notificación llamando a claim_public_request_notification con el id exacto de la solicitud', async () => {
    rpcResult.data = null; // no reclamada (ya avisada, inexistente o no pública): la lógica real se prueba contra Postgres en database.test.ts
    await notifyNewRequest('req-1');
    expect(callsFor('rpc', 'claim_public_request_notification')).toEqual([{ table: 'rpc', method: 'claim_public_request_notification', args: [{ p_request_id: 'req-1' }] }]);
    expect(emailsSend).not.toHaveBeenCalled();
    expect(callsFor('workshops', 'update')).toHaveLength(0);
  });

  it('nunca lanza y no envía nada si la RPC de reclamación devuelve un error -- aunque data venga con un valor (para probar que es el error, y no una data nula, lo que detiene el flujo)', async () => {
    rpcResult.data = 'w-42';
    rpcResult.error = { message: 'boom' };
    await expect(notifyNewRequest('req-1')).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith('claim_public_request_notification failed', rpcResult.error);
    expect(callsFor('workshops', 'update')).toHaveLength(0);
    expect(emailsSend).not.toHaveBeenCalled();
  });

  it('tras reclamar la solicitud, aplica el enfriamiento del taller devuelto por la reclamación (no otro)', async () => {
    rpcResult.data = 'w-42';
    workshopClaimResult.data = null; // enfriamiento activo
    await notifyNewRequest('req-1');
    expect(callsFor('workshops', 'eq')).toEqual([{ table: 'workshops', method: 'eq', args: ['id', 'w-42'] }]);
    expect(emailsSend).not.toHaveBeenCalled();
    expect(callsFor('workshop_members', 'select')).toHaveLength(0);
  });

  it('nunca lanza y no envía nada si la actualización del enfriamiento devuelve un error -- aunque data venga con un valor', async () => {
    rpcResult.data = 'w-42';
    workshopClaimResult.data = { id: 'w-42', name: 'Taller Uno' };
    workshopClaimResult.error = { message: 'boom' };
    await expect(notifyNewRequest('req-1')).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith('workshop notification cooldown update failed', workshopClaimResult.error);
    expect(callsFor('workshop_members', 'select')).toHaveLength(0);
    expect(emailsSend).not.toHaveBeenCalled();
  });

  it('busca los miembros exactamente del taller reclamado (aislamiento entre talleres)', async () => {
    rpcResult.data = 'w-42';
    workshopClaimResult.data = { id: 'w-42', name: 'Taller Cuarenta y Dos' };
    membersResult.data = [];
    await notifyNewRequest('req-1');
    expect(callsFor('workshop_members', 'eq')).toEqual([{ table: 'workshop_members', method: 'eq', args: ['workshop_id', 'w-42'] }]);
    expect(emailsSend).not.toHaveBeenCalled();
  });

  it('nunca lanza y no envía nada si la búsqueda de miembros devuelve un error -- aunque data venga con un valor', async () => {
    rpcResult.data = 'w-42';
    workshopClaimResult.data = { id: 'w-42', name: 'Taller Uno' };
    membersResult.data = [{ user_id: 'owner' }];
    membersResult.error = { message: 'boom' };
    await expect(notifyNewRequest('req-1')).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith('workshop_members lookup failed', membersResult.error);
    expect(getUserById).not.toHaveBeenCalled();
    expect(emailsSend).not.toHaveBeenCalled();
  });

  it('resuelve parcialmente: envía solo a los miembros con email, y omite (sin lanzar) a los que no tienen', async () => {
    rpcResult.data = 'w-42';
    workshopClaimResult.data = { id: 'w-42', name: 'Taller Uno' };
    membersResult.data = [{ user_id: 'owner' }, { user_id: 'sin-email' }];
    getUserById.mockImplementation((id: string) => Promise.resolve(id === 'owner' ? { data: { user: { email: 'owner@example.com' } } } : { data: { user: null } }));
    await notifyNewRequest('req-1');
    expect(emailsSend).toHaveBeenCalledTimes(1);
    expect(emailsSend.mock.calls[0][0].to).toEqual(['owner@example.com']);
  });

  it('no envía nada, y no lanza, si ningún miembro tiene ningún email resoluble', async () => {
    rpcResult.data = 'w-42';
    workshopClaimResult.data = { id: 'w-42', name: 'Taller Uno' };
    membersResult.data = [{ user_id: 'sin-email' }];
    getUserById.mockResolvedValue({ data: { user: null } });
    await expect(notifyNewRequest('req-1')).resolves.toBeUndefined();
    expect(emailsSend).not.toHaveBeenCalled();
  });

  it('si getUserById devuelve un error para un miembro, lo registra y sigue con el resto (no lo trata en silencio como "sin email")', async () => {
    rpcResult.data = 'w-42';
    workshopClaimResult.data = { id: 'w-42', name: 'Taller Uno' };
    membersResult.data = [{ user_id: 'falla' }, { user_id: 'owner' }];
    const authError = { message: 'boom' };
    getUserById.mockImplementation((id: string) => Promise.resolve(id === 'falla' ? { data: null, error: authError } : { data: { user: { email: 'owner@example.com' } } }));
    await notifyNewRequest('req-1');
    expect(consoleError).toHaveBeenCalledWith('getUserById failed for a workshop member', authError);
    expect(emailsSend).toHaveBeenCalledTimes(1);
    expect(emailsSend.mock.calls[0][0].to).toEqual(['owner@example.com']);
  });

  it('envía exactamente el asunto y cuerpo mínimos, sin ningún dato del cliente', async () => {
    rpcResult.data = 'w-42';
    workshopClaimResult.data = { id: 'w-42', name: 'Taller Uno' };
    membersResult.data = [{ user_id: 'owner' }, { user_id: 'staff' }];
    getUserById.mockImplementation((id: string) => Promise.resolve({ data: { user: { email: id + '@example.com' } } }));
    await notifyNewRequest('req-1');
    expect(emailsSend).toHaveBeenCalledTimes(1);
    const call = emailsSend.mock.calls[0][0];
    expect(call.to).toEqual(['owner@example.com', 'staff@example.com']);
    expect(call.subject).toBe('Tienes una solicitud nueva');
    expect(call.text).toBe('Ha llegado una solicitud nueva en la recepción de Taller Uno. Revísala en tu panel de TALLERIA.');
    expect(call.from).toBe('TALLERIA <onboarding@resend.dev>');
  });

  it('usa el remitente configurado cuando no está vacío, y el remitente por defecto cuando está en blanco (no una cadena vacía real)', async () => {
    rpcResult.data = 'w-42';
    workshopClaimResult.data = { id: 'w-42', name: 'Taller Uno' };
    membersResult.data = [{ user_id: 'owner' }];
    getUserById.mockResolvedValue({ data: { user: { email: 'owner@example.com' } } });
    process.env.NOTIFICATIONS_FROM_EMAIL = '  ';
    await notifyNewRequest('req-1');
    expect(emailsSend.mock.calls[0][0].from).toBe('TALLERIA <onboarding@resend.dev>');
    process.env.NOTIFICATIONS_FROM_EMAIL = 'Taller <avisos@taller.example>';
    await notifyNewRequest('req-1');
    expect(emailsSend.mock.calls[1][0].from).toBe('Taller <avisos@taller.example>');
  });

  it('no lanza si falta RESEND_API_KEY; simplemente no envía', async () => {
    delete process.env.RESEND_API_KEY;
    rpcResult.data = 'w-42';
    workshopClaimResult.data = { id: 'w-42', name: 'Taller Uno' };
    membersResult.data = [{ user_id: 'owner' }];
    getUserById.mockResolvedValue({ data: { user: { email: 'owner@example.com' } } });
    await expect(notifyNewRequest('req-1')).resolves.toBeUndefined();
    expect(emailsSend).not.toHaveBeenCalled();
  });

  it('nunca lanza si Resend devuelve un error', async () => {
    rpcResult.data = 'w-42';
    workshopClaimResult.data = { id: 'w-42', name: 'Taller Uno' };
    membersResult.data = [{ user_id: 'owner' }];
    getUserById.mockResolvedValue({ data: { user: { email: 'owner@example.com' } } });
    emailsSend.mockResolvedValueOnce({ error: { message: 'boom' } });
    await expect(notifyNewRequest('req-1')).resolves.toBeUndefined();
  });

  it('nunca lanza, ni siquiera si el cliente de Supabase falla', async () => {
    rpcResult.data = 'w-42';
    workshopClaimResult.data = { id: 'w-42', name: 'Taller Uno' };
    membersResult.data = [{ user_id: 'owner' }];
    getUserById.mockRejectedValue(new Error('boom'));
    await expect(notifyNewRequest('req-1')).resolves.toBeUndefined();
    expect(emailsSend).not.toHaveBeenCalled();
  });
});
