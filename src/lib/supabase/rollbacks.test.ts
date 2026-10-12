import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Production rollbacks of 019 and 020 (supabase/rollbacks, never applied by
// tooling). Two throwaway databases: one with every migration, one without
// 019 and 020 (the state production had before them). Rolling back 020 and
// then 019 must give exactly the second one; applying them again, the first.
const migrations = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort();
const sql = (path: string) => readFileSync(path, 'utf8');
const rollback019 = sql('supabase/rollbacks/202610110019_account_deletion.rollback.sql');
const rollback020 = sql('supabase/rollbacks/202610110020_deleted_account_anonymization.rollback.sql');
const m019 = sql('supabase/migrations/202610110019_account_deletion.sql');
const m020 = sql('supabase/migrations/202610110020_deleted_account_anonymization.sql');
const combined = sql('supabase/rollbacks/202610110019_020_combined.rollback.sql');

async function database(skip: string[] = []) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key, email text unique default (gen_random_uuid()::text || '@example.invalid'), email_confirmed_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated, anon;`);
  for (const file of migrations) if (!skip.some(s => file.startsWith(s))) await db.exec(sql('supabase/migrations/' + file));
  return db;
}

// Everything 019/020 and their rollbacks touch: references to auth.users,
// nullability of the invitation columns, triggers on auth.users and every
// public function (definition and grants). Definitions are compared
// without carriage returns: a file checked out on Windows has CRLF line
// endings (as production stores the functions applied from there), the
// same file in CI has LF, and only the line endings differ.
async function schema(db: PGlite) {
  const q = async (s: string) => (await db.query(s)).rows;
  return {
    fks: await q("select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) def, condeferrable, convalidated from pg_constraint where contype = 'f' and confrelid = 'auth.users'::regclass order by 1, 2"),
    columns: await q("select attname, attnotnull from pg_attribute where attrelid = 'public.workshop_invitations'::regclass and attname in ('invited_by', 'accepted_by', 'email') order by 1"),
    triggers: (await db.query<{ tgname: string; def: string }>("select tgname, pg_get_triggerdef(oid) def from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal order by 1")).rows,
    functions: await q("select p.oid::regprocedure::text f, md5(replace(pg_get_functiondef(p.oid), chr(13), '')) def, coalesce(p.proacl::text, '') acl from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1"),
  };
}

describe('reversiones de producción de las migraciones 019 y 020', () => {
  let full: PGlite, before: PGlite;
  beforeAll(async () => { [full, before] = await Promise.all([database(), database(['202610110019', '202610110020'])]); }, 120000);
  afterAll(async () => { await Promise.all([full.close(), before.close()]); });

  it('revertir 020 y después 019 deja exactamente el estado anterior, y reaplicarlas el posterior', async () => {
    const after = await schema(full), expected = await schema(before);
    expect(after).not.toEqual(expected);
    await full.exec(rollback020);
    await full.exec(rollback019);
    expect(await schema(full)).toEqual(expected);
    await full.exec(m019);
    await full.exec(m020);
    expect(await schema(full)).toEqual(after);
  });

  it('la reversión conjunta (una sola transacción) deja exactamente el estado anterior', async () => {
    const db = await database();
    try {
      await db.exec(combined);
      expect(await schema(db)).toEqual(await schema(before));
    } finally {
      await db.close();
    }
  }, 120000);

  it('la reversión de 020 deja accept_invitation exactamente como en 018', async () => {
    const body = (await before.query<{ h: string }>("select md5(prosrc) h from pg_proc where oid = 'public.accept_invitation(uuid)'::regprocedure")).rows[0].h;
    expect(body).toBe('55619311670577261a02848ffa5ff1d8');
  });

  it('si un invitador ya se borró, la reversión conjunta se detiene sin cambiar nada', async () => {
    const db = await database();
    try {
      const owner = '30190000-0000-4000-8000-000000000001', staff = '30190000-0000-4000-8000-000000000002';
      await db.query("insert into auth.users(id, email) values ($1, 'owner3019@example.com'), ($2, 'staff3019@example.com')", [owner, staff]);
      await db.exec("set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
      const w = (await db.query<{ id: string }>("select public.create_workshop('Taller 3019') id")).rows[0].id;
      await db.query("select public.invite_member($1, 'otra3019@example.com')", [w]);
      await db.exec('reset role');
      // The inviter (owner) can only be deleted after closing the workshop,
      // so make a second workshop's invitation lose its inviter instead.
      await db.query("insert into public.workshop_members(workshop_id, user_id, role, invited_by) values ($1, $2, 'staff', $3)", [w, staff, owner]);
      await db.query("update public.workshop_invitations set invited_by = $1 where workshop_id = $2", [staff, w]);
      await db.query('delete from auth.users where id = $1', [staff]);
      expect((await db.query("select count(*)::int n from public.workshop_invitations where invited_by is null")).rows).toEqual([{ n: 1 }]);
      const state = await schema(db);
      await expect(db.exec(combined)).rejects.toThrow('Hay invitaciones sin invitador');
      await db.exec('rollback');
      expect(await schema(db)).toEqual(state);
      // The separate 019 rollback would fail too, on SET NOT NULL, as one transaction.
      await expect(db.exec(rollback019)).rejects.toThrow(/invited_by.*null values/);
      await db.exec('rollback');
      expect(await schema(db)).toEqual(state);
    } finally {
      await db.close();
    }
  }, 120000);
});

// Rollback of 022 (public self-booking): with every migration, rolling it
// back must give exactly the database without 022, and applying 022 again
// the full one -- including when visitors already booked appointments.
describe('reversión de la migración 022', () => {
  const rollback022 = sql('supabase/rollbacks/202610120022_public_booking.rollback.sql');
  const m022 = sql('supabase/migrations/202610120022_public_booking.sql');
  it('deja el estado sin 022 (public_intake como en 017 y rechazando horas de formularios antiguos), conserva las citas y se puede reaplicar', async () => {
    const [full, without] = await Promise.all([database(), database(['202610120022'])]);
    try {
      const after = await schema(full), expected = await schema(without);
      expect(after).not.toEqual(expected);
      const owner = '30220000-0000-4000-8000-000000000001';
      await full.query('insert into auth.users(id) values ($1)', [owner]);
      await full.exec('set role authenticated');
      await full.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
      const w = (await full.query<{ id: string }>("select public.create_workshop('Taller 3022') id")).rows[0].id;
      await full.exec('reset role');
      await full.query("insert into public.workshop_hours(workshop_id, day_of_week, opens_at, closes_at) select $1, d, '09:00', '11:00' from generate_series(1, 7) d", [w]);
      const slug = (await full.query<{ slug: string }>('select slug from public.workshops where id = $1', [w])).rows[0].slug;
      const slot = (await full.query<{ a: { slots: string[] } }>('select public.public_availability($1) a', [slug])).rows[0].a.slots[0];
      await full.query('select public.public_intake(p_slug=>$1, p_data=>$2::jsonb, p_messages=>$3::jsonb, p_client_id=>$4::uuid, p_consent=>true)',
        [slug, JSON.stringify({ name: 'Cliente 3022', phone: '600302200', brand: 'SEAT', model: 'Ibiza', plate: '', reason: 'Revisión', availability: 'x', slot_starts_at: slot }), JSON.stringify([{ role: 'user', content: 'Hola' }]), crypto.randomUUID()]);
      await full.exec(rollback022);
      // Identical to the database without 022 except public_intake, which
      // is 017's plus the guard that refuses a slot from a stale form.
      const rolled = await schema(full);
      const isIntake = (f: unknown) => String((f as { f: string }).f).startsWith('public_intake(');
      expect({ ...rolled, functions: rolled.functions.filter(f => !isIntake(f)) }).toEqual({ ...expected, functions: expected.functions.filter(f => !isIntake(f)) });
      expect((rolled.functions.find(isIntake) as { acl: string }).acl).toBe((expected.functions.find(isIntake) as { acl: string }).acl);
      const intake = (body: Record<string, unknown>) => full.query('select public.public_intake(p_slug=>$1, p_data=>$2::jsonb, p_messages=>$3::jsonb, p_client_id=>$4::uuid, p_consent=>true)',
        [slug, JSON.stringify({ name: 'Cliente 3022b', phone: '600302201', brand: 'SEAT', model: 'Ibiza', plate: '', reason: 'Revisión', availability: 'Tardes', ...body }), JSON.stringify([{ role: 'user', content: 'Hola' }]), crypto.randomUUID()]);
      await expect(intake({ slot_starts_at: slot })).rejects.toThrow('No podemos reservar esta hora automáticamente.');
      await intake({});
      await intake({ slot_starts_at: null });
      expect((await full.query("select count(*)::int n from public.appointments where status = 'scheduled'")).rows).toEqual([{ n: 1 }]);
      await full.exec(m022);
      expect(await schema(full)).toEqual(after);
    } finally {
      await Promise.all([full.close(), without.close()]);
    }
  }, 120000);
});
