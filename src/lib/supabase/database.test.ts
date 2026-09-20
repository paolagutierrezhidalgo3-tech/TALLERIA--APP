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
async function execute(workshop: string, command: unknown) { await db.query('select public.execute_command($1::uuid,$2::jsonb)', [workshop, JSON.stringify(command)]); }
function intake(phone = '611222333', plate = '1234BCD') { return { type: 'intake', id: crypto.randomUUID(), data: { name: 'Persona Prueba', phone, brand: 'SEAT', model: 'León', plate, reason: 'Revisión de mantenimiento', availability: 'Mañanas', notes: '' }, messages: [{ role: 'user', content: 'Quiero una revisión' }] }; }
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    insert into auth.users values ('${userA}'),('${userB}'),('10000000-0000-4000-8000-000000000004');`);
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

describe('PostgreSQL: nuevas reglas de negocio',()=>{
 it.each(['600 123 456','+34 600 123 456','0034 600123456'])('normaliza %s igual que TypeScript',async phone=>{await asUser(userA);expect((await db.query<{phone:string}>('select public.normalize_phone($1) phone',[phone])).rows[0].phone).toBe('+34600123456');});
 it('deduplica clientes con prefijo y corrige la descripción de una matrícula revisada',async()=>{await asUser(userA);const cmd=intake('+34 611222333');cmd.data.model='Ibiza';await execute(workshopA,cmd);expect((await db.query('select * from public.customers')).rows).toHaveLength(1);expect((await db.query<{model:string}>('select model from public.vehicles')).rows[0].model).toBe('Ibiza');expect((await db.query("select * from public.audit_events where action='vehicle_corrected'")).rows).toHaveLength(1);});
 it('controla duplicados, datos inválidos y ediciones obsoletas sin errores SQL crudos',async()=>{await asUser(userA);const customer=(await db.query<Record<string,unknown>>('select * from public.customers limit 1')).rows[0];await expect(execute(workshopA,{type:'customer',customer:{...customer,id:crypto.randomUUID()}})).rejects.toMatchObject({code:'P0001',message:expect.stringContaining('teléfono')});await execute(workshopA,{type:'customer',customer:{...customer,name:'Nombre actualizado'}});await expect(execute(workshopA,{type:'customer',customer})).rejects.toMatchObject({code:'P0001',message:expect.stringContaining('ha cambiado')});await expect(execute(workshopA,{type:'vehicle',vehicle:{id:crypto.randomUUID(),workshop_id:workshopA,customer_id:crypto.randomUUID(),brand:'Ford',model:'Fiesta',plate:''}})).rejects.toMatchObject({code:'P0001',message:expect.stringContaining('cliente')});const workshop=(await db.query<Record<string,unknown>>('select * from public.workshops')).rows[0];await expect(execute(workshopA,{type:'settings',workshop:{...workshop,appointment_minutes:0}})).rejects.toMatchObject({code:'P0001'});await execute(workshopA,{type:'settings',workshop});await expect(execute(workshopA,{type:'settings',workshop})).rejects.toThrow('ha cambiado');});
 it('permite concurrencia entre recursos y protege el recurso ocupado',async()=>{await asUser(userA);const resource=(await db.query<Record<string,unknown>>('select * from public.resources')).rows[0];const second={...resource,id:crypto.randomUUID(),name:'Elevador 2',kind:'lift'};await execute(workshopA,{type:'resource',resource:second});await execute(workshopA,intake());const requests=(await db.query<{id:string}>("select id from public.requests where status='nueva'")).rows;const cmd={type:'appointment',id:crypto.randomUUID(),request_id:requests[0].id,resource_id:resource.id,starts_at:new Date(Date.now()+172800000).toISOString(),duration_minutes:60,notes:''};await execute(workshopA,cmd);await expect(execute(workshopA,{...cmd,id:crypto.randomUUID(),request_id:requests[1].id})).rejects.toThrow('coincide');await execute(workshopA,{...cmd,id:crypto.randomUUID(),request_id:requests[1].id,resource_id:second.id});await expect(execute(workshopA,{type:'resource',resource:{...resource,active:false}})).rejects.toThrow('citas');await expect(execute(workshopA,{type:'resource',resource:{...second,name:'Puesto principal'}})).rejects.toThrow('nombre');});
 it('staff no modifica administración ni ve auditoría, pero sí gestiona clientes',async()=>{const staff='10000000-0000-4000-8000-000000000003';await db.exec('reset role');await db.query('insert into auth.users values($1)',[staff]);await db.query("insert into public.workshop_members(workshop_id,user_id,role) values($1,$2,'staff')",[workshopA,staff]);await asUser(staff);const workshop=(await db.query<Record<string,unknown>>('select * from public.workshops')).rows[0];const resource=(await db.query<Record<string,unknown>>('select * from public.resources limit 1')).rows[0];await expect(execute(workshopA,{type:'settings',workshop})).rejects.toThrow('propietario');await expect(execute(workshopA,{type:'resource',resource})).rejects.toThrow('propietario');expect((await db.query('select * from public.audit_events')).rows).toHaveLength(0);await expect(db.query("update public.workshops set name='Intruso'")).rejects.toThrow();const customer=(await db.query<Record<string,unknown>>('select * from public.customers limit 1')).rows[0];await execute(workshopA,{type:'customer',customer:{...customer,notes:'Gestionado por staff'}});await asUser(userA);expect((await db.query<{user_id:string}>("select user_id from public.audit_events where action='customer' order by created_at desc limit 1")).rows[0].user_id).toBe(staff);});
 it('devuelve páginas acotadas y busca registros antiguos sin cargarlos todos',async()=>{await db.exec('reset role');for(let i=0;i<31;i++)await db.query("insert into public.customers(workshop_id,name,phone,phone_e164) values($1,$2,$3,$3)",[workshopB,'Cliente '+String(i).padStart(3,'0'),'+34610000'+String(i).padStart(3,'0')]);await asUser(userB);const snapshot=async(offset:number,search='')=>(await db.query<{s:{customers:unknown[];page_info:{total:number;ids:string[]}}}>("select public.workspace_snapshot($1,'customers',$2,$3) s",[workshopB,offset,search])).rows[0].s;const first=await snapshot(0),second=await snapshot(25);expect(first.customers).toHaveLength(25);expect(second.customers).toHaveLength(6);expect(first.page_info.total).toBe(31);expect(await snapshot(0,'030')).toMatchObject({page_info:{total:1}});const options=(await db.query<{o:unknown[]}>("select public.lookup_options($1,'customer','') o",[workshopB])).rows[0].o;expect(options).toHaveLength(20);await expect(db.query("select public.workspace_snapshot($1)",[workshopA])).rejects.toThrow('acceso');await expect(db.query("select public.lookup_options($1,'customer','')",[workshopA])).rejects.toThrow('acceso');});
 it('limita operaciones repetitivas sin duplicar auditoría en reintentos',async()=>{await asUser(userA);const cmd=intake();await execute(workshopA,cmd);const count=async()=>Number((await db.query<{n:string}>('select count(*) n from public.audit_events')).rows[0].n);const before=await count();await execute(workshopA,cmd);expect(await count()).toBe(before);await db.exec('reset role');await db.query("insert into public.audit_events(workshop_id,user_id,action,entity_type,entity_id) select $1,$2,'customer','customer',gen_random_uuid() from generate_series(1,100)",[workshopA,userA]);await asUser(userA);await expect(execute(workshopA,{type:'status',id:cmd.id,status:'pendiente'})).rejects.toThrow('demasiadas');expect(await count()).toBe(before+100);});
});

describe('Actualización de datos de la primera iteración',()=>{
 it('fusiona teléfonos equivalentes sin perder relaciones, citas ni datos originales',async()=>{await asUser('10000000-0000-4000-8000-000000000004');const customers=(await db.query<{id:string;phone_e164:string|null}>('select id,phone_e164 from public.customers')).rows;expect(customers).toHaveLength(2);expect(customers.filter(c=>c.phone_e164===null)).toHaveLength(1);const linked=(await db.query<{customer_id:string;vehicle_customer:string}>('select r.customer_id,v.customer_id vehicle_customer from public.requests r join public.vehicles v on v.id=r.vehicle_id')).rows;expect(linked).toHaveLength(2);expect(new Set(linked.map(r=>r.customer_id)).size).toBe(1);expect(linked.every(r=>r.customer_id===r.vehicle_customer)).toBe(true);const appt=(await db.query<{request_id:string;resource_id:string}>('select request_id,resource_id from public.appointments')).rows[0];expect(appt.request_id).toBe(legacyRequest);expect(appt.resource_id).toBeTruthy();expect((await db.query("select * from public.audit_events where action='customer_merged' and metadata ? 'original_customer'")).rows).toHaveLength(1);});
});
