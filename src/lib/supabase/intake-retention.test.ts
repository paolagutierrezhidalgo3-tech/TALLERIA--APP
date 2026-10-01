import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Migration 016 (retention of public_intake_attempts), against real
// PostgreSQL (PGlite). The database is built from the migrations BEFORE 016
// only (pinned, so a later 017 can't silently change this fixture); rows
// written then exist when 016 runs, exactly as on the real project.
const db = new PGlite();
const owner = '30000000-0000-4000-8000-000000000001';
const otherOwner = '30000000-0000-4000-8000-000000000002';
let workshop: string;
let otherWorkshop: string;
let slug: string;
let otherSlug: string;
const RETENTION = '202610020016_public_intake_retention.sql';
const before016 = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql') && f < '202610020016').sort();
const retentionSql = () => readFileSync('supabase/migrations/' + RETENTION, 'utf8');

async function asAdmin() { await db.exec('reset role'); }
async function asUser(id: string) { await db.exec('reset role; set role authenticated;'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); }
async function addAttempt(workshopId: string, ip: string, age: string) {
  await asAdmin();
  await db.query('insert into public.public_intake_attempts(workshop_id, ip, created_at) values ($1, $2::inet, clock_timestamp() - $3::interval)', [workshopId, ip, age]);
}
async function attempts() {
  await asAdmin();
  return (await db.query<{ workshop_id: string; ip: string; recent: boolean }>("select workshop_id, host(ip) as ip, created_at > clock_timestamp() - interval '1 hour' as recent from public.public_intake_attempts order by id")).rows;
}
let phoneSeq = 0;
type Submit = { slug?: string; clientId?: string; hp?: string; startedAt?: string | null; consent?: boolean; xff?: string | null };
async function submit(ip: string | null, opts: Submit = {}) {
  await db.exec('reset role; set role anon;');
  const header = opts.xff !== undefined ? opts.xff : ip;
  await db.query("select set_config('request.headers',$1,false)", [header ? JSON.stringify({ 'x-forwarded-for': header }) : '']);
  const phone = '6' + String(10000000 + ++phoneSeq).slice(-8);
  const data = { name: 'Cliente Público', phone, brand: 'SEAT', model: 'Ibiza', plate: '', reason: 'Ruido en el motor', availability: 'Tardes' };
  return (await db.query<{ public_intake: boolean }>('select public.public_intake(p_slug=>$1, p_data=>$2::jsonb, p_messages=>$3::jsonb, p_client_id=>$4::uuid, p_hp=>$5, p_started_at=>$6::timestamptz, p_consent=>$7)',
    [opts.slug ?? slug, JSON.stringify(data), JSON.stringify([{ role: 'user', content: 'Quiero una revisión' }]), opts.clientId ?? crypto.randomUUID(), opts.hp ?? '', opts.startedAt ?? null, opts.consent ?? true])).rows[0].public_intake;
}

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key, email text unique default (gen_random_uuid()::text || '@example.invalid'));
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    insert into auth.users(id) values ('${owner}'),('${otherOwner}');`);
  for (const file of before016) await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  await asUser(owner);
  workshop = (await db.query<{ id: string }>("select public.create_workshop('Taller Retención') id")).rows[0].id;
  await asUser(otherOwner);
  otherWorkshop = (await db.query<{ id: string }>("select public.create_workshop('Taller Vecino') id")).rows[0].id;
  await asAdmin();
  slug = (await db.query<{ slug: string }>('select slug from public.workshops where id=$1', [workshop])).rows[0].slug;
  otherSlug = (await db.query<{ slug: string }>('select slug from public.workshops where id=$1', [otherWorkshop])).rows[0].slug;
  // Written before 016: one row long past the window, one still inside it.
  await addAttempt(workshop, '198.51.100.1', '3 days');
  await addAttempt(otherWorkshop, '198.51.100.2', '61 minutes');
  await addAttempt(workshop, '198.51.100.3', '10 minutes');
  await db.exec(retentionSql());
}, 180000);
afterAll(async () => { await db.close(); });

describe('migración 016: conservación de public_intake_attempts', () => {
  it('se aplica sobre la 015: borra las filas fuera de la ventana de una hora y conserva las recientes', async () => {
    expect(before016.at(-1)).toBe('202610010015_customer_erasure_complete.sql');
    expect(await attempts()).toEqual([{ workshop_id: workshop, ip: '198.51.100.3', recent: true }]);
  });
  it('el borrado puede usar el índice nuevo por created_at', async () => {
    await asAdmin();
    await db.exec('set enable_seqscan = off');
    const plan = (await db.query<{ 'QUERY PLAN': string }>("explain delete from public.public_intake_attempts where created_at <= now() - interval '1 hour'")).rows.map(r => r['QUERY PLAN']).join('\n');
    await db.exec('reset enable_seqscan');
    expect(plan).toContain('public_intake_attempts_created');
  });
  it('cada envío válido borra las filas antiguas de cualquier taller y guarda la suya', async () => {
    await addAttempt(otherWorkshop, '198.51.100.4', '2 hours');
    expect(await submit('203.0.113.10')).toBe(true);
    const rows = await attempts();
    expect(rows.map(r => r.ip)).toEqual(['198.51.100.3', '203.0.113.10']);
    expect(rows.every(r => r.recent)).toBe(true);
  });
  it('respeta el límite de la hora: borra lo de hace 61 minutos y conserva lo de hace 59', async () => {
    await addAttempt(workshop, '198.51.100.7', '61 minutes');
    await addAttempt(workshop, '198.51.100.8', '59 minutes');
    expect(await submit('203.0.113.12')).toBe(true);
    const ips = (await attempts()).map(r => r.ip);
    expect(ips).not.toContain('198.51.100.7');
    expect(ips).toContain('198.51.100.8');
  });
  it('un reintento válido de un envío ya guardado también limpia, sin añadir otra fila', async () => {
    const clientId = crypto.randomUUID();
    expect(await submit('203.0.113.11', { clientId })).toBe(true);
    await addAttempt(workshop, '198.51.100.5', '90 minutes');
    const before = (await attempts()).length;
    expect(await submit('203.0.113.11', { clientId })).toBe(true);
    const rows = await attempts();
    expect(rows.some(r => r.ip === '198.51.100.5')).toBe(false);
    expect(rows).toHaveLength(before - 1);
  });
  it('los rechazos tempranos (sin consentimiento, honeypot o envío demasiado rápido) no borran nada', async () => {
    await addAttempt(workshop, '198.51.100.9', '2 hours');
    const before = await attempts();
    await expect(submit('203.0.113.13', { consent: false })).rejects.toThrow('aviso legal');
    expect(await submit('203.0.113.13', { hp: 'bot' })).toBe(false);
    expect(await submit('203.0.113.13', { startedAt: new Date(Date.now() - 5000).toISOString() })).toBe(false);
    expect(await attempts()).toEqual(before);
  });
  it('el límite de cinco envíos por hora sigue funcionando, por taller, y las filas antiguas no cuentan', async () => {
    for (let i = 0; i < 5; i++) await addAttempt(workshop, '203.0.113.20', '2 hours');
    for (let i = 0; i < 5; i++) expect(await submit('203.0.113.20')).toBe(true);
    const before = await attempts();
    await addAttempt(workshop, '198.51.100.6', '3 hours');
    await expect(submit('203.0.113.20')).rejects.toThrow('Demasiados envíos');
    // The rejected call rolls back entirely, its purge included.
    const after = await attempts();
    expect(after.filter(r => r.ip === '203.0.113.20')).toHaveLength(5);
    expect(after.some(r => r.ip === '198.51.100.6')).toBe(true);
    expect(after).toHaveLength(before.length + 1);
    // The same IP is counted separately for another workshop, and its valid submission does the purge.
    expect(await submit('203.0.113.20', { slug: otherSlug })).toBe(true);
    expect((await attempts()).some(r => r.ip === '198.51.100.6')).toBe(false);
  });
  it('sin cabecera de IP, o con una mal formada, el envío se acepta sin guardar ninguna IP; con varias usa la primera', async () => {
    const before = (await attempts()).length;
    expect(await submit(null)).toBe(true);
    expect(await submit(null, { xff: 'not-an-ip' })).toBe(true);
    expect(await attempts()).toHaveLength(before);
    expect(await submit(null, { xff: '203.0.113.30, 10.0.0.1' })).toBe(true);
    const rows = await attempts();
    expect(rows).toHaveLength(before + 1);
    expect(rows.at(-1)!.ip).toBe('203.0.113.30');
  });
  it('volver a aplicar la migración no falla ni borra filas recientes', async () => {
    const before = await attempts();
    await asAdmin();
    await db.exec(retentionSql());
    expect(await attempts()).toEqual(before);
  });
  it('la tabla sigue cerrada a la app y a usuarios anónimos, y public_intake mantiene sus permisos', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`reset role; set role ${role};`);
      await expect(db.query('select * from public.public_intake_attempts')).rejects.toThrow('permission denied');
      await expect(db.query('delete from public.public_intake_attempts')).rejects.toThrow('permission denied');
    }
    await asAdmin();
    const fn = 'public.public_intake(text,jsonb,jsonb,uuid,text,timestamptz,boolean)';
    const grants = (await db.query<{ anon: boolean; auth: boolean; pub: boolean }>(`select has_function_privilege('anon','${fn}','execute') anon, has_function_privilege('authenticated','${fn}','execute') auth, has_function_privilege('public','${fn}','execute') pub`)).rows[0];
    expect(grants).toEqual({ anon: true, auth: true, pub: false });
  });
});

describe('migración 016: solo añade el borrado al cuerpo de public_intake de la 007', () => {
  it('el cuerpo es el de la 007 más la sentencia de borrado', () => {
    const body = (file: string) => {
      const sql = readFileSync('supabase/migrations/' + file, 'utf8').replace(/\r\n/g, '\n');
      // From the definition's argument list on: 007 says "create", 016 "create or replace".
      const start = sql.search(/create (or replace )?function public\.public_intake\(/);
      const args = sql.indexOf('public.public_intake(', start);
      return sql.slice(args, sql.indexOf('grant execute on function public.public_intake(', args));
    };
    const added = "  -- 016: rows older than the rate-limit window are never needed again (the\n  -- only change to 007's body).\n  delete from public.public_intake_attempts where created_at <= now() - interval '1 hour';\n";
    const after = body(RETENTION);
    expect(after.split(added)).toHaveLength(2);
    expect(after.replace(added, '')).toBe(body('202609230007_public_consent.sql'));
  });
});

describe('textos legales sobre el registro de la IP', () => {
  it('el aviso legal informa de la IP, su finalidad por taller, su base y el plazo de ese registro', () => {
    const text = readFileSync('src/app/r/[slug]/aviso-legal/page.tsx', 'utf8').replace(/\s+/g, ' ');
    expect(text).toContain('se registra la dirección IP desde la que lo envías, únicamente para limitar los envíos abusivos');
    expect(text).toContain('como máximo cinco envíos aceptados por hora a este taller desde una misma dirección IP');
    expect(text).toContain('interés legítimo en proteger el formulario frente a envíos abusivos');
    expect(text).toContain('deja de contar para el límite de envíos una hora después del envío y se elimina automáticamente en un envío válido posterior que reciba el servicio');
    // Not "the next" submission: one already waiting for the workshop lock may not purge it yet.
    expect(text).not.toContain('siguiente envío válido');
    expect(text).toContain('Este plazo se refiere a ese registro');
  });
  it('los términos describen el registro temporal de la IP como medida de seguridad', () => {
    const text = readFileSync('src/app/terminos/page.tsx', 'utf8').replace(/\s+/g, ' ');
    expect(text).toContain('el servicio registra temporalmente la dirección IP desde la que se envía cada solicitud, solo para limitar el número de envíos');
  });
});
