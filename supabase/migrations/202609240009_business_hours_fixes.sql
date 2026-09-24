-- Follow-up to 202609240008_business_hours.sql: 202609240008 was already
-- applied to real Supabase before this fix, in its original (pre-review)
-- form -- confirmed by reading the live schema (workshops.hours_version,
-- workshop_hours, workshop_hour_exceptions and is_within_business_hours
-- already exist there). Re-running 202609240008 as-is would fail: it
-- creates those same tables/columns without "if not exists" guards, and
-- the whole file runs in one transaction, so nothing in it would apply.
--
-- Only execute_command and workspace_snapshot actually changed after
-- independent review; both are declared with "create or replace function",
-- safe to redeploy on their own without touching anything already live.
-- Every other object from 202609240008 is unchanged and is not repeated
-- here. Apply AFTER 202609240008_business_hours.sql (already applied).
begin;

-- Fix (blocking, from independent review): a stale edit whose version
-- implied an existing record, arriving after that record had already been
-- deleted, was accepted as a brand-new creation instead of being rejected
-- -- silently resurrecting a closure/exception the owner had removed.
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
  request_version integer;
  appointment_version integer;
begin
  select role into actor_role from public.workshop_members where workshop_id=p_workshop_id and user_id=auth.uid() for share;
  if actor_role is null then raise exception 'No tienes acceso a este taller.' using errcode='42501'; end if;
  if kind in ('settings','resource','workshop_hours','workshop_hour_exception','workshop_hour_exception_delete') and actor_role<>'owner' then raise exception 'Solo el propietario puede realizar esta operación.'; end if;
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
    select version into request_version from public.requests where workshop_id=p_workshop_id and id=item_id;
    if request_version is distinct from (p_command->>'version')::integer then raise exception 'Este registro ha cambiado. Actualiza la vista antes de guardar.'; end if;
    if target_status='cita_creada' and not exists(select 1 from public.appointments where workshop_id=p_workshop_id and request_id=item_id and status='scheduled') then raise exception 'Crea primero una cita para esta solicitud.'; end if;
    if target_status<>'cita_creada' and exists(select 1 from public.appointments where workshop_id=p_workshop_id and request_id=item_id and status='scheduled') then raise exception 'Completa o cancela primero la cita asociada.'; end if;
    update public.requests set status=target_status,version=version+1 where workshop_id=p_workshop_id and id=item_id;
  elsif kind = 'appointment' then
    item_id := (p_command->>'id')::uuid; req_id := (p_command->>'request_id')::uuid;
    select version into request_version from public.requests where workshop_id=p_workshop_id and id=req_id;
    if request_version is null then raise exception 'Solicitud no encontrada.'; end if;
    if request_version is distinct from (p_command->>'request_version')::integer then raise exception 'Este registro ha cambiado. Actualiza la vista antes de guardar.'; end if;
    select version into appointment_version from public.appointments where workshop_id=p_workshop_id and id=item_id;
    if appointment_version is not null and appointment_version is distinct from (p_command->>'version')::integer then raise exception 'Este registro ha cambiado. Actualiza la vista antes de guardar.'; end if;
    resource_value := (p_command->>'resource_id')::uuid;
    if resource_value is null then select id into resource_value from public.resources where workshop_id=p_workshop_id and active order by id limit 1; end if;
    if not exists(select 1 from public.resources where workshop_id=p_workshop_id and id=resource_value and active) then raise exception 'Selecciona un recurso activo de este taller.'; end if;
    start_value := (p_command->>'starts_at')::timestamptz; duration_value := (p_command->>'duration_minutes')::integer;
    select status into current_status from public.requests where workshop_id=p_workshop_id and id=req_id;
    if current_status is null or current_status in ('completada','cancelada') then raise exception 'La solicitud no está disponible para una cita.'; end if;
    if start_value is null or not isfinite(start_value) or start_value<=now() then raise exception 'Selecciona una fecha y hora futuras.'; end if;
    if duration_value is null or duration_value not between 15 and 480 then raise exception 'Duración no válida.'; end if;
    if not public.is_within_business_hours(p_workshop_id, start_value, duration_value) then raise exception 'La cita debe estar dentro del horario configurado del taller.'; end if;
    if exists(select 1 from public.appointments where workshop_id=p_workshop_id and id=item_id and (request_id<>req_id or status<>'scheduled')) then raise exception 'No se puede modificar esta cita.'; end if;
    if exists(select 1 from public.appointments where workshop_id=p_workshop_id and id<>item_id and request_id=req_id and status='scheduled') then raise exception 'Esta solicitud ya tiene una cita activa.'; end if;
    if exists(select 1 from public.appointments where workshop_id=p_workshop_id and id<>item_id and status='scheduled' and resource_id=resource_value
      and start_value < starts_at + make_interval(mins=>duration_minutes)
      and start_value + make_interval(mins=>duration_value) > starts_at) then raise exception 'Ese horario coincide con otra cita del mismo recurso. Elige otro horario o recurso.'; end if;
    if exists(select 1 from public.appointments where workshop_id=p_workshop_id and id=item_id) then
      update public.appointments set version=version+1,resource_id=resource_value,starts_at=start_value,duration_minutes=duration_value,notes=coalesce(trim(p_command->>'notes'),'') where workshop_id=p_workshop_id and id=item_id;
    else
      insert into public.appointments(id,workshop_id,request_id,resource_id,starts_at,duration_minutes,notes) values(item_id,p_workshop_id,req_id,resource_value,start_value,duration_value,coalesce(trim(p_command->>'notes'),''));
    end if;
    update public.requests set status='cita_creada',version=version+1 where workshop_id=p_workshop_id and id=req_id;
  elsif kind = 'appointment_status' then
    item_id := (p_command->>'id')::uuid; target_status := p_command->>'status';
    if target_status is null or target_status not in ('completed','cancelled') then raise exception 'Estado de cita no válido.'; end if;
    select request_id into req_id from public.appointments where workshop_id=p_workshop_id and id=item_id and status='scheduled';
    if req_id is null then raise exception 'La cita ya no está activa.'; end if;
    select version into appointment_version from public.appointments where workshop_id=p_workshop_id and id=item_id;
    select version into request_version from public.requests where workshop_id=p_workshop_id and id=req_id;
    if appointment_version is distinct from (p_command->>'version')::integer or request_version is distinct from (p_command->>'request_version')::integer then raise exception 'Este registro ha cambiado. Actualiza la vista antes de guardar.'; end if;
    update public.appointments set version=version+1,status=target_status where workshop_id=p_workshop_id and id=item_id;
    update public.requests set status=case when target_status='completed' then 'completada' else 'pendiente' end,version=version+1 where workshop_id=p_workshop_id and id=req_id;
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
  elsif kind='workshop_hours' then
    if jsonb_typeof(p_command->'ranges') is distinct from 'array' or jsonb_array_length(p_command->'ranges')>30 then raise exception 'El horario no es válido.'; end if;
    select hours_version into current_version from public.workshops where id=p_workshop_id;
    if current_version is distinct from (p_command->>'hours_version')::integer then raise exception 'Este registro ha cambiado. Actualiza la vista antes de guardar.'; end if;
    if (select count(*) from jsonb_array_elements(p_command->'ranges') r) <>
       (select count(*) from (select distinct r->>'day_of_week' d, r->>'opens_at' o, r->>'closes_at' c from jsonb_array_elements(p_command->'ranges') r) u)
      then raise exception 'Hay horarios duplicados.'; end if;
    delete from public.workshop_hours where workshop_id=p_workshop_id;
    insert into public.workshop_hours(workshop_id,day_of_week,opens_at,closes_at)
      select p_workshop_id,(r->>'day_of_week')::smallint,(r->>'opens_at')::time,(r->>'closes_at')::time
      from jsonb_array_elements(p_command->'ranges') r;
    update public.workshops set hours_version=hours_version+1 where id=p_workshop_id;
  elsif kind='workshop_hour_exception' then
    d := p_command->'exception'; item_id := (d->>'id')::uuid;
    if (d->>'workshop_id')::uuid is distinct from p_workshop_id then raise exception 'Taller no válido.'; end if;
    if jsonb_typeof(d->'closed') is distinct from 'boolean' then raise exception 'Revisa los datos de la excepción.'; end if;
    select version into current_version from public.workshop_hour_exceptions where workshop_id=p_workshop_id and id=item_id;
    -- d->'version' is only present once the client has loaded a saved
    -- exception; a stale edit/delete race that arrives after it's already
    -- been removed must not be treated as a brand-new creation with that
    -- same id, or it would silently resurrect a closure the owner deleted.
    if current_version is null and (d->'version') is not null then raise exception 'La excepción ya no existe. Actualiza la vista.'; end if;
    if current_version is not null and current_version is distinct from (d->>'version')::integer then raise exception 'Este registro ha cambiado. Actualiza la vista antes de guardar.'; end if;
    if exists(select 1 from public.workshop_hour_exceptions where workshop_id=p_workshop_id and id<>item_id and exception_date=(d->>'exception_date')::date) then raise exception 'Ya existe una excepción para esa fecha.'; end if;
    if current_version is null then
      insert into public.workshop_hour_exceptions(id,workshop_id,exception_date,closed,opens_at,closes_at)
        values(item_id,p_workshop_id,(d->>'exception_date')::date,(d->>'closed')::boolean,
          case when (d->>'closed')::boolean then null else (d->>'opens_at')::time end,
          case when (d->>'closed')::boolean then null else (d->>'closes_at')::time end);
    else
      update public.workshop_hour_exceptions set
        exception_date=(d->>'exception_date')::date,
        closed=(d->>'closed')::boolean,
        opens_at=case when (d->>'closed')::boolean then null else (d->>'opens_at')::time end,
        closes_at=case when (d->>'closed')::boolean then null else (d->>'closes_at')::time end,
        version=version+1
      where workshop_id=p_workshop_id and id=item_id;
    end if;
  elsif kind='workshop_hour_exception_delete' then
    item_id := (p_command->>'id')::uuid;
    select version into current_version from public.workshop_hour_exceptions where workshop_id=p_workshop_id and id=item_id;
    if current_version is null then raise exception 'La excepción ya no existe.'; end if;
    if current_version is distinct from (p_command->>'version')::integer then raise exception 'Este registro ha cambiado. Actualiza la vista antes de guardar.'; end if;
    delete from public.workshop_hour_exceptions where workshop_id=p_workshop_id and id=item_id;
  else raise exception 'Operación no reconocida.';
  end if;
  target_entity := case when kind in ('intake','status') then 'request' when kind in ('appointment','appointment_status') then 'appointment' when kind in ('settings','workshop_hours') then 'workshop' when kind in ('workshop_hour_exception','workshop_hour_exception_delete') then 'workshop_hour_exception' else kind end;
  target_id := case when kind in ('settings','workshop_hours') then p_workshop_id else item_id end;
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

-- Fix (minor, from independent review): "upcoming exceptions" was filtered
-- by the database session's current_date instead of the workshop's own
-- timezone, so an exception still today for the workshop could vanish
-- from this list (though it kept applying when booking) while the
-- session's timezone was already the next day.
create or replace function public.workspace_snapshot(p_workshop_id uuid,p_view text default 'dashboard',p_offset integer default 0,p_search text default '',p_status text default 'all') returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare
  actor_role text; q text := public.search_text(coalesce(p_search,'')); workshop_today date;
  ids uuid[] := '{}'; reqs uuid[] := '{}'; custs uuid[] := '{}'; vehs uuid[] := '{}'; convs uuid[] := '{}'; apps uuid[] := '{}'; total bigint := 0;
begin
  select role into actor_role from public.workshop_members where workshop_id=p_workshop_id and user_id=auth.uid();
  if actor_role is null then raise exception 'No tienes acceso a este taller.' using errcode='42501'; end if;
  if p_view not in ('dashboard','requests','customers','vehicles','conversations','appointments','reception','settings') or p_offset is null or p_offset<0 or p_offset>1000000 or length(q)>120 then raise exception 'La consulta no es válida.'; end if;
  select (now() at time zone timezone)::date into workshop_today from public.workshops where id=p_workshop_id;
  if p_view='requests' then
    select count(*) into total from public.requests r join public.customers c on c.workshop_id=r.workshop_id and c.id=r.customer_id join public.vehicles v on v.workshop_id=r.workshop_id and v.id=r.vehicle_id where r.workshop_id=p_workshop_id and (p_status='all' or r.status=p_status) and strpos(public.search_text(r.reason||' '||c.name||' '||c.phone||' '||v.plate),q)>0;
    select coalesce(array_agg(id),'{}'::uuid[]) into ids from (select r.id from public.requests r join public.customers c on c.workshop_id=r.workshop_id and c.id=r.customer_id join public.vehicles v on v.workshop_id=r.workshop_id and v.id=r.vehicle_id where r.workshop_id=p_workshop_id and (p_status='all' or r.status=p_status) and strpos(public.search_text(r.reason||' '||c.name||' '||c.phone||' '||v.plate),q)>0 order by r.created_at desc,r.id limit 25 offset p_offset) page;
  elsif p_view='customers' then
    select count(*) into total from public.customers c where c.workshop_id=p_workshop_id and strpos(public.search_text(c.name||' '||c.phone),q)>0;
    select coalesce(array_agg(id),'{}'::uuid[]) into ids from (select c.id from public.customers c where c.workshop_id=p_workshop_id and strpos(public.search_text(c.name||' '||c.phone),q)>0 order by c.name,c.id limit 25 offset p_offset) page;
  elsif p_view='vehicles' then
    select count(*) into total from public.vehicles v join public.customers c on c.workshop_id=v.workshop_id and c.id=v.customer_id where v.workshop_id=p_workshop_id and strpos(public.search_text(v.brand||' '||v.model||' '||v.plate||' '||c.name),q)>0;
    select coalesce(array_agg(id),'{}'::uuid[]) into ids from (select v.id from public.vehicles v join public.customers c on c.workshop_id=v.workshop_id and c.id=v.customer_id where v.workshop_id=p_workshop_id and strpos(public.search_text(v.brand||' '||v.model||' '||v.plate||' '||c.name),q)>0 order by v.brand,v.id limit 25 offset p_offset) page;
  elsif p_view='conversations' then
    select count(*) into total from public.conversations c where c.workshop_id=p_workshop_id and strpos(public.search_text(c.messages::text),q)>0;
    select coalesce(array_agg(id),'{}'::uuid[]) into ids from (select c.id from public.conversations c where c.workshop_id=p_workshop_id and strpos(public.search_text(c.messages::text),q)>0 order by c.created_at desc,c.id limit 25 offset p_offset) page;
  elsif p_view='appointments' then
    select count(*) into total from public.appointments a where a.workshop_id=p_workshop_id and true;
    select coalesce(array_agg(id),'{}'::uuid[]) into ids from (select a.id from public.appointments a where a.workshop_id=p_workshop_id and true order by case when a.status='scheduled' then 0 else 1 end,case when a.status='scheduled' then a.starts_at end asc,case when a.status<>'scheduled' then a.starts_at end desc,a.id limit 25 offset p_offset) page;
  end if;
  if p_view='requests' then reqs:=ids; end if;
  if p_view='customers' then custs:=ids; end if;
  if p_view='vehicles' then vehs:=ids; end if;
  if p_view='conversations' then convs:=ids; end if;
  if p_view='appointments' then apps:=ids; end if;
  if p_view='dashboard' then
    select coalesce(array_agg(id),'{}'::uuid[]) into reqs from (select id from public.requests where workshop_id=p_workshop_id order by created_at desc,id limit 8) r;
    select coalesce(array_agg(id),'{}'::uuid[]) into apps from (select id from public.appointments where workshop_id=p_workshop_id and status='scheduled' and starts_at>=now() order by starts_at,id limit 8) a;
  end if;
  select reqs||coalesce(array_agg(id),'{}'::uuid[]) into reqs from public.requests where workshop_id=p_workshop_id and conversation_id=any(convs);
  select reqs||coalesce(array_agg(request_id),'{}'::uuid[]) into reqs from public.appointments where workshop_id=p_workshop_id and id=any(apps);
  select apps||coalesce(array_agg(id),'{}'::uuid[]) into apps from public.appointments where workshop_id=p_workshop_id and request_id=any(reqs) and status='scheduled';
  select custs||coalesce(array_agg(customer_id),'{}'::uuid[]),vehs||coalesce(array_agg(vehicle_id),'{}'::uuid[]),convs||coalesce(array_agg(conversation_id),'{}'::uuid[])
    into custs,vehs,convs from public.requests where workshop_id=p_workshop_id and id=any(reqs);
  select custs||coalesce(array_agg(customer_id),'{}'::uuid[]) into custs from public.vehicles where workshop_id=p_workshop_id and id=any(vehs);
  return jsonb_build_object(
    'schema_version',3,'role',actor_role,'user_id',auth.uid(),
    'workshop',(select to_jsonb(w) from public.workshops w where id=p_workshop_id),
    'resources',(select coalesce(jsonb_agg(to_jsonb(r) order by r.name,r.id),'[]') from public.resources r where workshop_id=p_workshop_id),
    'hours',(select coalesce(jsonb_agg(to_jsonb(h) order by h.day_of_week,h.opens_at),'[]') from public.workshop_hours h where workshop_id=p_workshop_id),
    'hour_exceptions',(select coalesce(jsonb_agg(to_jsonb(e) order by e.exception_date),'[]') from (select * from public.workshop_hour_exceptions where workshop_id=p_workshop_id and exception_date>=workshop_today order by exception_date limit 100) e),
    'requests',(select coalesce(jsonb_agg(to_jsonb(r) order by created_at desc,id),'[]') from public.requests r where workshop_id=p_workshop_id and id=any(reqs)),
    'customers',(select coalesce(jsonb_agg(to_jsonb(c) order by name,id),'[]') from public.customers c where workshop_id=p_workshop_id and id=any(custs)),
    'vehicles',(select coalesce(jsonb_agg(to_jsonb(v) order by brand,id),'[]') from public.vehicles v where workshop_id=p_workshop_id and id=any(vehs)),
    'conversations',(select coalesce(jsonb_agg(to_jsonb(c) order by created_at desc,id),'[]') from public.conversations c where workshop_id=p_workshop_id and id=any(convs)),
    'appointments',(select coalesce(jsonb_agg(to_jsonb(a) order by starts_at,id),'[]') from public.appointments a where workshop_id=p_workshop_id and id=any(apps)),
    'audit',(select coalesce(jsonb_agg(to_jsonb(e) order by created_at desc,id),'[]') from (select * from public.audit_events where workshop_id=p_workshop_id order by created_at desc,id limit 20) e),
    'page_info',jsonb_build_object('view',p_view,'offset',p_offset,'total',total,'ids',to_jsonb(ids)),
    'metrics',jsonb_build_object(
      'new_requests',(select count(*) from public.requests where workshop_id=p_workshop_id and status='nueva'),
      'upcoming',(select count(*) from public.appointments where workshop_id=p_workshop_id and status='scheduled' and starts_at>=now()),
      'pending_customers',(select count(distinct customer_id) from public.requests where workshop_id=p_workshop_id and status in ('nueva','pendiente')),
      'completed',(select count(*) from public.requests where workshop_id=p_workshop_id and status='completada')),
    'customer_counts',(select coalesce(jsonb_object_agg(c.id,jsonb_build_object(
      'vehicles',(select count(*) from public.vehicles v where v.workshop_id=p_workshop_id and v.customer_id=c.id),
      'requests',(select count(*) from public.requests r where r.workshop_id=p_workshop_id and r.customer_id=c.id))),'{}') from public.customers c where workshop_id=p_workshop_id and id=any(custs))
  );
end $$;
revoke all on function public.workspace_snapshot(uuid,text,integer,text,text) from public,anon;
grant execute on function public.workspace_snapshot(uuid,text,integer,text,text) to authenticated;

commit;
