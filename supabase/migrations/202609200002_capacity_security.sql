-- Upgrade the first MVP in place. Apply AFTER 202609200001_initial.sql.
begin;
create function public.normalize_phone(p_phone text, p_country text default 'ES') returns text
language plpgsql immutable set search_path='' as $$
declare p text := trim(p_phone);
begin
  if p is null or p='' or length(p)>32 or p !~ '^[+0-9 ().-]+$' then raise exception 'Introduce un teléfono válido, sin extensiones.'; end if;
  p := regexp_replace(p,'[ ().-]','','g');
  if left(p,2)='00' then p := '+' || substr(p,3); end if;
  if left(p,1)<>'+' then
    if p_country is distinct from 'ES' then raise exception 'Incluye el prefijo internacional con +.'; end if;
    if p !~ '^[6-9][0-9]{8}$' then raise exception 'El teléfono español debe tener 9 cifras y empezar por 6, 7, 8 o 9.'; end if;
    p := '+34' || p;
  end if;
  if p !~ '^\+[1-9][0-9]{6,14}$' then raise exception 'Introduce un teléfono internacional válido (máximo 15 cifras).'; end if;
  if left(p,3)='+34' and p !~ '^\+34[6-9][0-9]{8}$' then raise exception 'El teléfono español debe tener 9 cifras y empezar por 6, 7, 8 o 9.'; end if;
  return p;
end $$;
create function public.try_normalize_phone(p_phone text) returns text
language plpgsql immutable set search_path='' as $$
begin return public.normalize_phone(p_phone);
exception when raise_exception then return null;
end $$;
revoke all on function public.normalize_phone(text,text),public.try_normalize_phone(text) from public,anon;
grant execute on function public.normalize_phone(text,text),public.try_normalize_phone(text) to authenticated;

alter table public.workshops add column version integer not null default 1;
alter table public.customers add column version integer not null default 1;
alter table public.vehicles add column version integer not null default 1;
create table public.resources (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  name text not null check(length(trim(name)) between 2 and 100),
  kind text not null default 'bay' check(kind in ('bay','mechanic','lift')),
  active boolean not null default true,
  version integer not null default 1,
  unique(workshop_id,id)
);
create unique index resources_name_unique on public.resources(workshop_id,lower(trim(name)));
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  metadata jsonb not null default '{}'
);
create index audit_tenant_time on public.audit_events(workshop_id,created_at desc,id);
create index audit_rate_limit on public.audit_events(workshop_id,user_id,created_at desc);
alter table public.resources enable row level security;
alter table public.audit_events enable row level security;
create policy tenant_resources on public.resources for select to authenticated using(workshop_id in(select workshop_id from public.workshop_members where user_id=(select auth.uid())));
create policy owner_audit on public.audit_events for select to authenticated using(workshop_id in(select workshop_id from public.workshop_members where user_id=(select auth.uid()) and role='owner'));
revoke all on public.resources,public.audit_events from public,anon,authenticated;
grant select on public.resources,public.audit_events to authenticated;
insert into public.resources(workshop_id,name) select id,'Puesto principal' from public.workshops;
alter table public.appointments add column resource_id uuid;
update public.appointments a set resource_id=r.id from public.resources r where r.workshop_id=a.workshop_id;
alter table public.appointments alter column resource_id set not null;
alter table public.appointments add constraint appointments_resource_tenant_fkey foreign key(workshop_id,resource_id) references public.resources(workshop_id,id);
create index appointments_resource_schedule on public.appointments(workshop_id,resource_id,starts_at) where status='scheduled';

-- Keep legacy invalid numbers for human review. Canonical duplicates are merged
-- deterministically; original customer fields remain in owner-only audit metadata.
lock table public.customers,public.vehicles,public.requests in access exclusive mode;
alter table public.customers drop constraint customers_workshop_id_phone_normalized_key;
alter table public.customers add column phone_e164 text;
update public.customers set phone_e164=public.try_normalize_phone(phone);
do $$ declare item record;
begin
  for item in select conrelid::regclass as tbl,conname from pg_constraint where contype='f' and conrelid in('public.requests'::regclass,'public.vehicles'::regclass) loop
    execute format('alter table %s alter constraint %I deferrable initially immediate',item.tbl,item.conname);
  end loop;
end $$;
set constraints all deferred;
do $$ declare item record; keeper uuid;
begin
  for item in select c.* from public.customers c where c.phone_e164 is not null order by c.workshop_id,c.phone_e164,c.id loop
    select id into keeper from public.customers where workshop_id=item.workshop_id and phone_e164=item.phone_e164 order by id limit 1;
    if item.id<>keeper then
      insert into public.audit_events(workshop_id,action,entity_type,entity_id,metadata)
      values(item.workshop_id,'customer_merged','customer',keeper,jsonb_build_object('original_customer',to_jsonb(item)));
      update public.requests set customer_id=keeper where workshop_id=item.workshop_id and customer_id=item.id;
      update public.vehicles set customer_id=keeper where workshop_id=item.workshop_id and customer_id=item.id;
      delete from public.customers where id=item.id;
    end if;
  end loop;
end $$;
set constraints all immediate;
update public.customers set phone=phone_e164 where phone_e164 is not null;
insert into public.audit_events(workshop_id,action,entity_type,entity_id)
select workshop_id,'phone_review_required','customer',id from public.customers where phone_e164 is null;
create unique index customers_phone_e164_unique on public.customers(workshop_id,phone_e164) where phone_e164 is not null;
alter table public.customers add constraint phone_canonical_matches check(phone_e164 is null or phone_e164=public.normalize_phone(phone));
create index customers_tenant_name on public.customers(workshop_id,name,id);
create index vehicles_tenant_brand on public.vehicles(workshop_id,brand,id);
create function public.valid_text(d jsonb,k text,lo integer,hi integer) returns boolean language sql immutable set search_path='' as $$ select coalesce(jsonb_typeof(d->k)='string' and length(trim(d->>k)) between lo and hi,false) $$;
revoke all on function public.valid_text(jsonb,text,integer,integer) from public,anon,authenticated;
create or replace function public.create_workshop(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare w uuid; u uuid := auth.uid();
begin
  if u is null then raise exception 'Debes iniciar sesión.'; end if;
  if p_name is null or length(trim(p_name)) not between 2 and 100 then raise exception 'El nombre debe tener entre 2 y 100 caracteres.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text, 0));
  select workshop_id into w from public.workshop_members where user_id = u;
  if w is not null then return w; end if;
  insert into public.workshops(name) values(trim(p_name)) returning id into w;
  insert into public.workshop_members(workshop_id,user_id) values(w,u);
  insert into public.resources(workshop_id,name) values(w,'Puesto principal');
  insert into public.audit_events(workshop_id,user_id,action,entity_type,entity_id) values(w,u,'workshop_created','workshop',w);
  return w;
end $$;
revoke all on function public.create_workshop(text) from public, anon;
grant execute on function public.create_workshop(text) to authenticated;

create or replace function public.execute_command(p_workshop_id uuid, p_command jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  kind text := p_command->>'type';
  d jsonb;
  c_id uuid;
  v_id uuid;
  conv_id uuid;
  item_id uuid;
  req_id uuid;
  plate_value text;
  start_value timestamptz;
  duration_value integer;
  target_status text;
  current_status text;
  message jsonb;
  actor_role text;
  resource_value uuid;
  owner_customer_id uuid;
  current_version integer;
  target_entity text;
  target_id uuid;
begin
  select role into actor_role from public.workshop_members where workshop_id=p_workshop_id and user_id=auth.uid() for share;
  if actor_role is null then raise exception 'No tienes acceso a este taller.' using errcode='42501'; end if;
  if kind in ('settings','resource') and actor_role<>'owner' then raise exception 'Solo el propietario puede realizar esta operación.'; end if;
  if p_command is null or jsonb_typeof(p_command)<>'object' or octet_length(p_command::text)>65536 then raise exception 'La operación contiene demasiados datos o no es válida.'; end if;
  perform 1 from public.workshops where id=p_workshop_id for update;
  if kind='intake' and exists(select 1 from public.requests where workshop_id=p_workshop_id and id=(p_command->>'id')::uuid) then return; end if;
  if (select count(*) from public.audit_events where workshop_id=p_workshop_id and user_id=auth.uid() and created_at>clock_timestamp()-interval '1 minute')>=100
    or (kind='intake' and (select count(*) from public.audit_events where workshop_id=p_workshop_id and user_id=auth.uid() and action='intake' and created_at>clock_timestamp()-interval '1 minute')>=15)
    then raise exception 'Has realizado demasiadas operaciones. Espera un minuto y vuelve a intentarlo.'; end if;
  if kind = 'intake' then
    item_id := (p_command->>'id')::uuid;
    if exists(select 1 from public.requests where workshop_id=p_workshop_id and id=item_id) then return; end if;
    d := p_command->'data';
    d := jsonb_set(d,'{phone}',to_jsonb(public.normalize_phone(d->>'phone')));
    if jsonb_typeof(p_command->'messages') is distinct from 'array' then raise exception 'La conversación no es válida.'; end if;
    if jsonb_array_length(p_command->'messages') not between 1 and 30 then raise exception 'La conversación no es válida.'; end if;
    for message in select value from jsonb_array_elements(p_command->'messages') loop
      if (message->>'role') is null or (message->>'role') not in ('user','assistant') or (message->>'content') is null or length(message->>'content') > 2000 then raise exception 'Mensaje no válido.'; end if;
    end loop;
    -- Validate even when reusing an existing customer/vehicle.
    if d->>'name' is null or length(trim(d->>'name')) not between 2 and 100
      or d->>'phone' is null or (d->>'phone') !~ '^\+?[0-9 ()-]{7,20}$' or length(regexp_replace(d->>'phone','[^0-9]','','g')) < 7
      or d->>'brand' is null or length(trim(d->>'brand')) not between 1 and 60
      or d->>'model' is null or length(trim(d->>'model')) not between 1 and 80
      then raise exception 'Revisa el nombre, teléfono, marca y modelo.'; end if;
    select id into c_id from public.customers where workshop_id=p_workshop_id and phone_e164=d->>'phone';
    if c_id is null then
      insert into public.customers(workshop_id,name,phone,phone_e164) values(p_workshop_id,trim(d->>'name'),d->>'phone',d->>'phone') returning id into c_id;
    end if;
    plate_value := upper(regexp_replace(coalesce(d->>'plate',''),'\s','','g'));
    if length(plate_value)>20 then raise exception 'Matrícula demasiado larga.'; end if;
    if plate_value <> '' then
      select id,customer_id into v_id,owner_customer_id from public.vehicles where workshop_id=p_workshop_id and plate=plate_value;
      if v_id is not null and owner_customer_id <> c_id then raise exception 'Esta matrícula pertenece a otro cliente. Revisa el teléfono y la matrícula.'; end if;
    else
      select id into v_id from public.vehicles where workshop_id=p_workshop_id and customer_id=c_id and lower(brand)=lower(trim(d->>'brand')) and lower(model)=lower(trim(d->>'model')) limit 1;
    end if;
    if v_id is null then
      insert into public.vehicles(workshop_id,customer_id,brand,model,plate) values(p_workshop_id,c_id,trim(d->>'brand'),trim(d->>'model'),plate_value) returning id into v_id;
    end if;
    if exists(select 1 from public.vehicles where workshop_id=p_workshop_id and id=v_id and (brand<>trim(d->>'brand') or model<>trim(d->>'model'))) then
      insert into public.audit_events(workshop_id,user_id,action,entity_type,entity_id,metadata)
      select p_workshop_id,auth.uid(),'vehicle_corrected','vehicle',id,jsonb_build_object('previous_brand',brand,'previous_model',model) from public.vehicles where workshop_id=p_workshop_id and id=v_id;
      update public.vehicles set brand=trim(d->>'brand'),model=trim(d->>'model'),version=version+1 where workshop_id=p_workshop_id and id=v_id;
    end if;
    insert into public.conversations(workshop_id,messages) values(p_workshop_id,p_command->'messages') returning id into conv_id;
    insert into public.requests(id,workshop_id,customer_id,vehicle_id,conversation_id,reason,availability,notes)
      values(item_id,p_workshop_id,c_id,v_id,conv_id,trim(d->>'reason'),trim(d->>'availability'),coalesce(trim(d->>'notes'),''));
  elsif kind = 'status' then
    item_id := (p_command->>'id')::uuid; target_status := p_command->>'status';
    if not exists(select 1 from public.requests where workshop_id=p_workshop_id and id=item_id) then raise exception 'Solicitud no encontrada.'; end if;
    if target_status='cita_creada' and not exists(select 1 from public.appointments where workshop_id=p_workshop_id and request_id=item_id and status='scheduled') then raise exception 'Crea primero una cita para esta solicitud.'; end if;
    if target_status<>'cita_creada' and exists(select 1 from public.appointments where workshop_id=p_workshop_id and request_id=item_id and status='scheduled') then raise exception 'Completa o cancela primero la cita asociada.'; end if;
    update public.requests set status=target_status where workshop_id=p_workshop_id and id=item_id;
  elsif kind = 'appointment' then
    item_id := (p_command->>'id')::uuid; req_id := (p_command->>'request_id')::uuid;
    resource_value := (p_command->>'resource_id')::uuid;
    if resource_value is null then select id into resource_value from public.resources where workshop_id=p_workshop_id and active order by id limit 1; end if;
    if not exists(select 1 from public.resources where workshop_id=p_workshop_id and id=resource_value and active) then raise exception 'Selecciona un recurso activo de este taller.'; end if;
    start_value := (p_command->>'starts_at')::timestamptz; duration_value := (p_command->>'duration_minutes')::integer;
    select status into current_status from public.requests where workshop_id=p_workshop_id and id=req_id;
    if current_status is null or current_status in ('completada','cancelada') then raise exception 'La solicitud no está disponible para una cita.'; end if;
    if start_value is null or not isfinite(start_value) or start_value<=now() then raise exception 'Selecciona una fecha y hora futuras.'; end if;
    if duration_value is null or duration_value not between 15 and 480 then raise exception 'Duración no válida.'; end if;
    if exists(select 1 from public.appointments where workshop_id=p_workshop_id and id=item_id and (request_id<>req_id or status<>'scheduled')) then raise exception 'No se puede modificar esta cita.'; end if;
    if exists(select 1 from public.appointments where workshop_id=p_workshop_id and id<>item_id and request_id=req_id and status='scheduled') then raise exception 'Esta solicitud ya tiene una cita activa.'; end if;
    if exists(select 1 from public.appointments where workshop_id=p_workshop_id and id<>item_id and status='scheduled' and resource_id=resource_value
      and start_value < starts_at + make_interval(mins=>duration_minutes)
      and start_value + make_interval(mins=>duration_value) > starts_at) then raise exception 'Ese horario coincide con otra cita del mismo recurso. Elige otro horario o recurso.'; end if;
    if exists(select 1 from public.appointments where workshop_id=p_workshop_id and id=item_id) then
      update public.appointments set resource_id=resource_value,starts_at=start_value,duration_minutes=duration_value,notes=coalesce(trim(p_command->>'notes'),'') where workshop_id=p_workshop_id and id=item_id;
    else
      insert into public.appointments(id,workshop_id,request_id,resource_id,starts_at,duration_minutes,notes) values(item_id,p_workshop_id,req_id,resource_value,start_value,duration_value,coalesce(trim(p_command->>'notes'),''));
    end if;
    update public.requests set status='cita_creada' where workshop_id=p_workshop_id and id=req_id;
  elsif kind = 'appointment_status' then
    item_id := (p_command->>'id')::uuid; target_status := p_command->>'status';
    if target_status is null or target_status not in ('completed','cancelled') then raise exception 'Estado de cita no válido.'; end if;
    select request_id into req_id from public.appointments where workshop_id=p_workshop_id and id=item_id and status='scheduled';
    if req_id is null then raise exception 'La cita ya no está activa.'; end if;
    update public.appointments set status=target_status where workshop_id=p_workshop_id and id=item_id;
    update public.requests set status=case when target_status='completed' then 'completada' else 'pendiente' end where workshop_id=p_workshop_id and id=req_id;
  elsif kind = 'customer' then
    d := p_command->'customer'; item_id := (d->>'id')::uuid;
    if not public.valid_text(d,'name',2,100) or not public.valid_text(d,'phone',1,32) or not public.valid_text(d,'notes',0,2000) then raise exception 'Revisa el nombre, teléfono y observaciones del cliente.'; end if;
    d := jsonb_set(d,'{phone}',to_jsonb(public.normalize_phone(d->>'phone')));
    select version into current_version from public.customers where workshop_id=p_workshop_id and id=item_id;
    if current_version is not null and current_version is distinct from (d->>'version')::integer then raise exception 'Este registro ha cambiado. Actualiza la vista antes de guardar.'; end if;
    if exists(select 1 from public.customers where workshop_id=p_workshop_id and id<>item_id and phone_e164=d->>'phone') then raise exception 'Ya existe un cliente con ese teléfono.'; end if;
    if (d->>'workshop_id')::uuid is distinct from p_workshop_id then raise exception 'Taller no válido.'; end if;
    if exists(select 1 from public.customers where workshop_id=p_workshop_id and id=item_id) then
      update public.customers set name=trim(d->>'name'),phone=d->>'phone',phone_e164=d->>'phone',notes=d->>'notes',version=version+1 where workshop_id=p_workshop_id and id=item_id;
    else
      insert into public.customers(id,workshop_id,name,phone,phone_e164,notes) values(item_id,p_workshop_id,trim(d->>'name'),d->>'phone',d->>'phone',d->>'notes');
    end if;
  elsif kind = 'vehicle' then
    d := p_command->'vehicle'; item_id := (d->>'id')::uuid; c_id := (d->>'customer_id')::uuid;
    if not public.valid_text(d,'brand',1,60) or not public.valid_text(d,'model',1,80) or not public.valid_text(d,'plate',0,20) then raise exception 'Revisa la marca, modelo y matrícula.'; end if;
    if not exists(select 1 from public.customers where workshop_id=p_workshop_id and id=c_id) then raise exception 'El cliente ya no está disponible en este taller. Actualiza la vista.'; end if;
    select version into current_version from public.vehicles where workshop_id=p_workshop_id and id=item_id;
    if current_version is not null and current_version is distinct from (d->>'version')::integer then raise exception 'Este registro ha cambiado. Actualiza la vista antes de guardar.'; end if;
    if (d->>'workshop_id')::uuid is distinct from p_workshop_id then raise exception 'Taller no válido.'; end if;
    plate_value := upper(regexp_replace(coalesce(d->>'plate',''),'\s','','g'));
    if plate_value<>'' and exists(select 1 from public.vehicles where workshop_id=p_workshop_id and id<>item_id and plate=plate_value) then raise exception 'Ya existe un vehículo con esa matrícula.'; end if;
    if exists(select 1 from public.vehicles where workshop_id=p_workshop_id and id=item_id) then
      if exists(select 1 from public.vehicles where workshop_id=p_workshop_id and id=item_id and customer_id<>c_id) then raise exception 'No se puede cambiar el propietario de un vehículo existente.'; end if;
      update public.vehicles set brand=trim(d->>'brand'),model=trim(d->>'model'),plate=plate_value,version=version+1 where workshop_id=p_workshop_id and id=item_id;
    else
      insert into public.vehicles(id,workshop_id,customer_id,brand,model,plate) values(item_id,p_workshop_id,c_id,trim(d->>'brand'),trim(d->>'model'),plate_value);
    end if;
  elsif kind = 'settings' then
    d := p_command->'workshop';
    if not public.valid_text(d,'name',2,100) or not public.valid_text(d,'phone',0,32) or not public.valid_text(d,'address',0,300) or not public.valid_text(d,'hours',0,300) or not public.valid_text(d,'timezone',1,100) then raise exception 'Revisa los datos del taller.'; end if;
    if jsonb_typeof(d->'appointment_minutes') is distinct from 'number' or (d->>'appointment_minutes') !~ '^[0-9]+$' or (d->>'appointment_minutes')::integer not between 15 and 480 then raise exception 'La duración debe estar entre 15 y 480 minutos.'; end if;
    select version into current_version from public.workshops where id=p_workshop_id;
    if current_version is distinct from (d->>'version')::integer then raise exception 'Este registro ha cambiado. Actualiza la vista antes de guardar.'; end if;
    if trim(d->>'phone')<>'' then d := jsonb_set(d,'{phone}',to_jsonb(public.normalize_phone(d->>'phone'))); end if;
    if (d->>'id')::uuid is distinct from p_workshop_id then raise exception 'Taller no válido.'; end if;
    if not exists(select 1 from pg_timezone_names where name=d->>'timezone') then raise exception 'Zona horaria no válida.'; end if;
    update public.workshops set name=trim(d->>'name'),phone=coalesce(d->>'phone',''),address=coalesce(d->>'address',''),hours=coalesce(d->>'hours',''),timezone=d->>'timezone',appointment_minutes=(d->>'appointment_minutes')::integer,version=version+1 where id=p_workshop_id;
  elsif kind='resource' then
    d := p_command->'resource'; item_id := (d->>'id')::uuid;
    if (d->>'workshop_id')::uuid is distinct from p_workshop_id then raise exception 'Taller no válido.'; end if;
    if not public.valid_text(d,'name',2,100) or coalesce(d->>'kind','') not in ('bay','mechanic','lift') or jsonb_typeof(d->'active') is distinct from 'boolean' then raise exception 'Revisa los datos del recurso.'; end if;
    select version into current_version from public.resources where workshop_id=p_workshop_id and id=item_id;
    if current_version is not null and current_version is distinct from (d->>'version')::integer then raise exception 'Este registro ha cambiado. Actualiza la vista antes de guardar.'; end if;
    if current_version is null and (select count(*) from public.resources where workshop_id=p_workshop_id)>=50 then raise exception 'El taller admite hasta 50 recursos.'; end if;
    if exists(select 1 from public.resources where workshop_id=p_workshop_id and id<>item_id and lower(trim(name))=lower(trim(d->>'name'))) then raise exception 'Ya existe un recurso con ese nombre.'; end if;
    if not (d->>'active')::boolean then
      if exists(select 1 from public.appointments where workshop_id=p_workshop_id and resource_id=item_id and status='scheduled') then raise exception 'Reasigna o cierra las citas de este recurso antes de desactivarlo.'; end if;
      if not exists(select 1 from public.resources where workshop_id=p_workshop_id and id<>item_id and active) then raise exception 'Debe quedar al menos un recurso activo.'; end if;
    end if;
    if current_version is null then
      insert into public.resources(id,workshop_id,name,kind,active) values(item_id,p_workshop_id,trim(d->>'name'),d->>'kind',(d->>'active')::boolean);
    else
      update public.resources set name=trim(d->>'name'),kind=d->>'kind',active=(d->>'active')::boolean,version=version+1 where workshop_id=p_workshop_id and id=item_id;
    end if;
  else raise exception 'Operación no reconocida.';
  end if;
  target_entity := case when kind in ('intake','status') then 'request' when kind in ('appointment','appointment_status') then 'appointment' when kind='settings' then 'workshop' else kind end;
  target_id := case when kind='settings' then p_workshop_id else item_id end;
  insert into public.audit_events(workshop_id,user_id,action,entity_type,entity_id)
  values(p_workshop_id,auth.uid(),kind,target_entity,target_id);
exception
  when unique_violation then raise exception 'Ya existe un registro con esos datos. Actualiza la vista y revísalos.' using errcode='P0001';
  when foreign_key_violation then raise exception 'El registro relacionado ya no está disponible en este taller. Actualiza la vista.' using errcode='P0001';
  when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then raise exception 'Los datos de la operación no son válidos. Revisa los campos y vuelve a intentarlo.' using errcode='P0001';
  when serialization_failure or deadlock_detected then raise exception 'Los datos han cambiado. Actualiza la vista e inténtalo de nuevo.' using errcode='P0001';
end $$;
revoke all on function public.execute_command(uuid,jsonb) from public, anon;
grant execute on function public.execute_command(uuid,jsonb) to authenticated;
commit;
