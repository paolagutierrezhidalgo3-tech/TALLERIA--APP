import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
const db = new PGlite();
const userA = '10000000-0000-4000-8000-000000000001';
const userB = '10000000-0000-4000-8000-000000000002';
let workshopA: string;
let workshopB: string;
async function asUser(id: string) { await db.exec("reset role; set role authenticated;"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); }
async function execute(workshop: string, command: unknown) { await db.query('select public.execute_command($1::uuid,$2::jsonb)', [workshop, JSON.stringify(command)]); }
function intake(phone = '611222333', plate = '1234BCD') { return { type: 'intake', id: crypto.randomUUID(), data: { name: 'Persona Prueba', phone, brand: 'SEAT', model: 'León', plate, reason: 'Revisión de mantenimiento', availability: 'Mañanas', notes: '' }, messages: [{ role: 'user', content: 'Quiero una revisión' }] }; }
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    insert into auth.users values ('${userA}'),('${userB}');`);
  await db.exec(readFileSync('supabase/migrations/202609200001_initial.sql', 'utf8'));
  await asUser(userA);
  workshopA = (await db.query<{ id: string }>("select public.create_workshop('Taller A') as id")).rows[0].id;
  await asUser(userB);
  workshopB = (await db.query<{ id: string }>("select public.create_workshop('Taller B') as id")).rows[0].id;
}, 60000);
afterAll(async () => { await db.close(); });
describe('PostgreSQL: permisos, aislamiento y transacciones', () => {
  it('un usuario solo puede ver su taller y no puede escribir directamente', async () => {
    await asUser(userA);
    expect((await db.query('select * from public.workshops')).rows).toHaveLength(1);
    expect((await db.query<{ id: string }>('select id from public.workshops')).rows[0].id).toBe(workshopA);
    await expect(db.query("insert into public.customers(workshop_id,name,phone) values($1,'Prueba','611222333')", [workshopA])).rejects.toThrow();
    await expect(execute(workshopB, intake())).rejects.toThrow('acceso');
  });
  it('crea atómicamente la recepción, deduplica y no la filtra a otro taller', async () => {
    await asUser(userA); const command = intake(); await execute(workshopA, command); await execute(workshopA, command);
    expect((await db.query('select * from public.requests')).rows).toHaveLength(1);
    await execute(workshopA, intake());
    expect((await db.query('select * from public.customers')).rows).toHaveLength(1);
    expect((await db.query('select * from public.vehicles')).rows).toHaveLength(1);
    expect((await db.query('select * from public.conversations')).rows).toHaveLength(2);
    await asUser(userB); expect((await db.query('select * from public.requests')).rows).toHaveLength(0);
  });
  it('revierte toda la recepción si la matrícula pertenece a otro cliente', async () => {
    await asUser(userA);
    await expect(execute(workshopA, intake('699888777'))).rejects.toThrow('otro cliente');
    expect((await db.query('select * from public.customers')).rows).toHaveLength(1);
    expect((await db.query('select * from public.conversations')).rows).toHaveLength(2);
  });
  it('bloquea referencias a clientes de otro taller', async () => {
    await asUser(userA);
    const customer = (await db.query<{ id: string }>('select id from public.customers limit 1')).rows[0].id;
    await asUser(userB);
    await expect(execute(workshopB, { type: 'vehicle', vehicle: { id: crypto.randomUUID(), workshop_id: workshopB, customer_id: customer, brand: 'SEAT', model: 'Ibiza', plate: '9999ZZZ' } })).rejects.toThrow();
  });
  it('protege solapamientos y sincroniza citas con solicitudes', async () => {
    await asUser(userA);
    const rows = (await db.query<{ id: string }>('select id from public.requests')).rows;
    const id = crypto.randomUUID();
    const starts_at = new Date(Date.now() + 86400000).toISOString();
    await execute(workshopA, { type: 'appointment', id, request_id: rows[0].id, starts_at, duration_minutes: 60, notes: '' });
    await expect(execute(workshopA, { type: 'appointment', id: crypto.randomUUID(), request_id: rows[1].id, starts_at, duration_minutes: 60, notes: '' })).rejects.toThrow('coincide');
    await expect(execute(workshopA, { type: 'status', id: rows[0].id, status: 'completada' })).rejects.toThrow('cita asociada');
    await execute(workshopA, { type: 'appointment_status', id, status: 'completed' });
    expect((await db.query<{ status: string }>('select status from public.requests where id=$1', [rows[0].id])).rows[0].status).toBe('completada');
  });
  it('no concede acceso anónimo', async () => {
    await db.exec('reset role; set role anon');
    await expect(db.query('select * from public.requests')).rejects.toThrow();
    await expect(execute(workshopA, intake())).rejects.toThrow();
    await expect(db.query("select public.create_workshop('Intruso')")).rejects.toThrow();
  });
});
