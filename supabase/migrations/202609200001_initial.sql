-- TALLERIA: normalized tenant data. Apply once to a new Supabase project.
begin;
create table public.workshops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 100),
  phone text not null default '' check (length(phone) <= 20),
  address text not null default '' check (length(address) <= 300),
  hours text not null default 'L–V 09:00–14:00 y 16:00–19:00' check (length(hours) <= 300),
  timezone text not null default 'Europe/Madrid',
  appointment_minutes integer not null default 60 check (appointment_minutes between 15 and 480)
);
create table public.workshop_members (
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','staff')),
  primary key (workshop_id, user_id),
  unique(user_id)
);
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 100),
  phone text not null check (phone ~ '^\+?[0-9 ()-]{7,20}$'),
  phone_normalized text generated always as (regexp_replace(phone, '[^0-9]', '', 'g')) stored,
  notes text not null default '' check (length(notes) <= 2000),
  unique(workshop_id,id), unique(workshop_id,phone_normalized),
  check (length(phone_normalized) >= 7)
);
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  customer_id uuid not null,
  brand text not null check (length(trim(brand)) between 1 and 60),
  model text not null check (length(trim(model)) between 1 and 80),
  plate text not null default '' check (length(plate) <= 20 and plate = upper(regexp_replace(plate, '\s', '', 'g'))),
  foreign key(workshop_id,customer_id) references public.customers(workshop_id,id),
  unique(workshop_id,id), unique(workshop_id,id,customer_id)
);
create unique index vehicles_plate_unique on public.vehicles(workshop_id,plate) where plate <> '';
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  channel text not null default 'simulator' check(channel = 'simulator'),
  messages jsonb not null check (jsonb_typeof(messages) = 'array'),
  created_at timestamptz not null default now(),
  unique(workshop_id,id)
);
create table public.requests (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  customer_id uuid not null,
  vehicle_id uuid not null,
  conversation_id uuid not null,
  reason text not null check(length(trim(reason)) between 5 and 2000),
  availability text not null check(length(trim(availability)) between 2 and 300),
  notes text not null default '' check(length(notes) <= 2000),
  status text not null default 'nueva' check(status in ('nueva','pendiente','en_proceso','cita_creada','completada','cancelada')),
  created_at timestamptz not null default now(),
  foreign key(workshop_id,customer_id) references public.customers(workshop_id,id),
  foreign key(workshop_id,vehicle_id,customer_id) references public.vehicles(workshop_id,id,customer_id),
  foreign key(workshop_id,conversation_id) references public.conversations(workshop_id,id),
  unique(workshop_id,id), unique(workshop_id,conversation_id)
);
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  request_id uuid not null,
  starts_at timestamptz not null,
  duration_minutes integer not null check(duration_minutes between 15 and 480),
  status text not null default 'scheduled' check(status in ('scheduled','completed','cancelled')),
  notes text not null default '' check(length(notes) <= 2000),
  foreign key(workshop_id,request_id) references public.requests(workshop_id,id),
  unique(workshop_id,id)
);
create unique index one_active_appointment_per_request on public.appointments(workshop_id,request_id) where status='scheduled';
create index requests_tenant_date on public.requests(workshop_id,created_at desc);
create index requests_tenant_status on public.requests(workshop_id,status);
create index appointments_tenant_date on public.appointments(workshop_id,starts_at);
create index vehicles_customer on public.vehicles(workshop_id,customer_id);
create index conversations_tenant_date on public.conversations(workshop_id,created_at desc);

alter table public.workshops enable row level security;
alter table public.workshop_members enable row level security;
alter table public.customers enable row level security;
alter table public.vehicles enable row level security;
alter table public.conversations enable row level security;
alter table public.requests enable row level security;
alter table public.appointments enable row level security;
create policy own_membership on public.workshop_members for select to authenticated using(user_id = (select auth.uid()));
create policy own_workshop on public.workshops for select to authenticated using(exists(select 1 from public.workshop_members m where m.workshop_id = id and m.user_id = (select auth.uid())));
create policy tenant_customers on public.customers for select to authenticated using(workshop_id in(select m.workshop_id from public.workshop_members m where m.user_id = (select auth.uid())));
create policy tenant_vehicles on public.vehicles for select to authenticated using(workshop_id in(select m.workshop_id from public.workshop_members m where m.user_id = (select auth.uid())));
create policy tenant_conversations on public.conversations for select to authenticated using(workshop_id in(select m.workshop_id from public.workshop_members m where m.user_id = (select auth.uid())));
create policy tenant_requests on public.requests for select to authenticated using(workshop_id in(select m.workshop_id from public.workshop_members m where m.user_id = (select auth.uid())));
create policy tenant_appointments on public.appointments for select to authenticated using(workshop_id in(select m.workshop_id from public.workshop_members m where m.user_id = (select auth.uid())));
-- No direct client writes: commands below enforce atomic transitions and tenant integrity.
revoke all on public.workshops, public.workshop_members, public.customers, public.vehicles, public.conversations, public.requests, public.appointments from anon, authenticated;
grant select on public.workshops, public.workshop_members, public.customers, public.vehicles, public.conversations, public.requests, public.appointments to authenticated;

create function public.create_workshop(p_name text) returns uuid
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
  return w;
end $$;
revoke all on function public.create_workshop(text) from public, anon;
grant execute on function public.create_workshop(text) to authenticated;

create function public.execute_command(p_workshop_id uuid, p_command jsonb) returns void
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
begin
  if auth.uid() is null or not exists(select 1 from public.workshop_members where workshop_id=p_workshop_id and user_id=auth.uid()) then
    raise exception 'No tienes acceso a este taller.' using errcode = '42501';
  end if;
  -- Serialize tenant mutations: concurrent scheduling and deduplication stay consistent.
  perform 1 from public.workshops where id=p_workshop_id for update;
  if kind = 'intake' then
    item_id := (p_command->>'id')::uuid;
    if exists(select 1 from public.requests where workshop_id=p_workshop_id and id=item_id) then return; end if;
    d := p_command->'data';
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
    select id into c_id from public.customers where workshop_id=p_workshop_id and phone_normalized=regexp_replace(d->>'phone','[^0-9]','','g');
    if c_id is null then
      insert into public.customers(workshop_id,name,phone) values(p_workshop_id,trim(d->>'name'),trim(d->>'phone')) returning id into c_id;
    end if;
    plate_value := upper(regexp_replace(coalesce(d->>'plate',''),'\s','','g'));
    if length(plate_value)>20 then raise exception 'Matrícula demasiado larga.'; end if;
    if plate_value <> '' then
      select id,customer_id into v_id,req_id from public.vehicles where workshop_id=p_workshop_id and plate=plate_value;
      if v_id is not null and req_id <> c_id then raise exception 'Esta matrícula pertenece a otro cliente. Revisa el teléfono y la matrícula.'; end if;
    else
      select id into v_id from public.vehicles where workshop_id=p_workshop_id and customer_id=c_id and lower(brand)=lower(trim(d->>'brand')) and lower(model)=lower(trim(d->>'model')) limit 1;
    end if;
    if v_id is null then
      insert into public.vehicles(workshop_id,customer_id,brand,model,plate) values(p_workshop_id,c_id,trim(d->>'brand'),trim(d->>'model'),plate_value) returning id into v_id;
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
    start_value := (p_command->>'starts_at')::timestamptz; duration_value := (p_command->>'duration_minutes')::integer;
    select status into current_status from public.requests where workshop_id=p_workshop_id and id=req_id;
    if current_status is null or current_status in ('completada','cancelada') then raise exception 'La solicitud no está disponible para una cita.'; end if;
    if start_value is null or not isfinite(start_value) or start_value<=now() then raise exception 'Selecciona una fecha y hora futuras.'; end if;
    if duration_value is null or duration_value not between 15 and 480 then raise exception 'Duración no válida.'; end if;
    if exists(select 1 from public.appointments where workshop_id=p_workshop_id and id=item_id and (request_id<>req_id or status<>'scheduled')) then raise exception 'No se puede modificar esta cita.'; end if;
    if exists(select 1 from public.appointments where workshop_id=p_workshop_id and id<>item_id and request_id=req_id and status='scheduled') then raise exception 'Esta solicitud ya tiene una cita activa.'; end if;
    if exists(select 1 from public.appointments where workshop_id=p_workshop_id and id<>item_id and status='scheduled'
      and start_value < starts_at + make_interval(mins=>duration_minutes)
      and start_value + make_interval(mins=>duration_value) > starts_at) then raise exception 'Ese horario coincide con otra cita.'; end if;
    if exists(select 1 from public.appointments where workshop_id=p_workshop_id and id=item_id) then
      update public.appointments set starts_at=start_value,duration_minutes=duration_value,notes=coalesce(trim(p_command->>'notes'),'') where workshop_id=p_workshop_id and id=item_id;
    else
      insert into public.appointments(id,workshop_id,request_id,starts_at,duration_minutes,notes) values(item_id,p_workshop_id,req_id,start_value,duration_value,coalesce(trim(p_command->>'notes'),''));
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
    if (d->>'workshop_id')::uuid is distinct from p_workshop_id then raise exception 'Taller no válido.'; end if;
    if exists(select 1 from public.customers where workshop_id=p_workshop_id and id=item_id) then
      update public.customers set name=trim(d->>'name'),phone=trim(d->>'phone'),notes=coalesce(d->>'notes','') where workshop_id=p_workshop_id and id=item_id;
    else
      insert into public.customers(id,workshop_id,name,phone,notes) values(item_id,p_workshop_id,trim(d->>'name'),trim(d->>'phone'),coalesce(d->>'notes',''));
    end if;
  elsif kind = 'vehicle' then
    d := p_command->'vehicle'; item_id := (d->>'id')::uuid; c_id := (d->>'customer_id')::uuid;
    if (d->>'workshop_id')::uuid is distinct from p_workshop_id then raise exception 'Taller no válido.'; end if;
    plate_value := upper(regexp_replace(coalesce(d->>'plate',''),'\s','','g'));
    if exists(select 1 from public.vehicles where workshop_id=p_workshop_id and id=item_id) then
      if exists(select 1 from public.vehicles where workshop_id=p_workshop_id and id=item_id and customer_id<>c_id) then raise exception 'No se puede cambiar el propietario de un vehículo existente.'; end if;
      update public.vehicles set brand=trim(d->>'brand'),model=trim(d->>'model'),plate=plate_value where workshop_id=p_workshop_id and id=item_id;
    else
      insert into public.vehicles(id,workshop_id,customer_id,brand,model,plate) values(item_id,p_workshop_id,c_id,trim(d->>'brand'),trim(d->>'model'),plate_value);
    end if;
  elsif kind = 'settings' then
    d := p_command->'workshop';
    if (d->>'id')::uuid is distinct from p_workshop_id then raise exception 'Taller no válido.'; end if;
    if not exists(select 1 from pg_timezone_names where name=d->>'timezone') then raise exception 'Zona horaria no válida.'; end if;
    update public.workshops set name=trim(d->>'name'),phone=coalesce(d->>'phone',''),address=coalesce(d->>'address',''),hours=coalesce(d->>'hours',''),timezone=d->>'timezone',appointment_minutes=(d->>'appointment_minutes')::integer where id=p_workshop_id;
  else raise exception 'Operación no reconocida.';
  end if;
end $$;
revoke all on function public.execute_command(uuid,jsonb) from public, anon;
grant execute on function public.execute_command(uuid,jsonb) to authenticated;
commit;
