import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
const db = new PGlite();
const userA = '10000000-0000-4000-8000-000000000001';
const userB = '10000000-0000-4000-8000-000000000002';
let legacyWorkshop: string;
let legacyRequest: string;
let workshopA: string;
let workshopB: string;
async function asUser(id: string) { await db.exec("reset role; set role authenticated;"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); }
async function asAnon(ip?: string) { await db.exec('reset role; set role anon;'); await db.query("select set_config('request.headers',$1,false)", [ip ? JSON.stringify({ 'x-forwarded-for': ip }) : '']); }
async function publicIntake(slug: string, opts: { phone?: string; plate?: string; hp?: string; startedAt?: string | null; clientId?: string; messages?: { role: string; content: string }[]; consent?: boolean } = {}) {
  const clientId = opts.clientId ?? crypto.randomUUID();
  const data = { name: 'Cliente Público', phone: opts.phone ?? '655111222', brand: 'SEAT', model: 'Ibiza', plate: opts.plate ?? '', reason: 'Ruido en el motor', availability: 'Tardes' };
  const messages = opts.messages ?? [{ role: 'user', content: 'Quiero una revisión' }];
  const accepted = (await db.query<{ public_intake: boolean }>('select public.public_intake(p_slug=>$1, p_data=>$2::jsonb, p_messages=>$3::jsonb, p_client_id=>$4::uuid, p_hp=>$5, p_started_at=>$6::timestamptz, p_consent=>$7)', [slug, JSON.stringify(data), JSON.stringify(messages), clientId, opts.hp ?? '', opts.startedAt ?? null, opts.consent ?? true])).rows[0].public_intake;
  return { clientId, accepted };
}
async function execute(workshop: string, command: unknown) { await db.query('select public.execute_command($1::uuid,$2::jsonb)', [workshop, JSON.stringify(command)]); }
function intake(phone = '611222333', plate = '1234BCD') { return { type: 'intake', id: crypto.randomUUID(), data: { name: 'Persona Prueba', phone, brand: 'SEAT', model: 'León', plate, reason: 'Revisión de mantenimiento', availability: 'Mañanas', notes: '' }, messages: [{ role: 'user', content: 'Quiero una revisión' }] }; }
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key, email text unique default (gen_random_uuid()::text || '@example.invalid'));
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    insert into auth.users(id) values ('${userA}'),('${userB}'),('10000000-0000-4000-8000-000000000004');`);
  await db.exec(readFileSync('supabase/migrations/202609200001_initial.sql', 'utf8'));
  await asUser('10000000-0000-4000-8000-000000000004');
  legacyWorkshop=(await db.query<{id:string}>("select public.create_workshop('Taller heredado') id")).rows[0].id;
  const old=intake('600123456','1111BCD'); legacyRequest=old.id;
  await execute(legacyWorkshop,old);
  await execute(legacyWorkshop,intake('+34 600123456','2222BCD'));
  await execute(legacyWorkshop,{type:'appointment',id:crypto.randomUUID(),request_id:old.id,starts_at:new Date(Date.now()+86400000).toISOString(),duration_minutes:60,notes:''});
  await db.exec('reset role');
  await db.query("insert into public.customers(workshop_id,name,phone) values($1,'Revisar teléfono','1234567')",[legacyWorkshop]);
  for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&!f.includes('0001_initial')).sort()) await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  await asUser(userA);
  workshopA = (await db.query<{ id: string }>("select public.create_workshop('Taller A') as id")).rows[0].id;
  await asUser(userB);
  workshopB = (await db.query<{ id: string }>("select public.create_workshop('Taller B') as id")).rows[0].id;
}, 120000);
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
    await execute(workshopA, { type: 'appointment', request_version: 1, id, request_id: rows[0].id, starts_at, duration_minutes: 60, notes: '' });
    await expect(execute(workshopA, { type: 'appointment', request_version: 1, id: crypto.randomUUID(), request_id: rows[1].id, starts_at, duration_minutes: 60, notes: '' })).rejects.toThrow('coincide');
    await expect(execute(workshopA, { type: 'status', version: 2, id: rows[0].id, status: 'completada' })).rejects.toThrow('cita asociada');
    await execute(workshopA, { type: 'appointment_status', version: 1, request_version: 2, id, status: 'completed' });
    expect((await db.query<{ status: string }>('select status from public.requests where id=$1', [rows[0].id])).rows[0].status).toBe('completada');
  });
  it('no concede acceso anónimo', async () => {
    await db.exec('reset role; set role anon');
    await expect(db.query('select * from public.requests')).rejects.toThrow();
    await expect(execute(workshopA, intake())).rejects.toThrow();
    await expect(db.query("select public.create_workshop('Intruso')")).rejects.toThrow();
  });
});

describe('PostgreSQL: nuevas reglas de negocio',()=>{
 it.each(['600 123 456','+34 600 123 456','0034 600123456'])('normaliza %s igual que TypeScript',async phone=>{await asUser(userA);expect((await db.query<{phone:string}>('select public.normalize_phone($1) phone',[phone])).rows[0].phone).toBe('+34600123456');});
 it('deduplica clientes con prefijo y corrige la descripción de una matrícula revisada',async()=>{await asUser(userA);const cmd=intake('+34 611222333');cmd.data.model='Ibiza';await execute(workshopA,cmd);expect((await db.query('select * from public.customers')).rows).toHaveLength(1);expect((await db.query<{model:string}>('select model from public.vehicles')).rows[0].model).toBe('Ibiza');expect((await db.query("select * from public.audit_events where action='vehicle_corrected'")).rows).toHaveLength(1);});
 it('controla duplicados, datos inválidos y ediciones obsoletas sin errores SQL crudos',async()=>{await asUser(userA);const customer=(await db.query<Record<string,unknown>>('select * from public.customers limit 1')).rows[0];await expect(execute(workshopA,{type:'customer',customer:{...customer,id:crypto.randomUUID()}})).rejects.toMatchObject({code:'P0001',message:expect.stringContaining('teléfono')});await execute(workshopA,{type:'customer',customer:{...customer,name:'Nombre actualizado'}});await expect(execute(workshopA,{type:'customer',customer})).rejects.toMatchObject({code:'P0001',message:expect.stringContaining('ha cambiado')});await expect(execute(workshopA,{type:'vehicle',vehicle:{id:crypto.randomUUID(),workshop_id:workshopA,customer_id:crypto.randomUUID(),brand:'Ford',model:'Fiesta',plate:''}})).rejects.toMatchObject({code:'P0001',message:expect.stringContaining('cliente')});const workshop=(await db.query<Record<string,unknown>>('select * from public.workshops')).rows[0];await expect(execute(workshopA,{type:'settings',workshop:{...workshop,appointment_minutes:0}})).rejects.toMatchObject({code:'P0001'});await execute(workshopA,{type:'settings',workshop});await expect(execute(workshopA,{type:'settings',workshop})).rejects.toThrow('ha cambiado');});
 it('permite concurrencia entre recursos y protege el recurso ocupado',async()=>{await asUser(userA);const resource=(await db.query<Record<string,unknown>>('select * from public.resources')).rows[0];const second={...resource,id:crypto.randomUUID(),name:'Elevador 2',kind:'lift'};await execute(workshopA,{type:'resource',resource:second});await execute(workshopA,intake());const requests=(await db.query<{id:string}>("select id from public.requests where status='nueva'")).rows;const cmd={type:'appointment',request_version:1,id:crypto.randomUUID(),request_id:requests[0].id,resource_id:resource.id,starts_at:new Date(Date.now()+172800000).toISOString(),duration_minutes:60,notes:''};await execute(workshopA,cmd);await expect(execute(workshopA,{...cmd,id:crypto.randomUUID(),request_id:requests[1].id})).rejects.toThrow('coincide');await execute(workshopA,{...cmd,id:crypto.randomUUID(),request_id:requests[1].id,resource_id:second.id});await expect(execute(workshopA,{type:'resource',resource:{...resource,active:false}})).rejects.toThrow('citas');await expect(execute(workshopA,{type:'resource',resource:{...second,name:'Puesto principal'}})).rejects.toThrow('nombre');});
 it('staff no modifica administración ni ve auditoría, pero sí gestiona clientes',async()=>{const staff='10000000-0000-4000-8000-000000000003';await db.exec('reset role');await db.query('insert into auth.users(id) values($1)',[staff]);await db.query("insert into public.workshop_members(workshop_id,user_id,role) values($1,$2,'staff')",[workshopA,staff]);await asUser(staff);const workshop=(await db.query<Record<string,unknown>>('select * from public.workshops')).rows[0];const resource=(await db.query<Record<string,unknown>>('select * from public.resources limit 1')).rows[0];await expect(execute(workshopA,{type:'settings',workshop})).rejects.toThrow('propietario');await expect(execute(workshopA,{type:'resource',resource})).rejects.toThrow('propietario');expect((await db.query('select * from public.audit_events')).rows).toHaveLength(0);await expect(db.query("update public.workshops set name='Intruso'")).rejects.toThrow();const customer=(await db.query<Record<string,unknown>>('select * from public.customers limit 1')).rows[0];await execute(workshopA,{type:'customer',customer:{...customer,notes:'Gestionado por staff'}});await asUser(userA);expect((await db.query<{user_id:string}>("select user_id from public.audit_events where action='customer' order by created_at desc limit 1")).rows[0].user_id).toBe(staff);});
 it('devuelve páginas acotadas y busca registros antiguos sin cargarlos todos',async()=>{await db.exec('reset role');for(let i=0;i<31;i++)await db.query("insert into public.customers(workshop_id,name,phone,phone_e164) values($1,$2,$3,$3)",[workshopB,'Cliente '+String(i).padStart(3,'0'),'+34610000'+String(i).padStart(3,'0')]);await asUser(userB);const snapshot=async(offset:number,search='')=>(await db.query<{s:{customers:unknown[];page_info:{total:number;ids:string[]}}}>("select public.workspace_snapshot($1,'customers',$2,$3) s",[workshopB,offset,search])).rows[0].s;const first=await snapshot(0),second=await snapshot(25);expect(first.customers).toHaveLength(25);expect(second.customers).toHaveLength(6);expect(first.page_info.total).toBe(31);expect(await snapshot(0,'030')).toMatchObject({page_info:{total:1}});const options=(await db.query<{o:unknown[]}>("select public.lookup_options($1,'customer','') o",[workshopB])).rows[0].o;expect(options).toHaveLength(20);await expect(db.query("select public.workspace_snapshot($1)",[workshopA])).rejects.toThrow('acceso');await expect(db.query("select public.lookup_options($1,'customer','')",[workshopA])).rejects.toThrow('acceso');});
 it('limita operaciones repetitivas sin duplicar auditoría en reintentos',async()=>{await asUser(userA);const cmd=intake();await execute(workshopA,cmd);const count=async()=>Number((await db.query<{n:string}>('select count(*) n from public.audit_events')).rows[0].n);const before=await count();await execute(workshopA,cmd);expect(await count()).toBe(before);await db.exec('reset role');await db.query("insert into public.audit_events(workshop_id,user_id,action,entity_type,entity_id) select $1,$2,'customer','customer',gen_random_uuid() from generate_series(1,100)",[workshopA,userA]);await asUser(userA);await expect(execute(workshopA,{type:'status',id:cmd.id,status:'pendiente'})).rejects.toThrow('demasiadas');expect(await count()).toBe(before+100);});
});

describe('Actualización de datos de la primera iteración',()=>{
 it('fusiona teléfonos equivalentes sin perder relaciones, citas ni datos originales',async()=>{await asUser('10000000-0000-4000-8000-000000000004');const customers=(await db.query<{id:string;phone_e164:string|null}>('select id,phone_e164 from public.customers')).rows;expect(customers).toHaveLength(2);expect(customers.filter(c=>c.phone_e164===null)).toHaveLength(1);const linked=(await db.query<{customer_id:string;vehicle_customer:string}>('select r.customer_id,v.customer_id vehicle_customer from public.requests r join public.vehicles v on v.id=r.vehicle_id')).rows;expect(linked).toHaveLength(2);expect(new Set(linked.map(r=>r.customer_id)).size).toBe(1);expect(linked.every(r=>r.customer_id===r.vehicle_customer)).toBe(true);const appt=(await db.query<{request_id:string;resource_id:string}>('select request_id,resource_id from public.appointments')).rows[0];expect(appt.request_id).toBe(legacyRequest);expect(appt.resource_id).toBeTruthy();expect((await db.query("select * from public.audit_events where action='customer_merged' and metadata ? 'original_customer'")).rows).toHaveLength(1);});
});

describe('Mini-iteración: búsquedas y dos usuarios con la misma versión',()=>{
 const owner='10000000-0000-4000-8000-000000000005',staff='10000000-0000-4000-8000-000000000006';let workshop:string;
 beforeAll(async()=>{await db.exec('reset role');await db.query('insert into auth.users(id) values($1),($2)',[owner,staff]);await asUser(owner);workshop=(await db.query<{id:string}>("select public.create_workshop('Taller concurrencia') id")).rows[0].id;await db.exec('reset role');await db.query("insert into public.workshop_members(workshop_id,user_id,role) values($1,$2,'staff')",[workshop,staff]);});
 async function request(){await asUser(owner);const c=intake('600333222','7777BCD');c.data.name='José García Martín';c.data.model='León';c.data.reason='Revisión en León';c.messages=[{role:'user',content:'Revisión en León'}];await execute(workshop,c);return c.id;}
 it('busca sin tildes en listas y selectores, con Unicode compuesto y descompuesto',async()=>{await request();for(const [view,search] of [['customers','garcia'],['customers','martin'],['vehicles','leon'],['requests','revision'],['conversations','leon']]){const s=(await db.query<{s:{page_info:{total:number}}}>('select public.workspace_snapshot($1,$2,0,$3) s',[workshop,view,search])).rows[0].s;expect(s.page_info.total).toBe(1);}for(const [kind,search] of [['customer','GARCIA'],['request','revisión']])expect((await db.query<{o:unknown[]}>('select public.lookup_options($1,$2,$3) o',[workshop,kind,search])).rows[0].o).toHaveLength(1);for(const name of ['León','Leo\u0301n','LEÓN'])expect((await db.query<{s:string}>('select public.search_text($1) s',[name])).rows[0].s).toBe('leon');});
 it('rechaza un cambio de estado del segundo usuario y conserva el primer guardado',async()=>{const id=await request();await execute(workshop,{type:'status',id,version:1,status:'pendiente'});await asUser(staff);await expect(execute(workshop,{type:'status',id,version:1,status:'en_proceso'})).rejects.toMatchObject({code:'P0001',message:expect.stringContaining('ha cambiado')});expect((await db.query<{version:number;status:string}>('select version,status from public.requests where id=$1',[id])).rows[0]).toEqual({version:2,status:'pendiente'});await asUser(owner);expect((await db.query("select * from public.audit_events where entity_id=$1 and action='status'",[id])).rows).toHaveLength(1);});
 it('rechaza reprogramaciones y cancelaciones obsoletas y permite guardar tras refrescar',async()=>{const rid=await request();const id=crypto.randomUUID();const cmd={type:'appointment',id,request_id:rid,request_version:1,starts_at:'2035-01-02T10:00:00Z',duration_minutes:60,notes:''};await execute(workshop,cmd);await asUser(staff);await execute(workshop,{...cmd,version:1,request_version:2,starts_at:'2035-01-03T10:00:00Z'});await asUser(owner);await expect(execute(workshop,{...cmd,version:1,request_version:3})).rejects.toThrow('ha cambiado');await expect(execute(workshop,{type:'appointment_status',id,version:1,request_version:3,status:'cancelled'})).rejects.toThrow('ha cambiado');await expect(execute(workshop,{type:'appointment_status',id,version:2,request_version:2,status:'completed'})).rejects.toThrow('ha cambiado');expect((await db.query<{version:number;status:string}>('select version,status from public.appointments where id=$1',[id])).rows[0]).toEqual({version:2,status:'scheduled'});await execute(workshop,{type:'appointment_status',id,version:2,request_version:3,status:'completed'});expect((await db.query<{version:number;status:string}>('select version,status from public.requests where id=$1',[rid])).rows[0]).toEqual({version:4,status:'completada'});expect((await db.query<{version:number}>('select version from public.appointments where id=$1',[id])).rows[0].version).toBe(3);});
 it('no admite omitir versiones ni reservar desde una solicitud obsoleta',async()=>{const rid=await request();await expect(execute(workshop,{type:'status',id:rid,status:'pendiente'})).rejects.toThrow('ha cambiado');await execute(workshop,{type:'status',id:rid,version:1,status:'pendiente'});const cmd={type:'appointment',id:crypto.randomUUID(),request_id:rid,starts_at:'2035-02-01T10:00:00Z',duration_minutes:60,notes:''};await expect(execute(workshop,cmd)).rejects.toThrow('ha cambiado');await expect(execute(workshop,{...cmd,request_version:1})).rejects.toThrow('ha cambiado');await execute(workshop,{...cmd,request_version:2});await expect(execute(workshop,{...cmd,request_version:3})).rejects.toThrow('ha cambiado');await expect(execute(workshop,{type:'appointment_status',id:cmd.id,request_version:3,status:'cancelled'})).rejects.toThrow('ha cambiado');});
});

describe('Equipo: invitaciones y gestión de miembros', () => {
  const owner = '10000000-0000-4000-8000-000000000010', ownerEmail = 'owner10@example.com';
  const staffUser = '10000000-0000-4000-8000-000000000011', staffEmail = 'staff11@example.com';
  const alreadyMember = '10000000-0000-4000-8000-000000000012', alreadyMemberEmail = 'already12@example.com';
  const stranger = '10000000-0000-4000-8000-000000000013', strangerEmail = 'stranger13@example.com';
  let workshop: string, otherWorkshop: string, invitationId: string, pendingForStranger: string;
  beforeAll(async () => {
    await db.exec('reset role');
    await db.query('insert into auth.users(id,email) values($1,$2),($3,$4),($5,$6),($7,$8)', [owner, ownerEmail, staffUser, staffEmail, alreadyMember, alreadyMemberEmail, stranger, strangerEmail]);
    await asUser(owner);
    workshop = (await db.query<{ id: string }>("select public.create_workshop('Taller equipo') id")).rows[0].id;
    await db.exec('reset role');
    otherWorkshop = (await db.query<{ id: string }>("insert into public.workshops(name,slug) values('Otro taller','otro-taller') returning id")).rows[0].id;
    await db.query("insert into public.workshop_members(workshop_id,user_id,role) values($1,$2,'owner')", [otherWorkshop, alreadyMember]);
  });
  it('el propietario invita, y reinvitar el mismo correo no duplica la fila pendiente', async () => {
    await asUser(owner);
    invitationId = (await db.query<{ id: string }>('select public.invite_member($1,$2) id', [workshop, staffEmail])).rows[0].id;
    const again = (await db.query<{ id: string }>('select public.invite_member($1,$2) id', [workshop, staffEmail.toUpperCase()])).rows[0].id;
    expect(again).toBe(invitationId);
    expect((await db.query('select * from public.workshop_invitations where workshop_id=$1', [workshop])).rows).toHaveLength(1);
  });
  it('invite_member bloquea el taller con FOR NO KEY UPDATE, no FOR UPDATE, para no interbloquearse con accept_invitation', () => {
    // A genuine cross-transaction deadlock isn't reproducible with PGlite: a
    // single instance fully serializes .transaction() calls end-to-end (no
    // real interleaving), and two separate instances sharing a directory
    // don't share real transactional/lock state at all (verified manually: a
    // concurrent FOR UPDATE from a second instance didn't block, and a write
    // was silently lost — unsafe for testing). So this pins the fix at the
    // source level instead of behaviorally: FOR UPDATE here would conflict
    // with the FOR KEY SHARE lock Postgres takes on this same workshops row
    // to satisfy accept_invitation's workshop_members foreign-key check,
    // which -- while accept_invitation also holds its own invitation row
    // lock that this function's upsert waits on -- forms a lock-order cycle
    // Postgres's deadlock detector resolves by aborting one side.
    const sql = readFileSync('supabase/migrations/202609210005_team_management.sql', 'utf8');
    const fn = sql.slice(sql.indexOf('create function public.invite_member'), sql.indexOf('create function public.revoke_invitation'));
    expect(fn).toMatch(/from public\.workshops where id = p_workshop_id for no key update/);
    expect(fn).not.toMatch(/from public\.workshops where id = p_workshop_id for update\b/);
  });
  it('rechaza correo inválido, correo ya miembro del taller y correo que ya pertenece a otro taller', async () => {
    await asUser(owner);
    await expect(db.query('select public.invite_member($1,$2)', [workshop, 'no-es-un-correo'])).rejects.toThrow('correo válido');
    await expect(db.query('select public.invite_member($1,$2)', [workshop, ownerEmail])).rejects.toThrow('ya pertenece a un miembro');
    await expect(db.query('select public.invite_member($1,$2)', [workshop, alreadyMemberEmail])).rejects.toThrow('ya pertenece a otro taller');
  });
  it('solo el propietario puede invitar, y list_members no expone invitaciones a quien no es owner', async () => {
    await db.exec('reset role');
    await db.query("insert into public.workshop_members(workshop_id,user_id,role) values($1,$2,'staff')", [workshop, stranger]);
    await asUser(stranger);
    await expect(db.query('select public.invite_member($1,$2)', [workshop, 'x@example.com'])).rejects.toThrow('propietario');
    const snapshot = (await db.query<{ s: { members: unknown[]; invitations: unknown[] } }>('select public.list_members($1) s', [workshop])).rows[0].s;
    expect(snapshot.invitations).toHaveLength(0);
    expect(snapshot.members.length).toBeGreaterThan(0);
    await db.exec('reset role');
    await db.query('delete from public.workshop_members where workshop_id=$1 and user_id=$2', [workshop, stranger]);
  });
  it('un correo distinto al invitado no puede aceptar la invitación (protección contra manipular IDs)', async () => {
    await asUser(stranger);
    await expect(db.query('select public.accept_invitation($1)', [invitationId])).rejects.toThrow('otro correo');
    expect((await db.query('select * from public.workshop_members where user_id=$1', [stranger])).rows).toHaveLength(0);
  });
  it('una cuenta sin correo verificado no puede aceptar ninguna invitación', async () => {
    // NULL v_email must be rejected explicitly: `lower(NULL) <> inv.email`
    // evaluates to NULL, which `if` treats as false and would otherwise let
    // an emailless account silently accept anyone's pending invitation.
    const nullEmailUser = '10000000-0000-4000-8000-000000000015';
    await db.exec('reset role');
    await db.query('insert into auth.users(id,email) values($1,null)', [nullEmailUser]);
    await asUser(nullEmailUser);
    await expect(db.query('select public.accept_invitation($1)', [invitationId])).rejects.toThrow('otro correo');
    await db.exec('reset role');
    expect((await db.query('select * from public.workshop_members where workshop_id=$1 and user_id=$2', [workshop, nullEmailUser])).rows).toHaveLength(0);
  });
  it('el correo invitado acepta correctamente y queda como staff', async () => {
    await asUser(staffUser);
    const result = (await db.query<{ id: string }>('select public.accept_invitation($1) id', [invitationId])).rows[0].id;
    expect(result).toBe(workshop);
    expect((await db.query<{ role: string }>('select role from public.workshop_members where workshop_id=$1 and user_id=$2', [workshop, staffUser])).rows[0].role).toBe('staff');
    await asUser(owner);
    expect((await db.query<{ status: string }>('select status from public.workshop_invitations where id=$1', [invitationId])).rows[0].status).toBe('accepted');
  });
  it('no se puede aceptar dos veces, ni una invitación cancelada, ni una caducada', async () => {
    await asUser(staffUser);
    await expect(db.query('select public.accept_invitation($1)', [invitationId])).rejects.toThrow('no está disponible');
    await asUser(owner);
    const revokedId = (await db.query<{ id: string }>('select public.invite_member($1,$2) id', [workshop, 'revocada@example.com'])).rows[0].id;
    await db.query('select public.revoke_invitation($1)', [revokedId]);
    await expect(db.query('select public.accept_invitation($1)', [revokedId])).rejects.toThrow('no está disponible');
    const expiredId = (await db.query<{ id: string }>('select public.invite_member($1,$2) id', [workshop, strangerEmail])).rows[0].id;
    await db.exec('reset role');
    await db.query("update public.workshop_invitations set expires_at=now()-interval '1 day' where id=$1", [expiredId]);
    await asUser(stranger);
    await expect(db.query('select public.accept_invitation($1)', [expiredId])).rejects.toThrow('caducado');
    await asUser(owner);
    const snapshot = (await db.query<{ s: { invitations: { id: string }[] } }>('select public.list_members($1) s', [workshop])).rows[0].s;
    expect(snapshot.invitations.some(i => i.id === expiredId)).toBe(false);
  });
  it('un usuario que ya pertenece a un taller no puede aceptar otra invitación', async () => {
    await asUser(owner);
    pendingForStranger = (await db.query<{ id: string }>('select public.invite_member($1,$2) id', [workshop, strangerEmail])).rows[0].id;
    await asUser(stranger);
    await db.query("select public.create_workshop('Taller propio de stranger')");
    await expect(db.query('select public.accept_invitation($1)', [pendingForStranger])).rejects.toThrow('ya pertenece a un taller');
  });
  it('el propietario ve el equipo y las invitaciones pendientes de su taller, pero no las de otro', async () => {
    await asUser(owner);
    const snapshot = (await db.query<{ s: { members: { user_id: string; role: string }[] } }>('select public.list_members($1) s', [workshop])).rows[0].s;
    expect(snapshot.members.find(m => m.user_id === staffUser)?.role).toBe('staff');
    expect(snapshot.members.find(m => m.user_id === owner)?.role).toBe('owner');
    await asUser(alreadyMember);
    const foreignInvite = (await db.query<{ id: string }>('select public.invite_member($1,$2) id', [otherWorkshop, 'ajeno@example.com'])).rows[0].id;
    await asUser(owner);
    expect((await db.query('select * from public.workshop_invitations where id=$1', [foreignInvite])).rows).toHaveLength(0);
  });
  it('my_pending_invitation solo ve la invitación de su propio correo, y decline la retira', async () => {
    await asUser(alreadyMember);
    expect((await db.query<{ s: unknown }>('select public.my_pending_invitation() s')).rows[0].s).toBeNull();
    await asUser(stranger);
    const pending = (await db.query<{ s: { id: string; workshop_name: string } }>('select public.my_pending_invitation() s')).rows[0].s;
    expect(pending).toMatchObject({ id: pendingForStranger, workshop_name: 'Taller equipo' });
    await db.query('select public.decline_invitation($1)', [pendingForStranger]);
    expect((await db.query<{ s: unknown }>('select public.my_pending_invitation() s')).rows[0].s).toBeNull();
    await asUser(owner);
    expect((await db.query<{ status: string }>('select status from public.workshop_invitations where id=$1', [pendingForStranger])).rows[0].status).toBe('revoked');
  });
  it('el propietario retira a un miembro staff; staff no puede retirar a nadie ni al propietario', async () => {
    await asUser(staffUser);
    await expect(db.query('select public.remove_member($1,$2)', [workshop, owner])).rejects.toThrow('propietario');
    await asUser(owner);
    await expect(db.query('select public.remove_member($1,$2)', [workshop, owner])).rejects.toThrow('propietario del taller');
    await db.query('select public.remove_member($1,$2)', [workshop, staffUser]);
    expect((await db.query('select * from public.workshop_members where workshop_id=$1 and user_id=$2', [workshop, staffUser])).rows).toHaveLength(0);
    await asUser(staffUser);
    expect((await db.query('select * from public.workshops where id=$1', [workshop])).rows).toHaveLength(0);
  });
  it('revocar una invitación que ya fue aceptada no deshace la pertenencia (ventana de carrera aceptación/revocación)', async () => {
    // PGlite runs a single serialized connection, so the literal interleaving
    // (revoke reads 'pending' right before accept commits) can't be replayed
    // here; instead this drives both calls in the order the race produces —
    // acceptance wins first — and checks revoke_invitation now refuses to
    // clobber it, which is exactly the invariant the row lock in the fixed
    // function guarantees regardless of timing.
    const racer = '10000000-0000-4000-8000-000000000014', racerEmail = 'race14@example.com';
    await asUser(owner);
    const raceId = (await db.query<{ id: string }>('select public.invite_member($1,$2) id', [workshop, racerEmail])).rows[0].id;
    await db.exec('reset role');
    await db.query('insert into auth.users(id,email) values($1,$2)', [racer, racerEmail]);
    await asUser(racer);
    await db.query('select public.accept_invitation($1)', [raceId]);
    await asUser(owner);
    await expect(db.query('select public.revoke_invitation($1)', [raceId])).rejects.toThrow('ya se unió');
    expect((await db.query<{ status: string }>('select status from public.workshop_invitations where id=$1', [raceId])).rows[0].status).toBe('accepted');
    expect((await db.query("select * from public.audit_events where entity_id=$1 and action='invitation_revoked'", [raceId])).rows).toHaveLength(0);
    // own_membership RLS only lets a user see their own row, so check racer's
    // membership survived with the admin (reset role) connection, not owner's.
    await db.exec('reset role');
    expect((await db.query('select * from public.workshop_members where workshop_id=$1 and user_id=$2', [workshop, racer])).rows).toHaveLength(1);
  });
  it('el límite de 20 miembros también se aplica al aceptar invitaciones, no solo al invitar (evita superar el cupo con aceptaciones concurrentes)', async () => {
    // A workshop can validly issue invitations while under the cap and still
    // exceed it if acceptance never re-checks the count: invite 19 members,
    // then two invitations, accept the first (hits 20), and confirm the
    // second acceptance is rejected instead of pushing the workshop to 21 —
    // whether that second accept arrives sequentially or racing the first.
    const uid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const capOwner = uid(90);
    await db.exec('reset role');
    await db.query('insert into auth.users(id,email) values($1,$2)', [capOwner, 'capowner90@example.com']);
    await asUser(capOwner);
    const capWorkshop = (await db.query<{ id: string }>("select public.create_workshop('Taller al límite') id")).rows[0].id;
    await db.exec('reset role');
    for (let i = 0; i < 18; i++) {
      const fillerId = uid(91 + i);
      await db.query('insert into auth.users(id) values($1)', [fillerId]);
      await db.query("insert into public.workshop_members(workshop_id,user_id,role) values($1,$2,'staff')", [capWorkshop, fillerId]);
    }
    const firstInvitee = uid(109), secondInvitee = uid(110);
    await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [firstInvitee, 'cap-first@example.com', secondInvitee, 'cap-second@example.com']);
    await asUser(capOwner);
    const firstInv = (await db.query<{ id: string }>('select public.invite_member($1,$2) id', [capWorkshop, 'cap-first@example.com'])).rows[0].id;
    const secondInv = (await db.query<{ id: string }>('select public.invite_member($1,$2) id', [capWorkshop, 'cap-second@example.com'])).rows[0].id;
    // own_membership RLS only lets a caller see their own row, so count via
    // the admin (reset role) connection rather than whichever user is active.
    const memberCount = async () => { await db.exec('reset role'); return Number((await db.query<{ n: string }>('select count(*) n from public.workshop_members where workshop_id=$1', [capWorkshop])).rows[0].n); };
    await asUser(firstInvitee);
    await db.query('select public.accept_invitation($1)', [firstInv]);
    expect(await memberCount()).toBe(20);
    await asUser(secondInvitee);
    await expect(db.query('select public.accept_invitation($1)', [secondInv])).rejects.toThrow('admite hasta 20 miembros');
    expect(await memberCount()).toBe(20);
    await db.exec('reset role');
    expect((await db.query('select * from public.workshop_members where workshop_id=$1 and user_id=$2', [capWorkshop, secondInvitee])).rows).toHaveLength(0);
  });
});

describe('Horario estructurado: is_within_business_hours y execute_command', () => {
  // 2030-01-02 is a Wednesday (isodow 3); Europe/Madrid is UTC+1 in January.
  const owner = '10000000-0000-4000-8000-000000000020', staff = '10000000-0000-4000-8000-000000000021';
  let workshop: string;
  async function schedule(overrides: Record<string, unknown> = {}) {
    const rows = (await db.query<{ id: string; version: number }>("select id,version from public.requests where status not in ('completada','cancelada','cita_creada') order by created_at desc limit 1")).rows;
    return execute(workshop, { type: 'appointment', id: crypto.randomUUID(), request_id: rows[0].id, request_version: rows[0].version, starts_at: '2030-01-02T10:00:00Z', duration_minutes: 60, notes: '', ...overrides });
  }
  beforeAll(async () => {
    await db.exec('reset role');
    await db.query('insert into auth.users(id) values($1),($2)', [owner, staff]);
    await asUser(owner);
    workshop = (await db.query<{ id: string }>("select public.create_workshop('Taller horarios') id")).rows[0].id;
    await db.exec('reset role');
    await db.query("insert into public.workshop_members(workshop_id,user_id,role) values($1,$2,'staff')", [workshop, staff]);
  });
  it('sin horario configurado, una cita futura no está restringida', async () => {
    await asUser(owner);
    await execute(workshop, intake('622111000', '1000AAA'));
    await schedule();
    expect((await db.query('select * from public.appointments')).rows).toHaveLength(1);
  });
  it('solo el propietario configura el horario y las excepciones', async () => {
    await asUser(staff);
    await expect(execute(workshop, { type: 'workshop_hours', hours_version: 1, ranges: [] })).rejects.toThrow('propietario');
    await expect(execute(workshop, { type: 'workshop_hour_exception', exception: { id: crypto.randomUUID(), workshop_id: workshop, exception_date: '2030-06-01', closed: true } })).rejects.toThrow('propietario');
  });
  it('guarda el horario semanal en su propio contador de versión (no workshops.version) y bloquea citas fuera de tramo', async () => {
    await asUser(owner);
    const before = (await db.query<{ version: number; hours_version: number }>('select version,hours_version from public.workshops where id=$1', [workshop])).rows[0];
    await expect(execute(workshop, { type: 'workshop_hours', hours_version: before.hours_version + 1, ranges: [] })).rejects.toThrow('ha cambiado');
    await execute(workshop, { type: 'workshop_hours', hours_version: before.hours_version, ranges: [{ day_of_week: 3, opens_at: '09:00', closes_at: '14:00' }] });
    expect((await db.query('select * from public.workshop_hours where workshop_id=$1', [workshop])).rows).toHaveLength(1);
    // Guarding the fix for the "Configuración form loses unsaved edits"
    // bug: saving hours must not touch workshops.version, which is what the
    // settings form is keyed by.
    const after = (await db.query<{ version: number; hours_version: number }>('select version,hours_version from public.workshops where id=$1', [workshop])).rows[0];
    expect(after.version).toBe(before.version);
    expect(after.hours_version).toBe(before.hours_version + 1);
    await execute(workshop, intake('622111001', '1000AAB'));
    await expect(schedule({ starts_at: '2030-01-02T16:00:00Z' })).rejects.toThrow('horario configurado');
    // 11:00Z (not 10:00Z) so this doesn't collide with the appointment the
    // previous test already scheduled on the same default resource.
    await schedule({ starts_at: '2030-01-02T11:00:00Z' });
    expect((await db.query("select * from public.appointments where status='scheduled'")).rows).toHaveLength(2);
  });
  it('rechaza tramos inválidos y duplicados', async () => {
    await asUser(owner);
    const hours_version = (await db.query<{ hours_version: number }>('select hours_version from public.workshops where id=$1', [workshop])).rows[0].hours_version;
    await expect(execute(workshop, { type: 'workshop_hours', hours_version, ranges: [{ day_of_week: 9, opens_at: '09:00', closes_at: '10:00' }] })).rejects.toMatchObject({ code: 'P0001' });
    await expect(execute(workshop, { type: 'workshop_hours', hours_version, ranges: [{ day_of_week: 1, opens_at: '09:00', closes_at: '10:00' }, { day_of_week: 1, opens_at: '09:00', closes_at: '10:00' }] })).rejects.toThrow('duplicados');
  });
  it('una excepción cerrada bloquea ese día; una abierta sustituye por completo al horario semanal', async () => {
    await asUser(owner);
    await execute(workshop, intake('622111002', '1000AAC'));
    const exceptionId = crypto.randomUUID();
    await execute(workshop, { type: 'workshop_hour_exception', exception: { id: exceptionId, workshop_id: workshop, exception_date: '2030-01-09', closed: true } });
    await expect(schedule({ starts_at: '2030-01-09T10:00:00Z' })).rejects.toThrow('horario configurado');
    await expect(execute(workshop, { type: 'workshop_hour_exception', exception: { id: exceptionId, workshop_id: workshop, exception_date: '2030-01-09', closed: true } })).rejects.toThrow('ha cambiado');
    await execute(workshop, { type: 'workshop_hour_exception', exception: { id: exceptionId, workshop_id: workshop, exception_date: '2030-01-09', closed: false, opens_at: '15:00', closes_at: '18:00', version: 1 } });
    await expect(schedule({ starts_at: '2030-01-09T09:00:00Z' })).rejects.toThrow('horario configurado');
    await schedule({ starts_at: '2030-01-09T16:00:00Z' });
    await expect(execute(workshop, { type: 'workshop_hour_exception', exception: { id: crypto.randomUUID(), workshop_id: workshop, exception_date: '2030-01-09', closed: true } })).rejects.toThrow('Ya existe una excepción');
    await expect(execute(workshop, { type: 'workshop_hour_exception_delete', id: exceptionId, version: 1 })).rejects.toThrow('ha cambiado');
    await execute(workshop, { type: 'workshop_hour_exception_delete', id: exceptionId, version: 2 });
    expect((await db.query('select * from public.workshop_hour_exceptions where id=$1', [exceptionId])).rows).toHaveLength(0);
  });
  it('workspace_snapshot devuelve el horario y las excepciones próximas del taller', async () => {
    await asUser(owner);
    const snapshot = (await db.query<{ s: { hours: unknown[]; hour_exceptions: unknown[] } }>('select public.workspace_snapshot($1) s', [workshop])).rows[0].s;
    expect(snapshot.hours).toHaveLength(1);
    expect(Array.isArray(snapshot.hour_exceptions)).toBe(true);
  });
  it('una cita de 60 minutos no puede "encoger" para caber en un cierre que en realidad no alcanza, al adelantar el reloj', async () => {
    // 2030-03-31 (domingo, isodow 7) es cuando Europe/Madrid adelanta el
    // reloj: a la 01:00Z el horario local salta de las 02:00 a las 03:00.
    // Una cita de 00:30Z a 01:30Z dura 60 minutos reales pero corresponde a
    // las 01:30-03:30 en local, no a 01:30-02:30 (lo que daría sumar la
    // duración sobre la hora local ya convertida, en vez de sobre el
    // instante real). Con cierre a las 03:00, debe rechazarse por terminar
    // 30 minutos tarde en la realidad. Reemplaza el horario del taller por
    // completo, así que va al final: no debe alterar el estado que usan las
    // pruebas anteriores.
    await asUser(owner);
    const hours_version = (await db.query<{ hours_version: number }>('select hours_version from public.workshops where id=$1', [workshop])).rows[0].hours_version;
    await execute(workshop, { type: 'workshop_hours', hours_version, ranges: [{ day_of_week: 7, opens_at: '01:00', closes_at: '03:00' }] });
    await execute(workshop, intake('622111003', '1000AAD'));
    await expect(schedule({ starts_at: '2030-03-31T00:30:00Z' })).rejects.toThrow('horario configurado');
  });
  it('en una hora local ambigua (retraso de reloj) usa el desplazamiento estándar, igual que el motor de demostración en TypeScript', async () => {
    // 2030-11-03 es el domingo en que America/New_York atrasa el reloj:
    // 01:00-01:59 local ocurre dos veces (primero en EDT, luego en EST).
    // PostgreSQL resuelve ambas veces con el desplazamiento estándar
    // (EST, -05:00): la ventana real del tramo 01:00-02:00 es
    // [06:00Z, 07:00Z), no [05:00Z, 07:00Z). Debe coincidir con
    // src/lib/domain.test.ts para el mismo escenario.
    await db.exec('reset role');
    await db.query("update public.workshops set timezone='America/New_York' where id=$1", [workshop]);
    await asUser(owner);
    const hours_version = (await db.query<{ hours_version: number }>('select hours_version from public.workshops where id=$1', [workshop])).rows[0].hours_version;
    await execute(workshop, { type: 'workshop_hours', hours_version, ranges: [{ day_of_week: 7, opens_at: '01:00', closes_at: '02:00' }] });
    await execute(workshop, intake('622111004', '1000AAE'));
    await expect(schedule({ starts_at: '2030-11-03T05:30:00Z', duration_minutes: 15 })).rejects.toThrow('horario configurado');
    await schedule({ starts_at: '2030-11-03T06:30:00Z', duration_minutes: 15 });
    await db.exec('reset role');
    await db.query("update public.workshops set timezone='Europe/Madrid' where id=$1", [workshop]);
    await asUser(owner);
  });
  it('en una hora local inexistente (adelanto de reloj) no admite ninguna cita en ese tramo', async () => {
    // 2030-03-10 (domingo) America/New_York adelanta el reloj: 02:00-02:59
    // local no existe nunca, así que el tramo 02:00-03:00 colapsa a un
    // único instante real ([07:00Z, 07:00Z)) y ninguna cita cabe. Debe
    // coincidir con src/lib/domain.test.ts para el mismo escenario.
    await db.exec('reset role');
    await db.query("update public.workshops set timezone='America/New_York' where id=$1", [workshop]);
    await asUser(owner);
    const hours_version = (await db.query<{ hours_version: number }>('select hours_version from public.workshops where id=$1', [workshop])).rows[0].hours_version;
    await execute(workshop, { type: 'workshop_hours', hours_version, ranges: [{ day_of_week: 7, opens_at: '02:00', closes_at: '03:00' }] });
    await execute(workshop, intake('622111005', '1000AAF'));
    await expect(schedule({ starts_at: '2030-03-10T07:00:00Z', duration_minutes: 15 })).rejects.toThrow('horario configurado');
    await expect(schedule({ starts_at: '2030-03-10T06:30:00Z', duration_minutes: 15 })).rejects.toThrow('horario configurado');
    await db.exec('reset role');
    await db.query("update public.workshops set timezone='Europe/Madrid' where id=$1", [workshop]);
    await asUser(owner);
  });
  it('en una zona con horario de verano de 30 minutos (Lord Howe), el tramo no se desplaza como si fuera de 1 hora', async () => {
    // Australia/Lord_Howe adelanta el reloj solo 30 minutos (DST +11:00
    // frente a estándar +10:30). El 7 de enero de 2030 (lunes, isodow 1,
    // pleno verano austral) el tramo local 09:00-10:00 es
    // [2030-01-06T22:00Z, 2030-01-06T23:00Z), no [22:30Z, 23:30Z) como
    // daría asumir una diferencia de 1 hora.
    await db.exec('reset role');
    await db.query("update public.workshops set timezone='Australia/Lord_Howe' where id=$1", [workshop]);
    await asUser(owner);
    const hours_version = (await db.query<{ hours_version: number }>('select hours_version from public.workshops where id=$1', [workshop])).rows[0].hours_version;
    await execute(workshop, { type: 'workshop_hours', hours_version, ranges: [{ day_of_week: 1, opens_at: '09:00', closes_at: '10:00' }] });
    await execute(workshop, intake('622111006', '1000AAG'));
    await schedule({ starts_at: '2030-01-06T22:00:00Z', duration_minutes: 30 });
    await execute(workshop, intake('622111007', '1000AAH'));
    await expect(schedule({ starts_at: '2030-01-06T22:45:00Z', duration_minutes: 30 })).rejects.toThrow('horario configurado');
    await db.exec('reset role');
    await db.query("update public.workshops set timezone='Europe/Madrid' where id=$1", [workshop]);
    await asUser(owner);
  });
  it('en una zona que suspende el horario de verano en una fecha móvil (Ramadán), is_within_business_hours no lo calcula a partir de enero/julio', async () => {
    // Africa/Casablanca observa +01:00 casi todo el año pero lo suspende a
    // +00:00 durante el Ramadán, una ventana sin mes fijo. El viernes 15 de
    // marzo de 2024 (histórico, ya pasado, para no depender de una
    // predicción futura del calendario islámico) cae en esa suspensión: el
    // tramo local 09:00-10:00 es real [09:00Z, 10:00Z), no [08:00Z, 09:00Z).
    // is_within_business_hours no exige una fecha futura, así que se
    // comprueba directamente sin pasar por execute_command/schedule.
    await asUser(owner);
    await db.exec('reset role');
    await db.query("update public.workshops set timezone='Africa/Casablanca' where id=$1", [workshop]);
    await asUser(owner);
    const hours_version = (await db.query<{ hours_version: number }>('select hours_version from public.workshops where id=$1', [workshop])).rows[0].hours_version;
    await execute(workshop, { type: 'workshop_hours', hours_version, ranges: [{ day_of_week: 5, opens_at: '09:00', closes_at: '10:00' }] });
    // is_within_business_hours is revoked from authenticated/anon (only
    // execute_command calls it, with elevated privilege); check it here as
    // the unrestricted role, same as the migrations that created it.
    await db.exec('reset role');
    const within = (await db.query<{ ok: boolean }>("select public.is_within_business_hours($1, '2024-03-15T09:00:00Z'::timestamptz, 15) ok", [workshop])).rows[0].ok;
    const before = (await db.query<{ ok: boolean }>("select public.is_within_business_hours($1, '2024-03-15T08:00:00Z'::timestamptz, 15) ok", [workshop])).rows[0].ok;
    expect(within).toBe(true);
    expect(before).toBe(false);
    await db.exec('reset role');
    await db.query("update public.workshops set timezone='Europe/Madrid' where id=$1", [workshop]);
    await asUser(owner);
  });
  it('una edición obsoleta no puede resucitar una excepción ya eliminada', async () => {
    await asUser(owner);
    const exceptionId = crypto.randomUUID();
    await execute(workshop, { type: 'workshop_hour_exception', exception: { id: exceptionId, workshop_id: workshop, exception_date: '2030-07-01', closed: true } });
    await execute(workshop, { type: 'workshop_hour_exception_delete', id: exceptionId, version: 1 });
    await expect(execute(workshop, { type: 'workshop_hour_exception', exception: { id: exceptionId, workshop_id: workshop, exception_date: '2030-07-01', closed: false, opens_at: '09:00', closes_at: '10:00', version: 1 } })).rejects.toThrow('ya no existe');
    expect((await db.query('select * from public.workshop_hour_exceptions where id=$1', [exceptionId])).rows).toHaveLength(0);
  });
});

describe('Recepción pública: anon crea solicitudes por slug, sin acceso a nada más', () => {
  let slugA: string;
  beforeAll(async () => {
    await db.exec('reset role');
    slugA = (await db.query<{ slug: string }>('select slug from public.workshops where id=$1', [workshopA])).rows[0].slug;
    expect(slugA).toBe('taller-a');
  });
  it('un nombre cuyo slug cae justo en un guión al truncarlo a 40 caracteres no termina en guión ni aborta la creación', async () => {
    // slugify('Taller ' + 'a'.repeat(32) + ' Madrid') is 'taller-' + 32 a's +
    // '-madrid'; the hyphen before 'madrid' sits exactly at index 39, so
    // left(...,40) alone would cut right after it and leave a trailing '-',
    // which workshops_slug_format rejects.
    const longName = 'Taller ' + 'a'.repeat(32) + ' Madrid';
    const boundaryOwner = '10000000-0000-4000-8000-000000000201';
    await db.exec('reset role');
    await db.query('insert into auth.users(id) values($1)', [boundaryOwner]);
    await asUser(boundaryOwner);
    const boundaryWorkshop = (await db.query<{ id: string }>('select public.create_workshop($1) id', [longName])).rows[0].id;
    await db.exec('reset role');
    const slug = (await db.query<{ slug: string }>('select slug from public.workshops where id=$1', [boundaryWorkshop])).rows[0].slug;
    expect(slug.endsWith('-')).toBe(false);
    expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
  it('devuelve solo los datos públicos del taller por su slug, y nada para un slug inexistente', async () => {
    await asAnon();
    const info = (await db.query<{ s: { id: string; name: string } }>('select public.public_workshop_info($1) s', [slugA])).rows[0].s;
    expect(info).toMatchObject({ name: 'Taller A' });
    expect(info).not.toHaveProperty('phone');
    const missing = (await db.query<{ s: unknown }>("select public.public_workshop_info('no-existe') s")).rows[0].s;
    expect(missing).toBeNull();
  });
  it('crea la solicitud con su cliente, vehículo y conversación, es idempotente y no concede ningún otro acceso', async () => {
    await db.exec('reset role');
    const before = (await db.query('select * from public.requests where workshop_id=$1', [workshopA])).rows.length;
    await asAnon();
    const first = await publicIntake(slugA, { phone: '655222333', plate: '4321XYZ' });
    expect(first.accepted).toBe(true);
    const retry = await publicIntake(slugA, { phone: '655222333', plate: '4321XYZ', clientId: first.clientId });
    expect(retry.accepted).toBe(true);
    await db.exec('reset role');
    expect((await db.query('select * from public.requests where workshop_id=$1', [workshopA])).rows.length).toBe(before + 1);
    expect((await db.query("select * from public.audit_events where action='public_intake' and entity_id=$1", [first.clientId])).rows).toHaveLength(1);
    const conv = (await db.query<{ channel: string }>('select c.channel from public.conversations c join public.requests r on r.conversation_id=c.id where r.id=$1', [first.clientId])).rows[0];
    expect(conv.channel).toBe('public');
    const consentAt = (await db.query<{ consent_at: string | null }>('select consent_at from public.requests where id=$1', [first.clientId])).rows[0].consent_at;
    expect(consentAt).not.toBeNull();
    await asAnon();
    await expect(db.query('select * from public.requests')).rejects.toThrow();
    await expect(db.query("select public.execute_command($1::uuid,$2::jsonb)", [workshopA, JSON.stringify({ type: 'intake', id: crypto.randomUUID(), data: {}, messages: [] })])).rejects.toThrow();
    await expect(db.query('select * from public.public_intake_attempts')).rejects.toThrow();
  });
  it('sin la casilla de consentimiento marcada, no crea nada y explica el motivo (no es un heurístico silencioso)', async () => {
    await db.exec('reset role');
    const before = (await db.query('select * from public.requests where workshop_id=$1', [workshopA])).rows.length;
    await asAnon();
    await expect(publicIntake(slugA, { phone: '655777888', consent: false })).rejects.toThrow('aviso legal');
    await db.exec('reset role');
    expect((await db.query('select * from public.requests where workshop_id=$1', [workshopA])).rows.length).toBe(before);
  });
  it('una matrícula de otro cliente no revela su titularidad: se acepta como cualquier otra, sin vincularla ni tocar al dueño real, y consume el límite por IP', async () => {
    // Codex adversarial review: raising "pertenece a otro cliente" let an
    // anonymous caller distinguish "this plate exists and belongs to someone
    // else" from "unknown plate" purely from the response, and the raise
    // rolled back before the attempt counter ran, so probing was free. Both
    // must be closed: same outcome shape, and the counter still moves.
    const ip = '198.51.100.7';
    await db.exec('reset role');
    const attemptsBefore = (await db.query('select * from public.public_intake_attempts where ip=$1', [ip])).rows.length;
    const ownerBefore = (await db.query<{ customer_id: string; version: number }>("select customer_id,version from public.vehicles where workshop_id=$1 and plate='4321XYZ'", [workshopA])).rows[0];
    await asAnon(ip);
    const colliding = await publicIntake(slugA, { phone: '655999888', plate: '4321XYZ', messages: [{ role: 'user', content: 'Mi matrícula es 4321XYZ' }] });
    const fresh = await publicIntake(slugA, { phone: '655999889', plate: '9999FREE' });
    expect(colliding.accepted).toBe(true);
    expect(colliding.accepted).toBe(fresh.accepted); // indistinguishable outcome
    await db.exec('reset role');
    // The real owner's vehicle is untouched: not reassigned, not versioned.
    const ownerAfter = (await db.query<{ customer_id: string; version: number }>("select customer_id,version from public.vehicles where workshop_id=$1 and plate='4321XYZ'", [workshopA])).rows[0];
    expect(ownerAfter).toEqual(ownerBefore);
    // The new customer got their own vehicle, created without the plate.
    const newRequest = (await db.query<{ vehicle_id: string; conversation_id: string }>('select vehicle_id,conversation_id from public.requests where id=$1', [colliding.clientId])).rows[0];
    const newVehicle = (await db.query<{ plate: string; customer_id: string }>('select plate,customer_id from public.vehicles where id=$1', [newRequest.vehicle_id])).rows[0];
    expect(newVehicle.plate).toBe('');
    expect(newVehicle.customer_id).not.toBe(ownerBefore.customer_id);
    // What the visitor actually typed is preserved for staff to reconcile,
    // even though it was dropped from the vehicle record itself.
    const conv = (await db.query<{ messages: { content: string }[] }>('select messages from public.conversations where id=$1', [newRequest.conversation_id])).rows[0];
    expect(conv.messages.some(m => m.content.includes('4321XYZ'))).toBe(true);
    // Both submissions from this IP counted against the rate limit.
    const attemptsAfter = (await db.query('select * from public.public_intake_attempts where ip=$1', [ip])).rows.length;
    expect(attemptsAfter).toBe(attemptsBefore + 2);
  });
  it('el honeypot y un envío demasiado rápido no crean nada, informan del motivo solo al cliente real (no con una excepción) y no bloquean por sí solos reintentos posteriores', async () => {
    await db.exec('reset role');
    const before = (await db.query('select * from public.requests where workshop_id=$1', [workshopA])).rows.length;
    await asAnon();
    const bot = await publicIntake(slugA, { phone: '655333444', hp: 'soy-un-bot' });
    expect(bot.accepted).toBe(false);
    const tooFast = await publicIntake(slugA, { phone: '655444555', startedAt: new Date().toISOString() });
    expect(tooFast.accepted).toBe(false);
    await db.exec('reset role');
    expect((await db.query('select * from public.requests where workshop_id=$1', [workshopA])).rows.length).toBe(before);
  });
  it('un reloj del visitante adelantado al del servidor no bloquea el envío para siempre (la comprobación de tiempo mínimo ignora duraciones negativas)', async () => {
    await asAnon();
    // A device clock 5 minutes ahead of the server makes p_started_at land
    // in the future, so clock_timestamp() - p_started_at is negative -- the
    // exact case that used to satisfy "< 20 seconds" and silently reject
    // every retry from that visitor forever.
    const futureStartedAt = new Date(Date.now() + 5 * 60000).toISOString();
    const result = await publicIntake(slugA, { phone: '655666777', startedAt: futureStartedAt });
    expect(result.accepted).toBe(true);
  });
  it('limita los envíos por IP sin depender de auth.uid(), que no existe para un visitante anónimo', async () => {
    const ip = '203.0.113.9';
    for (let i = 0; i < 5; i++) { await asAnon(ip); const r = await publicIntake(slugA, { phone: '656000' + String(i).padStart(3, '0') }); expect(r.accepted).toBe(true); }
    await asAnon(ip);
    await expect(publicIntake(slugA, { phone: '656999999' })).rejects.toThrow('Demasiados envíos');
    await asAnon('203.0.113.10');
    const other = await publicIntake(slugA, { phone: '656888888' });
    expect(other.accepted).toBe(true);
  });
});
