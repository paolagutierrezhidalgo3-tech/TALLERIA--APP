import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANONYMIZED_MARKER, applyCommand, type Message, type State } from '../domain';
import { ERASED_MESSAGE, erasurePatterns, erasureRedact, redactReason } from '../erasure';
import { questions } from '../reception/provider';

// Migration 015 (complete right of erasure), against real PostgreSQL
// (PGlite). Unlike database.test.ts this database first stops at 014, so
// customers can be anonymized with 011's old command and then backfilled
// by 015, exactly as will happen on the real project.
const db = new PGlite();
const owner = '20000000-0000-4000-8000-000000000001';
const staff = '20000000-0000-4000-8000-000000000002';
const outsider = '20000000-0000-4000-8000-000000000003';
let workshop: string;
let otherWorkshop: string;
const migrations = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort();
const erasureMigration = migrations.find(f => f.includes('0015_customer_erasure_complete'))!;
const erasureSql = () => readFileSync('supabase/migrations/' + erasureMigration, 'utf8');

async function asUser(id: string) { await db.exec('reset role; set role authenticated;'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); }
async function asAdmin() { await db.exec('reset role'); }
async function execute(id: string, command: unknown) { await db.query('select public.execute_command($1::uuid,$2::jsonb)', [id, JSON.stringify(command)]); }
function conversation(answers: string[]): Message[] { return questions.flatMap((q, i) => [{ role: 'assistant' as const, content: q.prompt }, { role: 'user' as const, content: answers[i] }]); }
const PERSON = { name: 'María José López-Núñez', phone: '611 222 333', plate: '1234 bcd' };
type Person = { name: string; phone: string; plate: string; model?: string };
function intakeOf(p: Person, reason: string, extra: Partial<{ availability: string; notes: string; messages: unknown[] }> = {}) {
  return { type: 'intake', id: crypto.randomUUID(), data: { name: p.name, phone: p.phone, brand: 'SEAT', model: p.model ?? 'León', plate: p.plate.replace(/\s/g, '').toUpperCase(), reason, availability: extra.availability ?? 'Tardes, preguntar por ' + p.name, notes: extra.notes ?? 'Llamar al ' + p.phone },
    messages: extra.messages ?? conversation([p.name, p.phone, 'SEAT', p.model ?? 'León', p.plate || 'omitir', reason, extra.availability ?? 'Tardes', 'omitir']) };
}
async function customerByPhone(id: string, phone: string) { await asAdmin(); return (await db.query<{ id: string; version: number }>('select id,version from public.customers where workshop_id=$1 and phone_e164=$2', [id, phone])).rows[0]; }
async function customerById(id: string) { await asAdmin(); return (await db.query<{ id: string; version: number }>('select id,version from public.customers where id=$1', [id])).rows[0]; }
async function historyOf(customerId: string) {
  await asAdmin();
  const requests = (await db.query<{ reason: string; availability: string; notes: string; version: number }>('select reason,availability,notes,version from public.requests where customer_id=$1 order by created_at,id', [customerId])).rows;
  const conversations = (await db.query<{ messages: Message[] }>('select c.messages from public.conversations c join public.requests r on r.conversation_id=c.id and r.workshop_id=c.workshop_id where r.customer_id=$1 order by r.created_at,r.id', [customerId])).rows.map(r => r.messages);
  const appointments = (await db.query<{ notes: string; version: number }>('select a.notes,a.version from public.appointments a join public.requests r on r.id=a.request_id and r.workshop_id=a.workshop_id where r.customer_id=$1 order by a.starts_at', [customerId])).rows;
  const vehicles = (await db.query<{ brand: string; model: string; plate: string; version: number }>('select brand,model,plate,version from public.vehicles where customer_id=$1 order by id', [customerId])).rows;
  const audit = (await db.query<{ action: string; metadata: Record<string, unknown> }>("select action,metadata from public.audit_events where action in ('customer_merged','vehicle_corrected') and (entity_id=$1 or entity_id in (select id from public.vehicles where customer_id=$1)) order by created_at,id", [customerId])).rows;
  return { requests, conversations, appointments, vehicles, audit };
}
type History = Awaited<ReturnType<typeof historyOf>>;
// Text only: ids are random UUIDs and could contain any digits, including
// the audit metadata's original_customer id, so they are masked.
const textOf = (h: History) => JSON.stringify({ r: h.requests.map(r => [r.reason, r.availability, r.notes]), c: h.conversations, a: h.appointments.map(a => a.notes), v: h.vehicles.map(v => [v.brand, v.model, v.plate]), au: h.audit.map(a => a.metadata) })
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>');
const versionsOf = (h: History) => JSON.stringify({ r: h.requests.map(r => r.version), a: h.appointments.map(a => a.version), v: h.vehicles.map(v => v.version) });
const fullyErased = (messages: Message[]) => messages.length > 0 && messages.every(m => m.content === ERASED_MESSAGE && Object.keys(m).sort().join() === 'content,role');
async function addAppointment(requestId: string, notes: string, startsAt: string) {
  await asAdmin();
  const resource = (await db.query<{ id: string }>('select id from public.resources where workshop_id=$1 limit 1', [workshop])).rows[0].id;
  await db.query('insert into public.appointments(workshop_id,request_id,resource_id,starts_at,duration_minutes,notes,status) values($1,$2,$3,$4,60,$5,$6)', [workshop, requestId, resource, startsAt, notes, 'completed']);
}

let legacy: { id: string };
let legacyShort: { id: string };
let otherLegacy: { id: string };

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key, email text unique default (gen_random_uuid()::text || '@example.invalid'));
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    insert into auth.users(id) values ('${owner}'),('${staff}'),('${outsider}');`);
  // Only the migrations BEFORE 015 (pinned, so later ones never run ahead of it).
  for (const file of migrations.filter(f => f < erasureMigration)) await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  await asUser(owner);
  workshop = (await db.query<{ id: string }>("select public.create_workshop('Taller Borrado') id")).rows[0].id;
  await asUser(outsider);
  otherWorkshop = (await db.query<{ id: string }>("select public.create_workshop('Taller Ajeno') id")).rows[0].id;
  await asAdmin();
  await db.query("insert into public.workshop_members(workshop_id,user_id,role) values($1,$2,'staff')", [workshop, staff]);

  // Anonymized with 011 (old command): a full 8-answer conversation, a
  // merge audit event, and an appointment note that names the customer.
  await asUser(owner);
  const first = intakeOf(PERSON, 'Revisión de frenos para María, matrícula 1234-BCD, tel. +34611222333');
  await execute(workshop, first);
  const c = await customerByPhone(workshop, '+34611222333');
  await addAppointment(first.id, 'María José avisó que llega tarde; LÓPEZ paga con tarjeta', '2030-01-02T10:00:00Z');
  await asAdmin();
  await db.query("insert into public.audit_events(workshop_id,action,entity_type,entity_id,metadata) values($1,'customer_merged','customer',$2,$3)", [workshop, c.id, JSON.stringify({ original_customer: { id: crypto.randomUUID(), name: 'Mª José López', phone: '+34 600 999 888', notes: 'duplicado' } })]);
  await asUser(owner);
  await execute(workshop, { type: 'customer_anonymize', id: c.id, version: c.version });
  legacy = c;
  // Anonymized with 011, but its conversation isn't a full guided intake:
  // nothing can be related to it safely beyond the conversation itself.
  const shortIntake = intakeOf({ name: 'Pedro Ruiz', phone: '622 333 444', plate: '' }, 'Pedro Ruiz quiere cambio de aceite', { messages: [{ role: 'user', content: 'Soy Pedro Ruiz, 622333444' }] });
  await execute(workshop, shortIntake);
  const short = await customerByPhone(workshop, '+34622333444');
  await asUser(owner);
  await execute(workshop, { type: 'customer_anonymize', id: short.id, version: short.version });
  legacyShort = short;
  // Another workshop's anonymized customer: backfilled on its own data only.
  await asUser(outsider);
  const foreign = intakeOf({ name: 'Ana Gil', phone: '633 444 555', plate: '5678 FGH' }, 'Ana Gil: revisar el aire acondicionado');
  await execute(otherWorkshop, foreign);
  const f = await customerByPhone(otherWorkshop, '+34633444555');
  await asUser(outsider);
  await execute(otherWorkshop, { type: 'customer_anonymize', id: f.id, version: f.version });
  otherLegacy = f;

  await asAdmin();
  await db.exec(erasureSql());
}, 180000);
afterAll(async () => { await db.close(); });

describe('migración 015: borrado del historial de clientes ya anonimizados', () => {
  it('limpia la conversación, la disponibilidad, las notas, los datos conocidos del motivo y de la cita, y la auditoría de unificación', async () => {
    const h = await historyOf(legacy.id);
    expect(fullyErased(h.conversations[0])).toBe(true);
    expect(h.conversations[0]).toHaveLength(16);
    expect(h.requests[0].availability).toBe('Eliminada');
    expect(h.requests[0].notes).toBe('');
    expect(h.requests[0].reason).toBe('Revisión de frenos para [dato eliminado], matrícula [dato eliminado], tel. [dato eliminado]');
    expect(h.appointments[0].notes).toBe('[dato eliminado] [dato eliminado] avisó que llega tarde; [dato eliminado] paga con tarjeta');
    expect(h.audit.map(a => a.metadata)).toEqual([{ original_customer: { id: expect.any(String) }, personal_data_erased: true }]);
    expect(textOf(h)).not.toMatch(/María|José|López|Núñez|LÓPEZ|611|1234|600 999/);
  });
  it('sin una conversación guiada completa no relaciona más datos: limpia lo que es suyo y deja el motivo', async () => {
    const h = await historyOf(legacyShort.id);
    expect(h.conversations[0]).toEqual([{ role: 'user', content: ERASED_MESSAGE }]);
    expect(h.requests[0].availability).toBe('Eliminada');
    expect(h.requests[0].notes).toBe('');
    expect(h.requests[0].reason).toBe('Pedro Ruiz quiere cambio de aceite');
  });
  it('también limpia a los clientes ya anonimizados de otro taller, cada uno con sus propios datos', async () => {
    const h = await historyOf(otherLegacy.id);
    expect(h.requests[0].reason).toBe('[dato eliminado]: revisar el aire acondicionado');
    expect(fullyErased(h.conversations[0])).toBe(true);
  });
  it('volver a aplicar la migración no cambia ni el contenido ni las versiones', async () => {
    const before = await Promise.all([legacy, legacyShort, otherLegacy].map(c => historyOf(c.id)));
    await asAdmin();
    await db.exec(erasureSql());
    const after = await Promise.all([legacy, legacyShort, otherLegacy].map(c => historyOf(c.id)));
    expect(after.map(h => textOf(h) + versionsOf(h))).toEqual(before.map(h => textOf(h) + versionsOf(h)));
  });
});

describe('customer_anonymize con la migración 015', () => {
  it('borra los datos personales del historial conservando lo útil, sin tocar a otros clientes', async () => {
    await asUser(owner);
    const p = { name: 'Lucía Fernández', phone: '644 555 666', plate: '9876 KLM' };
    const cmd = intakeOf(p, 'Lucía Fernández: cambio de pastillas (9876KLM), tel. +34644555666', { notes: 'Su número es 644-555-666' });
    await execute(workshop, cmd);
    const bystander = intakeOf({ name: 'Lucas Fernández', phone: '655 666 777', plate: '' }, 'Revisión general de Lucas Fernández');
    await execute(workshop, bystander);
    await addAppointment(cmd.id, 'Lucía trae el coche a las 9; llamar al 644555666', '2030-01-03T10:00:00Z');
    const c = await customerByPhone(workshop, '+34644555666');
    const other = await customerByPhone(workshop, '+34655666777');
    const otherBefore = await historyOf(other.id);
    const before = await historyOf(c.id);
    await asUser(staff);
    await expect(execute(workshop, { type: 'customer_anonymize', id: c.id, version: c.version })).rejects.toThrow('propietario');
    await asUser(owner);
    await expect(execute(workshop, { type: 'customer_anonymize', id: c.id, version: 999 })).rejects.toThrow('ha cambiado');
    expect(textOf(await historyOf(c.id))).toBe(textOf(before));
    await asUser(owner);
    await execute(workshop, { type: 'customer_anonymize', id: c.id, version: c.version });
    const h = await historyOf(c.id);
    expect(h.requests[0].reason).toBe('[dato eliminado]: cambio de pastillas ([dato eliminado]), tel. [dato eliminado]');
    expect(h.requests[0].version).toBe(before.requests[0].version + 1);
    expect(h.appointments[0].notes).toBe('[dato eliminado] trae el coche a las 9; llamar al [dato eliminado]');
    expect(h.appointments[0].version).toBe(before.appointments[0].version + 1);
    expect(fullyErased(h.conversations[0])).toBe(true);
    expect(textOf(h)).not.toMatch(/Lucía|644|9876/);
    expect(h.vehicles).toMatchObject([{ brand: 'SEAT', model: 'León', plate: '' }]);
    const otherAfter = await historyOf(other.id);
    expect(textOf(otherAfter) + versionsOf(otherAfter)).toBe(textOf(otherBefore) + versionsOf(otherBefore));
    // Anonymizing again rewrites nothing in the history.
    const again = await customerById(c.id);
    await asUser(owner);
    await execute(workshop, { type: 'customer_anonymize', id: c.id, version: again.version });
    const twice = await historyOf(c.id);
    expect(textOf(twice) + versionsOf(twice)).toBe(textOf(h) + versionsOf(h));
  });
  it('anonimiza la marca y el modelo del vehículo y la auditoría de corrección, y matrículas cortas', async () => {
    await asUser(owner);
    const p = { name: 'Iker Sanz', phone: '611 000 111', plate: 'AB1', model: 'Golf de Iker Sanz' };
    await execute(workshop, intakeOf(p, 'Iker Sanz: revisión del ab1'));
    await asUser(owner);
    await execute(workshop, intakeOf({ ...p, model: 'Golf' }, 'Otra revisión (AB 1)'));
    const c = await customerByPhone(workshop, '+34611000111');
    let h = await historyOf(c.id);
    expect(h.audit).toMatchObject([{ action: 'vehicle_corrected', metadata: { previous_model: 'Golf de Iker Sanz' } }]);
    await asAdmin();
    await db.query("update public.vehicles set brand='SEAT (Iker)' where customer_id=$1", [c.id]);
    await asUser(owner);
    await execute(workshop, { type: 'customer_anonymize', id: c.id, version: c.version });
    h = await historyOf(c.id);
    expect(h.vehicles).toMatchObject([{ brand: 'SEAT ([dato eliminado])', model: 'Golf', plate: '' }]);
    expect(h.audit[0].metadata).toMatchObject({ previous_brand: 'SEAT', previous_model: 'Golf de [dato eliminado]' });
    expect(h.requests.map(r => r.reason)).toEqual(['[dato eliminado]: revisión del [dato eliminado]', 'Otra revisión ([dato eliminado])']);
  });
  it('borra también las solicitudes de la recepción pública, sin propiedades extra en los mensajes', async () => {
    await asAdmin();
    const slug = (await db.query<{ slug: string }>('select slug from public.workshops where id=$1', [workshop])).rows[0].slug;
    const p = { name: 'Eva Ruiz', phone: '611 222 999' };
    const messages = [...conversation([p.name, p.phone, 'Kia', 'Rio', 'omitir', 'Ruido de Eva Ruiz', 'Tardes', 'omitir']), { role: 'assistant', content: 'Gracias, Eva Ruiz', phone: '+34611222999' }];
    await db.exec('reset role; set role anon;');
    await db.query("select set_config('request.headers',$1,false)", [JSON.stringify({ 'x-forwarded-for': '203.0.113.9' })]);
    const accepted = (await db.query<{ public_intake: boolean }>('select public.public_intake(p_slug=>$1, p_data=>$2::jsonb, p_messages=>$3::jsonb, p_client_id=>$4::uuid, p_hp=>$5, p_started_at=>$6::timestamptz, p_consent=>$7)', [slug, JSON.stringify({ name: p.name, phone: p.phone, brand: 'Kia', model: 'Rio', plate: '', reason: 'Ruido de Eva Ruiz', availability: 'Tardes', notes: '' }), JSON.stringify(messages), crypto.randomUUID(), '', null, true])).rows[0].public_intake;
    expect(accepted).toBe(true);
    const c = await customerByPhone(workshop, '+34611222999');
    await asUser(owner);
    await execute(workshop, { type: 'customer_anonymize', id: c.id, version: c.version });
    const h = await historyOf(c.id);
    expect(fullyErased(h.conversations[0])).toBe(true);
    expect(h.conversations[0]).toHaveLength(17);
    expect(h.requests[0].reason).toBe('Ruido de [dato eliminado]');
  });
  it('recorta al máximo permitido cuando la sustitución alarga el texto', async () => {
    await asUser(owner);
    const cmd = intakeOf({ name: 'Ana Gil', phone: '622 111 000', plate: '' }, 'Ana '.repeat(499) + 'fin');
    await execute(workshop, cmd);
    await addAppointment(cmd.id, 'Gil '.repeat(500), '2030-01-05T10:00:00Z');
    const c = await customerByPhone(workshop, '+34622111000');
    await asUser(owner);
    await execute(workshop, { type: 'customer_anonymize', id: c.id, version: c.version });
    const h = await historyOf(c.id);
    expect(Array.from(h.requests[0].reason)).toHaveLength(2000);
    expect(Array.from(h.appointments[0].notes)).toHaveLength(2000);
  });
  it('las funciones internas de borrado no se pueden llamar directamente desde la app ni de forma anónima', async () => {
    for (const sql of ["select public.erase_customer_personal_data($1::uuid,$1::uuid)", "select public.erasure_patterns('{}','{}','{}')", "select public.erasure_redact('x','{}')", "select public.erasure_term_pattern('x','name')"]) {
      await asUser(owner);
      await expect(db.query(sql, sql.includes('$1') ? [workshop] : [])).rejects.toThrow('permission denied');
      await db.exec('reset role; set role anon;');
      await expect(db.query(sql, sql.includes('$1') ? [workshop] : [])).rejects.toThrow('permission denied');
    }
    await asAdmin();
  });
});

describe('paridad exacta entre la demo (TypeScript) y PostgreSQL', () => {
  const cases: { names: string[]; phones: string[]; plates: string[]; texts: string[] }[] = [
    { names: ['María José López-Núñez', '  Mª   José\tLÓPEZ ', 'Cliente anonimizado'], phones: ['+34 611 222 333', '611-222-333', '00000000', '123'], plates: ['1234 bcd', '1234-BCD', 'omitir', 'ABCD'],
      texts: ['María José llamó; LÓPEZ y lópez paga. López-Núñez: 611222333, +34 611 222 333, (611) 222-333, 611.222.333, 6112223334, +34611222333', 'Matrícula 1234 BCD / 1234bcd / X1234BCD / abcd', 'Mañana a las 9 con Anabel', 'María', ''] },
    { names: ['Ana', 'Del Río', 'Juan de los Santos', 'O\'Brien (hijo)', 'Ñoño Pérez'], phones: ['(+34) 600.111.222', '600111222', '0034600111222', '+442079460958'], plates: ['M-1234-AB', 'AB1', 'ñu-12'],
      texts: ['Ana y Banana; Del Río; Santos; los demás', 'O\'Brien (hijo) vino; ñoño ÑOÑO', 'Llamar 600 111 222 o 600111222x o +44 20 7946 0958', 'm 1234 ab, ab 1, AB12, ÑU-12'] },
    { names: ['Иван Петров', 'Anał', 'Ana', 'Zoë O’Neil', 'x', '😀x', 'NÚÑEZ'], phones: [], plates: ['ÄÖ-99'],
      texts: ['Иван, ИВАН; Anał y Aná y Anała', '«Ana» “Ana”, Ana… Ana—Zoë O’Neil; x 😀x', 'NÚÑEZ y NÚÑEZ; äö 99'] },
    { names: ['Ana Mora', 'Luis Peña Rey'], phones: ['611 222 333', '+34 699 000 111'], plates: ['AB 1', '1234 bcd'],
      texts: ['Avisar a Ana hoy; Ana Mora vino; Luis Peña Rey', 'Revisar AB 1 y AB 1 y 1234 BCD', 'tel. +34 611 222 333 o 0034 699 000 111'] },
  ];
  it('erasure_patterns y erasure_redact producen exactamente lo mismo que erasure.ts', async () => {
    await asAdmin();
    for (const c of cases) {
      const sqlPatterns = (await db.query<{ p: string[] }>('select public.erasure_patterns($1,$2,$3) p', [c.names, c.phones, c.plates])).rows[0].p;
      expect(sqlPatterns).toEqual(erasurePatterns(c.names, c.phones, c.plates));
      for (const text of c.texts) {
        const sql = (await db.query<{ t: string }>('select public.erasure_redact($1,$2) t', [text, sqlPatterns])).rows[0].t;
        expect(sql).toBe(erasureRedact(text, sqlPatterns));
      }
    }
    const redacted = erasureRedact(cases[0].texts[0], erasurePatterns(cases[0].names, cases[0].phones, cases[0].plates));
    expect(redacted).not.toMatch(/María|José|López|LÓPEZ|lópez|Núñez/);
    // Every format of the known number is gone; a different, longer number isn't touched.
    expect(redacted.match(/611/g)).toEqual(['611']);
    expect(redacted).toContain(', 6112223334,');
    expect(erasureRedact('Mañana a las 9 con Anabel', erasurePatterns(['Ana'], [], []))).toBe('Mañana a las 9 con Anabel');
  });
  it('el mismo cliente anonimizado en la demo y en SQL deja el mismo historial', async () => {
    const p = { name: 'Jorge Álvarez', phone: '677 888 999', plate: '4321 XYZ' };
    const cmd = intakeOf(p, 'Jorge Álvarez: ruido al frenar, 4321XYZ', { notes: 'Contactar al 677 888 999' });
    await asUser(owner);
    await execute(workshop, cmd);
    await addAppointment(cmd.id, 'Álvarez confirma por teléfono (+34677888999)', '2030-01-04T10:00:00Z');
    const c = await customerByPhone(workshop, '+34677888999');
    await asUser(owner);
    await execute(workshop, { type: 'customer_anonymize', id: c.id, version: c.version });
    const sql = await historyOf(c.id);

    const base: State = { workshop: { version: 1, hours_version: 1, id: crypto.randomUUID(), name: 'Demo', phone: '', address: '', hours: '', timezone: 'Europe/Madrid', appointment_minutes: 60 }, customers: [], vehicles: [], conversations: [], requests: [], appointments: [], resources: [], audit: [], role: 'owner' };
    let s = applyCommand(base, { type: 'intake', id: cmd.id, data: cmd.data, messages: cmd.messages as Message[] }, new Date('2030-01-01T08:00:00Z'));
    s.appointments.push({ id: crypto.randomUUID(), workshop_id: s.workshop.id, request_id: cmd.id, starts_at: '2030-01-04T10:00:00Z', duration_minutes: 60, status: 'completed', notes: 'Álvarez confirma por teléfono (+34677888999)', version: 1 });
    s = applyCommand(s, { type: 'customer_anonymize', id: s.customers[0].id, version: s.customers[0].version }, new Date('2030-01-01T09:00:00Z'));
    expect(s.customers[0].notes.startsWith(ANONYMIZED_MARKER)).toBe(true);
    expect({ reason: s.requests[0].reason, availability: s.requests[0].availability, notes: s.requests[0].notes, messages: s.conversations[0].messages, appointment: s.appointments[0].notes, vehicle: [s.vehicles[0].brand, s.vehicles[0].model, s.vehicles[0].plate] })
      .toEqual({ reason: sql.requests[0].reason, availability: sql.requests[0].availability, notes: sql.requests[0].notes, messages: sql.conversations[0], appointment: sql.appointments[0].notes, vehicle: [sql.vehicles[0].brand, sql.vehicles[0].model, sql.vehicles[0].plate] });
    expect(redactReason('Jorge', erasurePatterns([p.name], [], []))).toBe('[dato eliminado]');
    expect(redactReason('   ab  ', [])).toBe('Motivo eliminado');
  });
});

describe('migración 015: solo cambia la rama de anonimización de execute_command', () => {
  it('el cuerpo es el de la 011 más la llamada a erase_customer_personal_data', () => {
    const body = (file: string) => {
      const sql = readFileSync('supabase/migrations/' + file, 'utf8').replace(/\r\n/g, '\n');
      const start = sql.indexOf('create or replace function public.execute_command');
      return sql.slice(start, sql.indexOf('grant execute on function public.execute_command(uuid,jsonb) to authenticated;', start));
    };
    const before = body('202609260011_customer_erasure.sql');
    const after = body(erasureMigration);
    const added = "    -- 015: scrub the history first, while the record still holds its real\n    -- name/phone/plates (the only change to 011's body).\n    perform public.erase_customer_personal_data(p_workshop_id, item_id);\n";
    expect(after.split(added)).toHaveLength(2);
    expect(after.replace(added, '')).toBe(before);
  });
});
