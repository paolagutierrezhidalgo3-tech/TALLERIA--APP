-- Explicit consent for the public reception link: a real visitor must now
-- tick a checkbox pointing at /r/<slug>/aviso-legal before public_intake
-- will create their request, and the moment they did is recorded for
-- accountability. Manual/staff-entered requests (channel 'simulator') are
-- unaffected -- consent_at stays null for those, same as today.
-- Apply AFTER 202609220006_public_reception.sql. Every existing table,
-- policy, grant and function other than public_intake is unchanged.
begin;

alter table public.requests add column consent_at timestamptz;

-- Adding a parameter changes public_intake's identity to Postgres (a
-- different argument list), so `create or replace` alone would leave the
-- old 6-argument version reachable too -- and that one never required
-- consent. Drop it explicitly first so only the new, consent-checking
-- version can ever be called.
drop function public.public_intake(text,jsonb,jsonb,uuid,text,timestamptz);

create function public.public_intake(
  p_slug text, p_data jsonb, p_messages jsonb, p_client_id uuid,
  p_hp text default '', p_started_at timestamptz default null, p_consent boolean default false
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
  -- A real validation error, not one of the silent-false bot heuristics
  -- below: the checkbox is a real UI control the visitor must tick, so a
  -- caller that omits it should see why, the same as any other missing
  -- required field. The client keeps this value stable across a retry of
  -- the same submission, so a legitimate retry never trips this.
  if p_consent is not true then raise exception 'Debes aceptar el aviso legal para continuar.'; end if;
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
  insert into public.requests(id,workshop_id,customer_id,vehicle_id,conversation_id,reason,availability,notes,consent_at)
    values(p_client_id,w_id,c_id,v_id,conv_id,trim(d->>'reason'),trim(d->>'availability'),coalesce(trim(d->>'notes'),''),clock_timestamp());
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
revoke all on function public.public_intake(text,jsonb,jsonb,uuid,text,timestamptz,boolean) from public, anon, authenticated;
grant execute on function public.public_intake(text,jsonb,jsonb,uuid,text,timestamptz,boolean) to anon, authenticated;

commit;
