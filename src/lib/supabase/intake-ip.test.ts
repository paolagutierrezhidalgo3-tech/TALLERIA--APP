import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Migration 017 (trusted client IP for public_intake's rate limit), against
// real PostgreSQL (PGlite). Built from the migrations up to 017 (pinned, so a
// later migration can't silently change this fixture).
const db = new PGlite();
const owner = '40000000-0000-4000-8000-000000000001';
const otherOwner = '40000000-0000-4000-8000-000000000002';
let workshop: string;
let otherWorkshop: string;
let slug: string;
let otherSlug: string;
const TRUSTED_IP = '202610020017_public_intake_trusted_ip.sql';
const upTo017 = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql') && f <= TRUSTED_IP).sort();

async function asAdmin() { await db.exec('reset role'); }
async function asUser(id: string) { await db.exec('reset role; set role authenticated;'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); }
async function bucket(headers: unknown) {
  await asAdmin();
  return (await db.query<{ b: string }>('select public.request_client_bucket($1)::text as b', [headers === null ? null : typeof headers === 'string' ? headers : JSON.stringify(headers)])).rows[0].b;
}
async function stored() {
  await asAdmin();
  return (await db.query<{ workshop_id: string; ip: string }>('select workshop_id, ip::text as ip from public.public_intake_attempts order by id')).rows;
}
let phoneSeq = 0;
async function submit(headers: Record<string, string> | null, targetSlug = slug) {
  await db.exec('reset role; set role anon;');
  await db.query("select set_config('request.headers',$1,false)", [headers ? JSON.stringify(headers) : '']);
  const phone = '6' + String(20000000 + ++phoneSeq).slice(-8);
  const data = { name: 'Cliente Público', phone, brand: 'SEAT', model: 'Ibiza', plate: '', reason: 'Ruido en el motor', availability: 'Tardes' };
  return (await db.query<{ public_intake: boolean }>('select public.public_intake(p_slug=>$1, p_data=>$2::jsonb, p_messages=>$3::jsonb, p_client_id=>$4::uuid, p_hp=>$5, p_started_at=>$6::timestamptz, p_consent=>$7)',
    [targetSlug, JSON.stringify(data), JSON.stringify([{ role: 'user', content: 'Quiero una revisión' }]), crypto.randomUUID(), '', null, true])).rows[0].public_intake;
}
async function clearAttempts() { await asAdmin(); await db.exec('delete from public.public_intake_attempts'); }

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key, email text unique default (gen_random_uuid()::text || '@example.invalid'));
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    insert into auth.users(id) values ('${owner}'),('${otherOwner}');`);
  for (const file of upTo017) await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  await asUser(owner);
  workshop = (await db.query<{ id: string }>("select public.create_workshop('Taller IP') id")).rows[0].id;
  await asUser(otherOwner);
  otherWorkshop = (await db.query<{ id: string }>("select public.create_workshop('Taller Otro') id")).rows[0].id;
  await asAdmin();
  slug = (await db.query<{ slug: string }>('select slug from public.workshops where id=$1', [workshop])).rows[0].slug;
  otherSlug = (await db.query<{ slug: string }>('select slug from public.workshops where id=$1', [otherWorkshop])).rows[0].slug;
}, 180000);
afterAll(async () => { await db.close(); });

describe('request_client_bucket: de dónde sale la clave del límite', () => {
  it('usa cf-connecting-ip si es una dirección válida, aunque x-forwarded-for traiga otra cosa delante', async () => {
    expect(upTo017.at(-1)).toBe(TRUSTED_IP);
    expect(await bucket({ 'cf-connecting-ip': '203.0.113.5', 'x-forwarded-for': '198.51.100.1, 203.0.113.5' })).toBe('203.0.113.5/32');
    expect(await bucket({ 'cf-connecting-ip': ' 203.0.113.5 ' })).toBe('203.0.113.5/32');
  });
  it('sin cf-connecting-ip válida usa la ÚLTIMA entrada de x-forwarded-for, nunca la primera', async () => {
    expect(await bucket({ 'x-forwarded-for': '198.51.100.1, 203.0.113.9' })).toBe('203.0.113.9/32');
    expect(await bucket({ 'x-forwarded-for': '203.0.113.9' })).toBe('203.0.113.9/32');
    expect(await bucket({ 'cf-connecting-ip': 'nope', 'x-forwarded-for': 'x, 203.0.113.9 ' })).toBe('203.0.113.9/32');
    expect(await bucket({ 'cf-connecting-ip': '203.0.113.0/24', 'x-forwarded-for': '203.0.113.9' })).toBe('203.0.113.9/32');
  });
  it('agrupa IPv6 por su prefijo /64 y trata las IPv4 mapeadas como IPv4', async () => {
    expect(await bucket({ 'cf-connecting-ip': '2001:db8:abcd:12:1:2:3:4' })).toBe('2001:db8:abcd:12::/64');
    expect(await bucket({ 'cf-connecting-ip': '2001:db8:abcd:12:ffff::1' })).toBe('2001:db8:abcd:12::/64');
    expect(await bucket({ 'cf-connecting-ip': '2001:db8:abcd:13::1' })).toBe('2001:db8:abcd:13::/64');
    expect(await bucket({ 'cf-connecting-ip': '::ffff:203.0.113.5' })).toBe('203.0.113.5/32');
  });
  it('sin ninguna dirección válida devuelve el cupo común 0.0.0.0, nunca null', async () => {
    for (const headers of [{}, { 'x-forwarded-for': 'not-an-ip' }, { 'x-forwarded-for': '203.0.113.9,' }, { 'cf-connecting-ip': '' }, '', 'not json', '[]', null]) {
      expect(await bucket(headers)).toBe('0.0.0.0/32');
    }
  });
  it('es interna: ni la app ni un visitante anónimo pueden llamarla', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`reset role; set role ${role};`);
      await expect(db.query("select public.request_client_bucket('{}')")).rejects.toThrow('permission denied');
    }
    await asAdmin();
  });
});

describe('public_intake con la IP de confianza (migración 017)', () => {
  it('rotar una primera entrada falsa de x-forwarded-for ya no evita el límite de cinco por hora', async () => {
    await clearAttempts();
    for (let i = 0; i < 5; i++) expect(await submit({ 'cf-connecting-ip': '203.0.113.50', 'x-forwarded-for': `198.51.100.${i + 1}, 203.0.113.50` })).toBe(true);
    await expect(submit({ 'cf-connecting-ip': '203.0.113.50', 'x-forwarded-for': '198.51.100.99, 203.0.113.50' })).rejects.toThrow('Demasiados envíos');
    expect((await stored()).map(r => r.ip)).toEqual(Array(5).fill('203.0.113.50/32'));
  });
  it('lo mismo sin cf-connecting-ip: cuenta la última entrada, la que añade la pasarela', async () => {
    await clearAttempts();
    for (let i = 0; i < 5; i++) expect(await submit({ 'x-forwarded-for': `198.51.100.${i + 1}, 203.0.113.60` })).toBe(true);
    await expect(submit({ 'x-forwarded-for': '198.51.100.99, 203.0.113.60' })).rejects.toThrow('Demasiados envíos');
  });
  it('una cabecera ausente o mal formada ya no se salta el límite: cae en el cupo común del taller', async () => {
    await clearAttempts();
    expect(await submit(null)).toBe(true);
    expect(await submit({ 'x-forwarded-for': 'not-an-ip' })).toBe(true);
    expect(await submit({ 'x-forwarded-for': '203.0.113.9,' })).toBe(true);
    expect(await submit({})).toBe(true);
    expect(await submit({ 'cf-connecting-ip': 'garbage' })).toBe(true);
    await expect(submit({ 'x-forwarded-for': 'still-not-an-ip' })).rejects.toThrow('Demasiados envíos');
    expect((await stored()).map(r => r.ip)).toEqual(Array(5).fill('0.0.0.0/32'));
    // The shared bucket is per workshop.
    expect(await submit(null, otherSlug)).toBe(true);
  });
  it('en IPv6 todo un /64 comparte el límite y solo se guarda el prefijo', async () => {
    await clearAttempts();
    for (let i = 0; i < 5; i++) expect(await submit({ 'cf-connecting-ip': `2001:db8:1:2::${i + 1}` })).toBe(true);
    await expect(submit({ 'cf-connecting-ip': '2001:db8:1:2:aaaa::1' })).rejects.toThrow('Demasiados envíos');
    expect(await submit({ 'cf-connecting-ip': '2001:db8:1:3::1' })).toBe(true);
    const ips = (await stored()).map(r => r.ip);
    expect(new Set(ips)).toEqual(new Set(['2001:db8:1:2::/64', '2001:db8:1:3::/64']));
    expect(ips.some(ip => ip.includes('::1') || ip.includes('aaaa'))).toBe(false);
  });
  it('conserva el borrado de la 016, el honeypot, la duración mínima, el consentimiento y el reintento idempotente', async () => {
    await clearAttempts();
    await asAdmin();
    await db.query("insert into public.public_intake_attempts(workshop_id, ip, created_at) values ($1, '198.51.100.200', clock_timestamp() - interval '2 hours')", [workshop]);
    expect(await submit({ 'cf-connecting-ip': '203.0.113.70' })).toBe(true);
    expect((await stored()).map(r => r.ip)).toEqual(['203.0.113.70/32']);
    await db.exec('reset role; set role anon;');
    await db.query("select set_config('request.headers',$1,false)", [JSON.stringify({ 'cf-connecting-ip': '203.0.113.71' })]);
    const call = (clientId: string, hp: string, startedAt: string | null, consent: boolean) => db.query<{ public_intake: boolean }>('select public.public_intake(p_slug=>$1, p_data=>$2::jsonb, p_messages=>$3::jsonb, p_client_id=>$4::uuid, p_hp=>$5, p_started_at=>$6::timestamptz, p_consent=>$7)',
      [slug, JSON.stringify({ name: 'Cliente Público', phone: '699999001', brand: 'SEAT', model: 'Ibiza', plate: '', reason: 'Ruido en el motor', availability: 'Tardes' }), JSON.stringify([{ role: 'user', content: 'Hola' }]), clientId, hp, startedAt, consent]);
    await expect(call(crypto.randomUUID(), '', null, false)).rejects.toThrow('aviso legal');
    expect((await call(crypto.randomUUID(), 'bot', null, true)).rows[0].public_intake).toBe(false);
    expect((await call(crypto.randomUUID(), '', new Date(Date.now() - 5000).toISOString(), true)).rows[0].public_intake).toBe(false);
    const id = crypto.randomUUID();
    expect((await call(id, '', null, true)).rows[0].public_intake).toBe(true);
    expect((await call(id, '', null, true)).rows[0].public_intake).toBe(true);
    expect((await stored()).filter(r => r.ip === '203.0.113.71/32')).toHaveLength(1);
  });
  it('mantiene la firma, la seguridad y los permisos de public_intake', async () => {
    await asAdmin();
    const fn = 'public.public_intake(text,jsonb,jsonb,uuid,text,timestamptz,boolean)';
    const row = (await db.query<{ anon: boolean; auth: boolean; pub: boolean; definer: boolean; versions: number }>(`select has_function_privilege('anon','${fn}','execute') anon, has_function_privilege('authenticated','${fn}','execute') auth, has_function_privilege('public','${fn}','execute') pub, (select prosecdef from pg_proc where oid='${fn}'::regprocedure) definer, (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='public_intake') versions`)).rows[0];
    expect(row).toEqual({ anon: true, auth: true, pub: false, definer: true, versions: 1 });
  });
});

describe('migración 017: solo cambia el bloque de la IP en public_intake', () => {
  it('el cuerpo es el de la 016 con el bloque de la IP sustituido por la llamada a request_client_bucket', () => {
    const body = (file: string) => {
      const sql = readFileSync('supabase/migrations/' + file, 'utf8').replace(/\r\n/g, '\n');
      const start = sql.indexOf('create or replace function public.public_intake(');
      return sql.slice(start, sql.indexOf('grant execute on function public.public_intake(', start));
    };
    const oldBlock = "  if raw_headers is not null then\n    begin\n      client_ip := nullif(trim(split_part(raw_headers::json->>'x-forwarded-for', ',', 1)), '')::inet;\n    exception when others then client_ip := null;\n    end;\n  end if;\n";
    const newBlock = "  -- 017: the rate-limit key comes from the trusted source, never from the\n  -- client-controlled first x-forwarded-for entry, and is never null (the\n  -- only change to 016's body).\n  client_ip := public.request_client_bucket(raw_headers);\n";
    const before = body('202610020016_public_intake_retention.sql');
    const after = body(TRUSTED_IP);
    expect(before.split(oldBlock)).toHaveLength(2);
    expect(after.split(newBlock)).toHaveLength(2);
    expect(after.replace(newBlock, oldBlock)).toBe(before);
  });
});

describe('aviso legal: registro de la IP con IPv6', () => {
  it('explica que en IPv6 solo se registra el prefijo de red y el límite se aplica a esa red', () => {
    const text = readFileSync('src/app/r/[slug]/aviso-legal/page.tsx', 'utf8').replace(/\s+/g, ' ');
    expect(text).toContain('Si tu conexión usa IPv6, solo se registra el prefijo de tu red (no la dirección completa) y el límite se aplica a toda esa red.');
  });
});

describe('request_client_bucket: casos límite (ronda 1 de Codex)', () => {
  it('recorta cualquier espacio en blanco alrededor de la dirección, también tabuladores y saltos de línea', async () => {
    expect(await bucket({ 'cf-connecting-ip': '\t203.0.113.5\n' })).toBe('203.0.113.5/32');
    expect(await bucket({ 'x-forwarded-for': '198.51.100.1,\t203.0.113.9\r\n' })).toBe('203.0.113.9/32');
  });
  it('con Pseudo IPv4 de Cloudflare (240.0.0.0/4) usa cf-connecting-ipv6 agrupada por /64, y sin ella el cupo común', async () => {
    expect(await bucket({ 'cf-connecting-ip': '240.16.0.9', 'cf-connecting-ipv6': '2001:db8:5:6::9' })).toBe('2001:db8:5:6::/64');
    expect(await bucket({ 'cf-connecting-ip': '240.16.0.9' })).toBe('0.0.0.0/32');
    expect(await bucket({ 'cf-connecting-ip': '240.16.0.9', 'cf-connecting-ipv6': '203.0.113.5' })).toBe('0.0.0.0/32');
    expect(await bucket({ 'cf-connecting-ip': '240.16.0.9', 'cf-connecting-ipv6': 'basura', 'x-forwarded-for': '203.0.113.9' })).toBe('0.0.0.0/32');
  });
  it('fuera de ese modo ignora cf-connecting-ipv6, así que un cliente no puede elegir su clave con ella', async () => {
    expect(await bucket({ 'cf-connecting-ip': '203.0.113.5', 'cf-connecting-ipv6': '2001:db8:dead:beef::1' })).toBe('203.0.113.5/32');
    expect(await bucket({ 'cf-connecting-ipv6': '2001:db8:dead:beef::1', 'x-forwarded-for': '203.0.113.9' })).toBe('203.0.113.9/32');
  });
  it('ignora valores desmesurados: una cf-connecting-ip de más de 64 caracteres o una x-forwarded-for de más de 2000', async () => {
    expect(await bucket({ 'cf-connecting-ip': '2001:db8::' + '1:'.repeat(30) + '1', 'x-forwarded-for': '203.0.113.9' })).toBe('203.0.113.9/32');
    expect(await bucket({ 'cf-connecting-ip': ' '.repeat(70) + '203.0.113.5' })).toBe('203.0.113.5/32');
    expect(await bucket({ 'x-forwarded-for': '198.51.100.1,'.repeat(200) + '203.0.113.9' })).toBe('0.0.0.0/32');
  });
  it('el auxiliar que analiza cada dirección también es interno', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`reset role; set role ${role};`);
      await expect(db.query("select public.request_client_address('203.0.113.5')")).rejects.toThrow('permission denied');
    }
    await asAdmin();
  });
  it('ambas funciones son immutable, sin security definer y con search_path vacío', async () => {
    await asAdmin();
    const rows = (await db.query<{ proname: string; provolatile: string; prosecdef: boolean; config: string }>("select p.proname, p.provolatile, p.prosecdef, array_to_string(p.proconfig, ',') as config from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('request_client_address','request_client_bucket') order by 1")).rows;
    expect(rows).toEqual([
      { proname: 'request_client_address', provolatile: 'i', prosecdef: false, config: 'search_path=""' },
      { proname: 'request_client_bucket', provolatile: 'i', prosecdef: false, config: 'search_path=""' },
    ]);
  });
});

describe('migración 017: reaplicación y transición desde la 016', () => {
  it('volver a aplicar la migración entera no falla y deja las funciones y permisos igual', async () => {
    await asAdmin();
    await db.exec(readFileSync('supabase/migrations/' + TRUSTED_IP, 'utf8'));
    expect(await bucket({ 'cf-connecting-ip': '2001:db8:abcd:12:1:2:3:4' })).toBe('2001:db8:abcd:12::/64');
    const fn = 'public.public_intake(text,jsonb,jsonb,uuid,text,timestamptz,boolean)';
    const row = (await db.query<{ anon: boolean; pub: boolean; versions: number }>(`select has_function_privilege('anon','${fn}','execute') anon, has_function_privilege('public','${fn}','execute') pub, (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='public_intake') versions`)).rows[0];
    expect(row).toEqual({ anon: true, pub: false, versions: 1 });
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`reset role; set role ${role};`);
      await expect(db.query("select public.request_client_bucket('{}')")).rejects.toThrow('permission denied');
    }
    await asAdmin();
  });
  it('las filas IPv6 antiguas guardadas por la 016 como dirección completa no cuentan para la nueva clave /64 y caducan con el borrado de siempre', async () => {
    await clearAttempts();
    await asAdmin();
    for (let i = 1; i <= 3; i++) await db.query("insert into public.public_intake_attempts(workshop_id, ip, created_at) values ($1, $2::inet, clock_timestamp() - interval '10 minutes')", [workshop, `2001:db8:7:7::${i}`]);
    for (let i = 0; i < 5; i++) expect(await submit({ 'cf-connecting-ip': `2001:db8:7:7::${i + 10}` })).toBe(true);
    await expect(submit({ 'cf-connecting-ip': '2001:db8:7:7::99' })).rejects.toThrow('Demasiados envíos');
    const ips = (await stored()).map(r => r.ip);
    expect(ips.filter(ip => ip === '2001:db8:7:7::/64')).toHaveLength(5);
    expect(ips.filter(ip => ip.startsWith('2001:db8:7:7::') && ip !== '2001:db8:7:7::/64')).toHaveLength(3);
  });
});

describe('aviso legal: dirección no determinable', () => {
  it('explica que los envíos sin dirección determinable comparten un límite común', () => {
    const text = readFileSync('src/app/r/[slug]/aviso-legal/page.tsx', 'utf8').replace(/\s+/g, ' ');
    expect(text).toContain('Si no se puede determinar la dirección de la conexión, esos envíos comparten un límite común.');
  });
});
