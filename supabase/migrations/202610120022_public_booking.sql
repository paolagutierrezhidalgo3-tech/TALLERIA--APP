-- Public self-booking from the digital reception (phase 1 of the receptionist
-- flow). Until now a public visitor could only describe their availability
-- as free text and staff created the appointment by hand. This migration:
-- 1. adds workshop_free_slots(workshop, from, to), an internal helper (not
--    executable by anon/authenticated) that lists the bookable start times
--    of a workshop: its structured business hours (weekly ranges, with a
--    dated exception overriding the whole day) cut into slots of
--    workshops.appointment_minutes, each one paired with the first active
--    resource (by id, the same default execute_command uses) that has no
--    overlapping scheduled appointment. A workshop with no structured hours
--    or no active resource has no slots: self-booking stays off for it and
--    the form keeps the free-text availability question;
-- 2. adds public_availability(slug, days), anonymous-safe: only the free
--    start times (from one hour from now, up to 14 days ahead by default,
--    at most 21), the slot duration and the timezone -- never who booked
--    what, nor which resource;
-- 3. redefines public_intake (same signature, defaults, security definer,
--    search_path and grants as 017) with 017's logic (its long comments
--    shortened, pointing back to 016/017) plus an optional
--    p_data.slot_starts_at: when present, the chosen start must still be one
--    of workshop_free_slots at that moment (and at least 15 minutes ahead,
--    at most 15 days), otherwise the whole submission is rejected with
--    "Esa hora ya no está disponible" and nothing is written; when it is,
--    the request is created with status cita_creada and a scheduled
--    appointment on the free resource, and its availability text is
--    replaced by the booked local time (the server's, not the client's).
-- Abuse limit (anonymous bookings hold real capacity): a workshop takes at
-- most 10 self-bookings per rolling 24 hours (counted from the audit action
-- public_booking); past it the visitor is asked to send the request without
-- booking. No per-phone limit: its answer would tell an anonymous caller
-- whether a phone number has an appointment here. A retry of a stored
-- submission (same client id) must ask for exactly the booking it stored,
-- compared with the hour recorded in that audit row (never with the
-- appointment itself, which staff can edit, move or cancel).
-- Duplicates: public_intake already locks the workshop row before writing,
-- and so does execute_command (the staff calendar), so two bookings of the
-- same slot -- public or staff -- are serialized and the second one sees the
-- first one's appointment. Without a slot, public_intake behaves exactly as
-- in 017.
begin;

create function public.workshop_free_slots(p_workshop_id uuid, p_from timestamptz, p_to timestamptz)
returns table(starts_at timestamptz, resource_id uuid)
language sql stable set search_path = '' as $$
  with w as (
    select timezone as tz, appointment_minutes as m from public.workshops
    where id = p_workshop_id and exists(select 1 from public.workshop_hours h where h.workshop_id = p_workshop_id)
  ),
  days as (
    select generate_series((p_from at time zone w.tz)::date, (p_to at time zone w.tz)::date, interval '1 day')::date as d from w
  ),
  ranges as (
    select days.d, e.opens_at, e.closes_at from days
      join public.workshop_hour_exceptions e on e.workshop_id = p_workshop_id and e.exception_date = days.d and not e.closed
    union all
    select days.d, h.opens_at, h.closes_at from days
      join public.workshop_hours h on h.workshop_id = p_workshop_id and h.day_of_week = extract(isodow from days.d)
      where not exists(select 1 from public.workshop_hour_exceptions e where e.workshop_id = p_workshop_id and e.exception_date = days.d)
  ),
  candidates as (
    select distinct (r.d + r.opens_at + make_interval(mins => k * w.m)) at time zone w.tz as s
    from ranges r cross join w
    cross join lateral generate_series(0, floor(extract(epoch from (r.closes_at - r.opens_at)) / 60 / w.m)::integer - 1) as k
  ),
  free as (
    select c.s, (
      select res.id from public.resources res
      where res.workshop_id = p_workshop_id and res.active
        and not exists(select 1 from public.appointments a
          where a.workshop_id = p_workshop_id and a.resource_id = res.id and a.status = 'scheduled'
            and c.s < a.starts_at + make_interval(mins => a.duration_minutes)
            and c.s + make_interval(mins => w.m) > a.starts_at)
      order by res.id limit 1
    ) as resource_id
    from candidates c cross join w
    -- The candidate is a wall-clock time; is_within_business_hours checks
    -- the real end instant too, so a slot that a DST change pushes past
    -- closing time is dropped, exactly as the staff calendar would reject it.
    where c.s >= p_from and c.s < p_to and public.is_within_business_hours(p_workshop_id, c.s, w.m)
  )
  select s, resource_id from free where resource_id is not null order by s
$$;
revoke all on function public.workshop_free_slots(uuid,timestamptz,timestamptz) from public, anon, authenticated;

create function public.public_availability(p_slug text, p_days integer default 14) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  w record;
  days integer := least(greatest(coalesce(p_days, 14), 1), 21);
  slots jsonb;
begin
  select id, timezone, appointment_minutes into w from public.workshops where slug = lower(trim(coalesce(p_slug,'')));
  if w.id is null then return null; end if;
  select coalesce(jsonb_agg(to_jsonb(f.starts_at) order by f.starts_at), '[]'::jsonb) into slots
    from (select starts_at from public.workshop_free_slots(w.id, now() + interval '1 hour', now() + make_interval(days => days)) limit 400) f;
  return jsonb_build_object('timezone', w.timezone, 'duration_minutes', w.appointment_minutes, 'slots', slots);
end $$;
revoke all on function public.public_availability(text,integer) from public, anon, authenticated;
grant execute on function public.public_availability(text,integer) to anon, authenticated;

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
  slot_value timestamptz;
  slot_resource uuid;
  slot_minutes integer;
  slot_tz text;
  availability_value text;
  requested_slot timestamptz;
  appointment_id uuid := gen_random_uuid();
begin
  if p_client_id is null then raise exception 'Solicitud no válida.'; end if;
  select id into w_id from public.workshops where slug = lower(trim(coalesce(p_slug,'')));
  if w_id is null then raise exception 'No se ha encontrado el taller.'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or octet_length(coalesce(p_data::text,'')) + octet_length(coalesce(p_messages::text,'')) > 65536 then
    raise exception 'La operación contiene demasiados datos o no es válida.';
  end if;
  if p_consent is not true then raise exception 'Debes aceptar el aviso legal para continuar.'; end if;
  if coalesce(p_hp, '') <> '' then return false; end if;
  if p_started_at is not null and clock_timestamp() - p_started_at >= interval '0 seconds' and clock_timestamp() - p_started_at < interval '20 seconds' then return false; end if;

  client_ip := public.request_client_bucket(raw_headers);
  perform 1 from public.workshops where id = w_id for update;
  delete from public.public_intake_attempts where created_at <= now() - interval '1 hour';
  -- 022: the requested slot is parsed before the idempotency check, so a
  -- retry of an already stored submission (the first answer was lost) can
  -- only succeed if it asks for exactly what was stored: the same booked
  -- hour, or no booking. A retry that changed the hour would otherwise get
  -- "true" and the visitor would be told about a booking that doesn't exist.
  if p_data ? 'slot_starts_at' and jsonb_typeof(p_data->'slot_starts_at') <> 'null' then
    if jsonb_typeof(p_data->'slot_starts_at') <> 'string' or length(p_data->>'slot_starts_at') > 40 then raise exception 'La hora elegida no es válida.'; end if;
    requested_slot := (p_data->>'slot_starts_at')::timestamptz;
  end if;
  if exists(select 1 from public.requests where workshop_id = w_id and id = p_client_id) then
    if (select (e.metadata->>'starts_at')::timestamptz from public.audit_events e where e.workshop_id = w_id and e.action = 'public_booking' and e.metadata->>'request_id' = p_client_id::text limit 1) is distinct from requested_slot then
      -- The client id is a random UUID only this visitor's form knows, so
      -- telling them what their own stored request says reveals nothing new.
      raise exception 'Tu solicitud ya estaba enviada (%). Si quieres cambiar la hora, llama al taller.', (select availability from public.requests where workshop_id = w_id and id = p_client_id);
    end if;
    -- Same booking as stored, but "true" makes the form say the booking
    -- stands at that hour: only when it still does (staff may have moved or
    -- cancelled it since).
    if requested_slot is not null and not exists(select 1 from public.appointments where workshop_id = w_id and request_id = p_client_id and status = 'scheduled' and starts_at = requested_slot) then
      raise exception 'Tu solicitud ya estaba enviada, pero el taller ha cambiado esa cita desde entonces. Te llamará para confirmarla.';
    end if;
    return true;
  end if;
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

  -- 022: optional self-booked slot, checked under the workshop lock taken
  -- above (the only addition to 017's body, together with the appointment
  -- insert and the request status/availability below).
  availability_value := trim(d->>'availability');
  if requested_slot is not null then
    slot_value := requested_slot;
    if not isfinite(slot_value) or slot_value < now() + interval '15 minutes' or slot_value > now() + interval '15 days' then
      raise exception 'Esa hora ya no está disponible. Elige otra.';
    end if;
    select f.resource_id into slot_resource from public.workshop_free_slots(w_id, slot_value, slot_value + interval '1 second') f where f.starts_at = slot_value limit 1;
    if slot_resource is null then raise exception 'Esa hora ya no está disponible. Elige otra.'; end if;
    select appointment_minutes, timezone into slot_minutes, slot_tz from public.workshops where id = w_id;
    availability_value := 'Cita reservada por el cliente: ' || to_char(slot_value at time zone slot_tz, 'DD/MM/YYYY HH24:MI');
  end if;

  select id into c_id from public.customers where workshop_id = w_id and phone_e164 = d->>'phone';
  if c_id is null then
    insert into public.customers(workshop_id,name,phone,phone_e164) values(w_id,trim(d->>'name'),d->>'phone',d->>'phone') returning id into c_id;
  end if;
  plate_value := upper(regexp_replace(coalesce(d->>'plate',''),'\s','','g'));
  if length(plate_value) > 20 then raise exception 'Matrícula demasiado larga.'; end if;
  if plate_value <> '' then
    select id, customer_id into v_id, owner_customer_id from public.vehicles where workshop_id = w_id and plate = plate_value;
    -- Never reveal to an anonymous caller that a plate belongs to another
    -- customer (see 016/017): a colliding plate is just not linked.
    if v_id is not null and owner_customer_id <> c_id then v_id := null; plate_value := ''; end if;
  end if;
  if v_id is null and plate_value = '' then
    select id into v_id from public.vehicles where workshop_id = w_id and customer_id = c_id and lower(brand) = lower(trim(d->>'brand')) and lower(model) = lower(trim(d->>'model')) limit 1;
  end if;
  if v_id is null then
    insert into public.vehicles(workshop_id,customer_id,brand,model,plate) values(w_id,c_id,trim(d->>'brand'),trim(d->>'model'),plate_value) returning id into v_id;
  end if;
  insert into public.conversations(workshop_id,messages,channel) values(w_id, p_messages, 'public') returning id into conv_id;
  insert into public.requests(id,workshop_id,customer_id,vehicle_id,conversation_id,reason,availability,notes,consent_at,status)
    values(p_client_id,w_id,c_id,v_id,conv_id,trim(d->>'reason'),availability_value,coalesce(trim(d->>'notes'),''),clock_timestamp(),case when slot_value is null then 'nueva' else 'cita_creada' end);
  insert into public.audit_events(workshop_id,user_id,action,entity_type,entity_id) values(w_id,null,'public_intake','request',p_client_id);
  if slot_value is not null then
    -- 022: anonymous bookings hold real capacity, so a workshop accepts at
    -- most 10 per rolling 24 hours; nothing is written past that.
    if (select count(*) from public.audit_events where workshop_id = w_id and action = 'public_booking' and created_at > clock_timestamp() - interval '24 hours') >= 10 then
      raise exception 'No podemos reservar esta hora automáticamente. Envía la solicitud sin reservar y el taller te llamará.';
    end if;
    insert into public.appointments(id,workshop_id,request_id,resource_id,starts_at,duration_minutes,notes)
      values(appointment_id,w_id,p_client_id,slot_resource,slot_value,slot_minutes,'Reservada por el cliente desde la recepción digital.');
    insert into public.audit_events(workshop_id,user_id,action,entity_type,entity_id,metadata)
      values(w_id,null,'public_booking','appointment',appointment_id,jsonb_build_object('request_id',p_client_id,'starts_at',slot_value));
  end if;
  if client_ip is not null then
    insert into public.public_intake_attempts(workshop_id, ip) values (w_id, client_ip);
  end if;
  return true;
exception
  when unique_violation then raise exception 'Ya existe un registro con esos datos. Vuelve a intentarlo.' using errcode = 'P0001';
  when foreign_key_violation or check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
    raise exception 'Los datos no son válidos. Revisa los campos y vuelve a intentarlo.' using errcode = 'P0001';
end $$;
revoke all on function public.public_intake(text,jsonb,jsonb,uuid,text,timestamptz,boolean) from public, anon, authenticated;
grant execute on function public.public_intake(text,jsonb,jsonb,uuid,text,timestamptz,boolean) to anon, authenticated;

commit;
