-- Public reception: a per-workshop link customers can use without an
-- account, replacing the old "simulator" framing where the guided intake
-- was reachable only by an authenticated member. Exactly two functions
-- below are granted to anon; every existing table, policy, grant and
-- function (execute_command, workspace_snapshot, lookup_options, the team
-- management RPCs) is unchanged. Apply AFTER 202609210005_team_management.sql.
begin;

-- A request born from the public link is a genuinely different provenance
-- from a staff member typing in a phone call (now "Registro manual" in the
-- UI, no longer "Simulador"): conversations.channel needs a second value to
-- tell them apart in the requests list.
alter table public.conversations drop constraint conversations_channel_check;
alter table public.conversations add constraint conversations_channel_check check (channel in ('simulator','public'));

-- Reuses search_text's existing NFD/accent-stripping (no extension needed)
-- so a slug and its source name normalize the same way search already does.
create function public.slugify(p_text text) returns text
language sql immutable set search_path = '' as $$
  select trim(both '-' from regexp_replace(public.search_text(p_text), '[^a-z0-9]+', '-', 'g'))
$$;
revoke all on function public.slugify(text) from public, anon, authenticated;

create function public.generate_workshop_slug(p_name text, p_workshop_id uuid) returns text
language plpgsql volatile set search_path = '' as $$
-- Trimming again after the length cut matters: slugify() already trims the
-- full name's outer hyphens, but truncating to 40 chars can land right on a
-- hyphen and reintroduce a trailing one, which workshops_slug_format rejects.
declare base text := trim(both '-' from left(public.slugify(p_name), 40)); candidate text;
begin
  if base = '' then base := 'taller'; end if;
  candidate := base;
  if exists(select 1 from public.workshops where slug = candidate and id <> p_workshop_id) then
    candidate := base || '-' || left(replace(p_workshop_id::text, '-', ''), 6);
  end if;
  -- Same base and same 6-char id prefix colliding too is vanishingly
  -- unlikely, but the full id is always unique as a last resort.
  if exists(select 1 from public.workshops where slug = candidate and id <> p_workshop_id) then
    candidate := p_workshop_id::text;
  end if;
  return candidate;
end $$;
revoke all on function public.generate_workshop_slug(text,uuid) from public, anon, authenticated;

alter table public.workshops add column slug text;
-- Row by row, not a single bulk UPDATE: generate_workshop_slug checks
-- existing slugs, and a bulk UPDATE would evaluate every row against the
-- same pre-statement snapshot, letting two workshops with the same name
-- collide on the same generated slug before the unique index below exists.
do $$ declare item record; candidate text;
begin
  for item in select id, name from public.workshops order by id loop
    candidate := public.generate_workshop_slug(item.name, item.id);
    update public.workshops set slug = candidate where id = item.id;
  end loop;
end $$;
alter table public.workshops alter column slug set not null;
alter table public.workshops add constraint workshops_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 1 and 50);
create unique index workshops_slug_unique on public.workshops(slug);

-- Not editable from the UI yet (no uniqueness-checking command path exists
-- for it in execute_command); create_workshop is the only writer.
create or replace function public.create_workshop(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare w uuid; u uuid := auth.uid();
begin
  if u is null then raise exception 'Debes iniciar sesión.'; end if;
  if p_name is null or length(trim(p_name)) not between 2 and 100 then raise exception 'El nombre debe tener entre 2 y 100 caracteres.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text, 0));
  select workshop_id into w from public.workshop_members where user_id = u;
  if w is not null then return w; end if;
  w := gen_random_uuid();
  insert into public.workshops(id,name,slug) values(w,trim(p_name),public.generate_workshop_slug(trim(p_name), w));
  insert into public.workshop_members(workshop_id,user_id) values(w,u);
  insert into public.resources(workshop_id,name) values(w,'Puesto principal');
  insert into public.audit_events(workshop_id,user_id,action,entity_type,entity_id) values(w,u,'workshop_created','workshop',w);
  return w;
end $$;
revoke all on function public.create_workshop(text) from public, anon;
grant execute on function public.create_workshop(text) to authenticated;

-- Anonymous-safe lookup: only the fields a visitor needs to recognize the
-- workshop before writing to it, never phone/internal data. workspace_snapshot
-- already carries the new slug column through to authenticated members via
-- to_jsonb(w), so it needs no change.
create function public.public_workshop_info(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  select jsonb_build_object('id',id,'name',name,'address',address,'hours',hours,'timezone',timezone) into result
    from public.workshops where slug = lower(trim(coalesce(p_slug,'')));
  return result;
end $$;
revoke all on function public.public_workshop_info(text) from public, anon, authenticated;
grant execute on function public.public_workshop_info(text) to anon, authenticated;

-- Anonymous attempt counter, kept separate from audit_events (which is
-- staff-facing history, not anonymous traffic). RLS is enabled with no
-- policies at all: nobody, including authenticated, reads or writes this
-- table directly -- only public_intake, as its owner, can.
create table public.public_intake_attempts (
  id bigint generated always as identity primary key,
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  ip inet not null,
  created_at timestamptz not null default clock_timestamp()
);
create index public_intake_attempts_lookup on public.public_intake_attempts(workshop_id, ip, created_at desc);
alter table public.public_intake_attempts enable row level security;
revoke all on public.public_intake_attempts from public, anon, authenticated;

-- The public counterpart of execute_command's 'intake' branch: same
-- validation, same customer/vehicle dedupe, same idempotency key, but the
-- workshop is resolved from a slug (never a client-trusted uuid) and there
-- is no auth.uid()/workshop_members row to key rate limiting on, so this
-- uses its own IP-based counter plus a honeypot and a minimum-duration
-- check instead. The honeypot and duration checks return false rather than
-- raising: an automated caller doesn't get an exception explaining which
-- heuristic tripped, but the return value still tells the real client
-- whether anything was actually persisted, so a legitimate visitor is never
-- told "gracias" for a request that was silently dropped.
create function public.public_intake(
  p_slug text, p_data jsonb, p_messages jsonb, p_client_id uuid,
  p_hp text default '', p_started_at timestamptz default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  w_id uuid;
  d jsonb;
  c_id uuid;
  v_id uuid;
  conv_id uuid;
  owner_customer_id uuid;
  plate_value text;
  message jsonb;
  raw_headers text := current_setting('request.headers', true);
  client_ip inet;
  attempts integer;
begin
  if p_client_id is null then raise exception 'Solicitud no válida.'; end if;
  select id into w_id from public.workshops where slug = lower(trim(coalesce(p_slug,'')));
  if w_id is null then raise exception 'No se ha encontrado el taller.'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or octet_length(coalesce(p_data::text,'')) + octet_length(coalesce(p_messages::text,'')) > 65536 then
    raise exception 'La operación contiene demasiados datos o no es válida.';
  end if;
  if coalesce(p_hp, '') <> '' then return false; end if;
  -- p_started_at is the visitor's own device clock, never authoritative: if
  -- it runs ahead of the database (clock skew, not unusual on phones),
  -- clock_timestamp() - p_started_at is negative, which is "less than 20
  -- seconds" too, permanently misflagging a genuine slow visitor on every
  -- retry. Only treat it as suspicious when it's a real, non-negative short
  -- duration.
  if p_started_at is not null and clock_timestamp() - p_started_at >= interval '0 seconds' and clock_timestamp() - p_started_at < interval '20 seconds' then return false; end if;

  if raw_headers is not null then
    begin
      client_ip := nullif(trim(split_part(raw_headers::json->>'x-forwarded-for', ',', 1)), '')::inet;
    exception when others then client_ip := null;
    end;
  end if;
  perform 1 from public.workshops where id = w_id for update;
  if exists(select 1 from public.requests where workshop_id = w_id and id = p_client_id) then return true; end if;
  if client_ip is not null then
    select count(*) into attempts from public.public_intake_attempts where workshop_id = w_id and ip = client_ip and created_at > clock_timestamp() - interval '1 hour';
    if attempts >= 5 then raise exception 'Demasiados envíos desde esta conexión. Inténtalo más tarde.'; end if;
  end if;

  d := p_data;
  d := jsonb_set(d, '{phone}', to_jsonb(public.normalize_phone(d->>'phone')));
  if jsonb_typeof(p_messages) is distinct from 'array' then raise exception 'La conversación no es válida.'; end if;
  if jsonb_array_length(p_messages) not between 1 and 30 then raise exception 'La conversación no es válida.'; end if;
  for message in select value from jsonb_array_elements(p_messages) loop
    if (message->>'role') is null or (message->>'role') not in ('user','assistant') or (message->>'content') is null or length(message->>'content') > 2000 then raise exception 'Mensaje no válido.'; end if;
  end loop;
  if d->>'name' is null or length(trim(d->>'name')) not between 2 and 100
    or d->>'phone' is null or (d->>'phone') !~ '^\+?[0-9 ()-]{7,20}$' or length(regexp_replace(d->>'phone','[^0-9]','','g')) < 7
    or d->>'brand' is null or length(trim(d->>'brand')) not between 1 and 60
    or d->>'model' is null or length(trim(d->>'model')) not between 1 and 80
    then raise exception 'Revisa el nombre, teléfono, marca y modelo.'; end if;

  select id into c_id from public.customers where workshop_id = w_id and phone_e164 = d->>'phone';
  if c_id is null then
    insert into public.customers(workshop_id,name,phone,phone_e164) values(w_id,trim(d->>'name'),d->>'phone',d->>'phone') returning id into c_id;
  end if;
  plate_value := upper(regexp_replace(coalesce(d->>'plate',''),'\s','','g'));
  if length(plate_value) > 20 then raise exception 'Matrícula demasiado larga.'; end if;
  if plate_value <> '' then
    select id, customer_id into v_id, owner_customer_id from public.vehicles where workshop_id = w_id and plate = plate_value;
    -- Unlike execute_command's staff-only intake branch, this never raises
    -- "pertenece a otro cliente" to an anonymous caller: which of the two
    -- outcomes (this exception vs. the generic validation error further
    -- down) came back was a plate/phone-ownership oracle for this
    -- workshop's customers, and since the raise aborted the transaction
    -- before the attempt counter below ran, probing it never spent the
    -- rate limit either. A colliding plate is instead treated as unusable
    -- for automatic linking: the visitor's own vehicle is created without
    -- it, and what they actually typed stays in the conversation
    -- transcript for staff to reconcile by hand.
    if v_id is not null and owner_customer_id <> c_id then v_id := null; plate_value := ''; end if;
  end if;
  if v_id is null and plate_value = '' then
    select id into v_id from public.vehicles where workshop_id = w_id and customer_id = c_id and lower(brand) = lower(trim(d->>'brand')) and lower(model) = lower(trim(d->>'model')) limit 1;
  end if;
  if v_id is null then
    insert into public.vehicles(workshop_id,customer_id,brand,model,plate) values(w_id,c_id,trim(d->>'brand'),trim(d->>'model'),plate_value) returning id into v_id;
  end if;
  insert into public.conversations(workshop_id,messages,channel) values(w_id, p_messages, 'public') returning id into conv_id;
  insert into public.requests(id,workshop_id,customer_id,vehicle_id,conversation_id,reason,availability,notes)
    values(p_client_id,w_id,c_id,v_id,conv_id,trim(d->>'reason'),trim(d->>'availability'),coalesce(trim(d->>'notes'),''));
  insert into public.audit_events(workshop_id,user_id,action,entity_type,entity_id) values(w_id,null,'public_intake','request',p_client_id);
  if client_ip is not null then
    insert into public.public_intake_attempts(workshop_id, ip) values (w_id, client_ip);
  end if;
  return true;
exception
  when unique_violation then raise exception 'Ya existe un registro con esos datos. Vuelve a intentarlo.' using errcode = 'P0001';
  when foreign_key_violation or check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Los datos no son válidos. Revisa los campos y vuelve a intentarlo.' using errcode = 'P0001';
end $$;
revoke all on function public.public_intake(text,jsonb,jsonb,uuid,text,timestamptz) from public, anon, authenticated;
grant execute on function public.public_intake(text,jsonb,jsonb,uuid,text,timestamptz) to anon, authenticated;

commit;
