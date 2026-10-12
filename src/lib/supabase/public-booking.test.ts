import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Migration 022 (public self-booking), against real PostgreSQL (PGlite),
// with every migration applied. The workshop opens every day 09:00-11:00
// (Europe/Madrid) with 60-minute slots and one resource, so each day offers
// 09:00 and 10:00 local -- whatever day the suite runs.
const db = new PGlite();
const owner = '40000000-0000-4000-8000-000000000001';
let workshop: string;
let slug: string;
const migrations = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort();

async function asAdmin() { await db.exec('reset role'); }
async function asAnon() { await db.exec('reset role; set role anon;'); }
async function asUser(id: string) { await db.exec('reset role; set role authenticated;'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); }
type Availability = { timezone: string; duration_minutes: number; slots: string[] };
async function availability(target = slug): Promise<Availability | null> {
  await asAnon();
  return (await db.query<{ a: Availability | null }>('select public.public_availability($1) a', [target])).rows[0].a;
}
let seq = 0;
async function submit(slot?: unknown, phone?: string, clientId = crypto.randomUUID()) {
  await asAnon();
  // A distinct address per call, so the per-IP limit never interferes.
  seq++;
  await db.query("select set_config('request.headers',$1,false)", [JSON.stringify({ 'cf-connecting-ip': `198.51.100.${seq}` })]);
  const data: Record<string, unknown> = { name: 'Cliente Público', phone: phone ?? '6' + String(20000000 + seq).slice(-8), brand: 'SEAT', model: 'Ibiza', plate: '', reason: 'Ruido al frenar', availability: 'Lo que diga el cliente' };
  if (slot !== undefined) data.slot_starts_at = slot;
  await db.query('select public.public_intake(p_slug=>$1, p_data=>$2::jsonb, p_messages=>$3::jsonb, p_client_id=>$4::uuid, p_consent=>true)',
    [slug, JSON.stringify(data), JSON.stringify([{ role: 'user', content: 'Hola' }]), clientId]);
  return clientId;
}
async function counts() {
  await asAdmin();
  return (await db.query<{ requests: number; customers: number; appointments: number }>('select (select count(*)::int from public.requests) requests, (select count(*)::int from public.customers) customers, (select count(*)::int from public.appointments) appointments')).rows[0];
}
const iso = (value: string) => new Date(value).toISOString();

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key, email text unique default (gen_random_uuid()::text || '@example.invalid'), email_confirmed_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    insert into auth.users(id) values ('${owner}');`);
  for (const file of migrations) await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  await asUser(owner);
  workshop = (await db.query<{ id: string }>("select public.create_workshop('Taller Reservas') id")).rows[0].id;
  await asAdmin();
  slug = (await db.query<{ slug: string }>('select slug from public.workshops where id=$1', [workshop])).rows[0].slug;
}, 180000);
afterAll(async () => { await db.close(); });

describe('migración 022: huecos libres y reserva desde la recepción pública', () => {
  it('es la última migración', () => {
    expect(migrations.at(-1)).toBe('202610120022_public_booking.sql');
  });

  it('sin horario estructurado no ofrece huecos, y un enlace inexistente devuelve null', async () => {
    expect(await availability()).toEqual({ timezone: 'Europe/Madrid', duration_minutes: 60, slots: [] });
    expect(await availability('no-existe')).toBeNull();
  });

  it('con horario ofrece solo horas de inicio libres: en la rejilla del taller, desde una hora vista y hasta 14 días', async () => {
    await asAdmin();
    await db.exec(`insert into public.workshop_hours(workshop_id, day_of_week, opens_at, closes_at) select '${workshop}', d, '09:00', '11:00' from generate_series(1, 7) d`);
    const a = (await availability())!;
    expect(Object.keys(a).sort()).toEqual(['duration_minutes', 'slots', 'timezone']);
    expect(a.slots.length).toBeGreaterThanOrEqual(26);
    expect(a.slots.length).toBeLessThanOrEqual(28);
    const local = a.slots.map(s => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(s)));
    expect(new Set(local)).toEqual(new Set(['09:00', '10:00']));
    const times = a.slots.map(s => new Date(s).getTime());
    expect(times).toEqual([...times].sort((x, y) => x - y));
    expect(Math.min(...times)).toBeGreaterThanOrEqual(Date.now() + 3600000 - 60000);
    expect(Math.max(...times)).toBeLessThan(Date.now() + 14 * 86400000 + 60000);
  });

  it('el detalle interno (qué recurso, quién reservó) no es accesible para visitantes anónimos', async () => {
    await asAnon();
    await expect(db.query("select * from public.workshop_free_slots($1, now(), now() + interval '1 day')", [workshop])).rejects.toThrow(/permission denied/);
  });

  it('reservar una hora libre crea la solicitud con la cita en el recurso, y la hora deja de ofrecerse', async () => {
    const slot = (await availability())!.slots[0];
    const id = await submit(slot);
    await asAdmin();
    const request = (await db.query<{ status: string; availability: string }>('select status, availability from public.requests where id=$1', [id])).rows[0];
    expect(request.status).toBe('cita_creada');
    expect(request.availability).toMatch(/^Cita reservada por el cliente: \d{2}\/\d{2}\/\d{4} (09|10):00$/);
    const appointments = (await db.query<{ starts_at: Date; duration_minutes: number; status: string; resource_id: string; notes: string }>('select starts_at, duration_minutes, status, resource_id, notes from public.appointments where request_id=$1', [id])).rows;
    expect(appointments).toHaveLength(1);
    expect(iso(appointments[0].starts_at.toISOString())).toBe(iso(slot));
    expect(appointments[0]).toMatchObject({ duration_minutes: 60, status: 'scheduled', notes: 'Reservada por el cliente desde la recepción digital.' });
    const resource = (await db.query<{ id: string }>('select id from public.resources where workshop_id=$1', [workshop])).rows[0].id;
    expect(appointments[0].resource_id).toBe(resource);
    expect((await availability())!.slots).not.toContain(slot);
  });

  it('la misma hora no se puede reservar dos veces: el segundo envío falla entero y no escribe nada', async () => {
    await asAdmin();
    const taken = (await db.query<{ starts_at: Date }>('select starts_at from public.appointments limit 1')).rows[0].starts_at.toISOString();
    const before = await counts();
    await expect(submit(taken)).rejects.toThrow('Esa hora ya no está disponible. Elige otra.');
    expect(await counts()).toEqual(before);
  });

  it('el calendario del taller tampoco puede pisar una hora reservada por un cliente', async () => {
    await asAdmin();
    const taken = (await db.query<{ starts_at: Date }>('select starts_at from public.appointments limit 1')).rows[0].starts_at.toISOString();
    const other = await submit();
    await asAdmin();
    const version = (await db.query<{ version: number }>('select version from public.requests where id=$1', [other])).rows[0].version;
    await asUser(owner);
    await expect(db.query('select public.execute_command($1, $2::jsonb)', [workshop, JSON.stringify({ type: 'appointment', id: crypto.randomUUID(), request_id: other, request_version: version, starts_at: taken, duration_minutes: 60, notes: '' })]))
      .rejects.toThrow('coincide con otra cita');
  });

  it('y una hora ocupada desde el calendario deja de ofrecerse y no se puede reservar', async () => {
    const slot = (await availability())!.slots[0];
    const other = await submit();
    await asAdmin();
    const version = (await db.query<{ version: number }>('select version from public.requests where id=$1', [other])).rows[0].version;
    await asUser(owner);
    await db.query('select public.execute_command($1, $2::jsonb)', [workshop, JSON.stringify({ type: 'appointment', id: crypto.randomUUID(), request_id: other, request_version: version, starts_at: slot, duration_minutes: 60, notes: '' })]);
    expect((await availability())!.slots).not.toContain(slot);
    await expect(submit(slot)).rejects.toThrow('Esa hora ya no está disponible. Elige otra.');
  });

  it('rechaza horas que no son un hueco ofrecido o no son válidas, sin escribir nada', async () => {
    const slot = new Date((await availability())!.slots[0]);
    const before = await counts();
    const misaligned = new Date(slot.getTime() + 30 * 60000).toISOString();
    const closed = new Date(slot.getTime() + 4 * 3600000).toISOString();
    const soon = new Date(Date.now() + 5 * 60000).toISOString();
    const far = new Date(Date.now() + 20 * 86400000).toISOString();
    for (const bad of [misaligned, closed, soon, far, 'infinity']) await expect(submit(bad), bad).rejects.toThrow('Esa hora ya no está disponible. Elige otra.');
    await expect(submit(12345)).rejects.toThrow('La hora elegida no es válida.');
    await expect(submit('x'.repeat(41))).rejects.toThrow('La hora elegida no es válida.');
    await expect(submit('mañana a las diez')).rejects.toThrow('Los datos no son válidos.');
    expect(await counts()).toEqual(before);
  });

  it('sin hora elegida (o con null) funciona como antes: solicitud nueva, sin cita y con la disponibilidad escrita', async () => {
    for (const slot of [undefined, null]) {
      const id = await submit(slot);
      await asAdmin();
      expect((await db.query('select status, availability from public.requests where id=$1', [id])).rows[0]).toEqual({ status: 'nueva', availability: 'Lo que diga el cliente' });
      expect((await db.query('select 1 from public.appointments where request_id=$1', [id])).rows).toHaveLength(0);
    }
  });

  it('reenviar la misma solicitud no crea otra cita', async () => {
    const slot = (await availability())!.slots[0];
    const id = await submit(slot);
    const before = await counts();
    await submit(slot, undefined, id);
    expect(await counts()).toEqual(before);
  });

  it('un reintento con otra hora (o sin hora) de una solicitud ya guardada se rechaza y no cambia nada', async () => {
    const [first, second] = (await availability())!.slots;
    const id = await submit(first);
    const before = await counts();
    await expect(submit(second, undefined, id)).rejects.toThrow(/^Tu solicitud ya estaba enviada \(Cita reservada por el cliente: .+\)\. Si quieres cambiar la hora, llama al taller\.$/);
    await expect(submit(undefined, undefined, id)).rejects.toThrow('Tu solicitud ya estaba enviada');
    expect(await counts()).toEqual(before);
    const plain = await submit();
    await expect(submit(second, undefined, plain)).rejects.toThrow('Tu solicitud ya estaba enviada (Lo que diga el cliente).');
  });

  it('la respuesta no depende de si el teléfono ya tiene citas (no revela nada a un anónimo)', async () => {
    const [first, second] = (await availability())!.slots;
    await submit(first, '611222333');
    await submit(second, '+34 611 222 333');
  });

  it('el reintento se compara con la hora reservada aunque el taller haya editado, movido o cancelado la cita', async () => {
    const [first, second] = (await availability())!.slots;
    const id = await submit(first);
    const command = async (cmd: Record<string, unknown>) => {
      await asAdmin();
      const a = (await db.query<{ id: string; version: number; notes: string }>('select id, version, notes from public.appointments where request_id = $1', [id])).rows[0];
      const version = (await db.query<{ version: number }>('select version from public.requests where id = $1', [id])).rows[0].version;
      await asUser(owner);
      await db.query('select public.execute_command($1, $2::jsonb)', [workshop, JSON.stringify({ id: a.id, version: a.version, request_id: id, request_version: version, ...cmd })]);
    };
    const retries = async (stands: boolean) => {
      await expect(submit(undefined, undefined, id)).rejects.toThrow('Tu solicitud ya estaba enviada (');
      await expect(submit(second, undefined, id)).rejects.toThrow('Tu solicitud ya estaba enviada (');
      const before = await counts();
      // Same hour as booked: success only while that booking still stands.
      if (stands) await submit(first, undefined, id);
      else await expect(submit(first, undefined, id)).rejects.toThrow('Tu solicitud ya estaba enviada, pero el taller ha cambiado esa cita desde entonces. Te llamará para confirmarla.');
      expect(await counts()).toEqual(before);
    };
    await command({ type: 'appointment', starts_at: first, duration_minutes: 60, notes: 'Traer las llaves de repuesto' });
    await retries(true);
    await command({ type: 'appointment', starts_at: second, duration_minutes: 60, notes: '' });
    await retries(false);
    await command({ type: 'appointment_status', status: 'cancelled' });
    await retries(false);
  });

  it('cada reserva queda en la actividad como del cliente, y el taller acepta como mucho 10 en 24 horas', async () => {
    await asAdmin();
    const booked = Number((await db.query<{ n: number }>("select count(*)::int n from public.audit_events where action = 'public_booking' and user_id is null and entity_type = 'appointment'")).rows[0].n);
    // Every booking points at its appointment and records the hour it was booked for.
    expect(booked).toBe(Number((await db.query<{ n: number }>("select count(*)::int n from public.audit_events e join public.appointments a on a.id = e.entity_id and a.request_id::text = e.metadata->>'request_id' where e.action = 'public_booking' and e.metadata ? 'starts_at'")).rows[0].n));
    // Fill the 24-hour quota with recorded bookings; one just outside the window doesn't count.
    await db.query("insert into public.audit_events(workshop_id, user_id, action, entity_type, entity_id, created_at) select $1, null, 'public_booking', 'appointment', gen_random_uuid(), clock_timestamp() - interval '1 hour' from generate_series(1, $2::int)", [workshop, 10 - booked]);
    await db.query("insert into public.audit_events(workshop_id, user_id, action, entity_type, entity_id, created_at) values ($1, null, 'public_booking', 'appointment', gen_random_uuid(), clock_timestamp() - interval '25 hours')", [workshop]);
    const slot = (await availability())!.slots[0];
    await expect(submit(slot)).rejects.toThrow('No podemos reservar esta hora automáticamente.');
    await asAdmin();
    await db.query("update public.audit_events set created_at = clock_timestamp() - interval '25 hours' where action = 'public_booking' and created_at > clock_timestamp() - interval '2 hours' and entity_id not in (select id from public.appointments)");
    await submit(slot);
  });

  it('los permisos de las funciones son los esperados', async () => {
    await asAdmin();
    const acl = async (fn: string) => (await db.query<{ acl: string }>('select coalesce(proacl::text, \'\') acl from pg_proc where oid = $1::regprocedure', [fn])).rows[0].acl;
    expect(await acl('public.public_availability(text,integer)')).toMatch(/anon=X/);
    expect(await acl('public.workshop_free_slots(uuid,timestamptz,timestamptz)')).not.toMatch(/anon|authenticated|(^|[{,])=X/);
    expect(await acl('public.public_intake(text,jsonb,jsonb,uuid,text,timestamptz,boolean)')).toMatch(/anon=X/);
  });
});
