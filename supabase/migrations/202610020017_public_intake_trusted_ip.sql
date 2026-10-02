-- Trusted client IP for public_intake's rate limit (Plan Master, section 7,
-- point 21). Since 006 the limit (5 accepted submissions per IP and workshop
-- per hour) keyed on the FIRST x-forwarded-for entry. Verified on the real
-- project (2 October 2026, temporary read-only diagnostic RPCs, since
-- dropped): Supabase's gateway keeps a client-supplied X-Forwarded-For as
-- the first entry and appends the real address last, so a caller could
-- rotate a forged first entry and never hit the limit; a malformed header
-- made the key null, which skipped the limit and its record entirely.
-- cf-connecting-ip carried the real address in every call and a request
-- forging it was rejected by Cloudflare (403) before reaching Supabase.
-- This migration:
-- 1. adds two internal helpers (not executable by anon/authenticated):
--    request_client_address(text) parses one header value (any surrounding
--    whitespace trimmed; at most 64 characters; no '/' -- a bare address,
--    never a network) and returns null if it isn't one;
--    request_client_bucket(headers) picks the rate-limit key:
--    - cf-connecting-ip, set by Cloudflare's edge;
--    - but if that is a Cloudflare "Pseudo IPv4" address (240.0.0.0/4, used
--      when that zone setting overwrites the headers for IPv6 visitors),
--      cf-connecting-ipv6 instead -- only in that case, so a client can't
--      choose its key with that header when the mode is off -- and with no
--      valid IPv6 there, the shared unknown bucket;
--    - with no cf-connecting-ip, the LAST x-forwarded-for entry (the one the
--      gateway appends), never the first; an x-forwarded-for longer than
--      2000 characters is ignored;
--    IPv4 keys are the address, IPv6 keys its /64 prefix (one household's
--    whole block, which can otherwise rotate addresses freely; it also
--    stores less), IPv4-mapped IPv6 addresses are keyed as IPv4, and with
--    no valid address the key is the shared 0.0.0.0 bucket per workshop, so
--    a missing or malformed header is limited instead of exempt;
-- 2. redefines public_intake (same signature, defaults, security definer,
--    search_path and grants as 016) with 016's body except the IP block,
--    replaced by a call to request_client_bucket.
-- If the infrastructure ever stops sending a usable address, everyone of a
-- workshop shares the unknown bucket: the form fails closed (stricter),
-- never open. Not verified: how Cloudflare treats a client-supplied
-- CF-Connecting-IPv6 when Pseudo IPv4 is on (that mode isn't known to be
-- enabled for this project). A global per-workshop cap was analysed and
-- deliberately left out until there are real pilot data (Plan Master,
-- point 22).
begin;

create or replace function public.request_client_address(p_value text) returns inet
language plpgsql immutable set search_path = '' as $$
declare
  candidate text := regexp_replace(coalesce(p_value, ''), '^\s+|\s+$', '', 'g');
begin
  if candidate = '' or char_length(candidate) > 64 or position('/' in candidate) > 0 then
    return null;
  end if;
  return candidate::inet;
exception when others then
  return null;
end $$;
revoke all on function public.request_client_address(text) from public, anon, authenticated;

create or replace function public.request_client_bucket(p_headers text) returns inet
language plpgsql immutable set search_path = '' as $$
declare
  headers json;
  forwarded text;
  entries text[];
  ip inet;
begin
  begin
    headers := p_headers::json;
  exception when others then
    headers := null;
  end;
  if headers is not null and json_typeof(headers) = 'object' then
    ip := public.request_client_address(headers->>'cf-connecting-ip');
    if ip is not null and family(ip) = 4 and ip << '240.0.0.0/4'::inet then
      ip := public.request_client_address(headers->>'cf-connecting-ipv6');
      if ip is null or family(ip) <> 6 then
        return '0.0.0.0'::inet;
      end if;
    elsif ip is null then
      forwarded := headers->>'x-forwarded-for';
      if forwarded is not null and char_length(forwarded) <= 2000 then
        entries := string_to_array(forwarded, ',');
        ip := public.request_client_address(entries[array_length(entries, 1)]);
      end if;
    end if;
  end if;
  if ip is null then
    return '0.0.0.0'::inet;
  end if;
  if family(ip) = 6 and ip << '::ffff:0.0.0.0/96'::inet then
    return '0.0.0.0'::inet + (ip - '::ffff:0.0.0.0'::inet);
  end if;
  if family(ip) = 6 then
    return network(set_masklen(ip, 64))::inet;
  end if;
  return host(ip)::inet;
end $$;
revoke all on function public.request_client_bucket(text) from public, anon, authenticated;

create or replace function public.public_intake(
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

  -- 017: the rate-limit key comes from the trusted source, never from the
  -- client-controlled first x-forwarded-for entry, and is never null (the
  -- only change to 016's body).
  client_ip := public.request_client_bucket(raw_headers);
  perform 1 from public.workshops where id = w_id for update;
  -- 016: rows older than the rate-limit window are never needed again (the
  -- only change to 007's body).
  delete from public.public_intake_attempts where created_at <= now() - interval '1 hour';
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
