-- Complete right of erasure (RGPD/LOPDGDD) for a customer's history.
-- Migration 011's customer_anonymize only overwrote the customer record and
-- their plates; their reception conversations (which store the raw
-- answers: name, phone, plate...), request free text, appointment notes,
-- their vehicles' brand/model and two kinds of audit metadata could all
-- keep personal data. This migration:
-- 1. adds internal helpers that scrub that history, keeping only
--    operational information that doesn't identify the customer (dates,
--    statuses, the reason/notes/brand/model minus every detected occurrence
--    of the customer's known identifiers);
-- 2. redefines execute_command so customer_anonymize calls them first, while
--    the record still holds the real name/phone/plates -- the body is 011's
--    unchanged except for that one call in the customer_anonymize branch;
-- 3. backfills customers already anonymized under 011, using whatever
--    identifiers can still be related to them safely (their own guided
--    conversations' answers and customer_merged originals).
-- Rows are only rewritten (and their version bumped) when their content
-- actually changes, so the backfill and a repeated anonymization are no-ops.
-- Every helper has an exact TypeScript twin in src/lib/erasure.ts (demo
-- mode), and src/lib/supabase/erasure.test.ts requires identical output from
-- both. Regexes avoid the engine's case-insensitive flag and \s/\w classes,
-- whose behaviour outside ASCII depends on the database locale: case comes
-- from the explicit Latin table below (other scripts only match in the case
-- they were written), and a name/plate only matches between separators, so
-- it never cuts another word of any script. Texts are compared in NFC.
-- The RPC's signature doesn't change, so app code and this migration can be
-- deployed in either order.
begin;

create or replace function public.erasure_term_pattern(p_term text, p_kind text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  lower_chars constant text := 'abcdefghijklmnopqrstuvwxyzáéíóúüñàèìòùâêîôûäëïöç';
  upper_chars constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛÄËÏÖÇ';
  -- No-break, figure and narrow no-break space (mobile keyboards, pasted text).
  unicode_spaces constant text := chr(160) || chr(8199) || chr(8239);
  separators constant text := ' \t\n\r' || unicode_spaces || '!"#$%&''()*+,./:;<=>?@_`{|}~\\\[\]\^\-¡¿«»“”‘’…–—·';
  ch text;
  body text := '';
  i integer;
begin
  if p_kind = 'phone' then
    for i in 1..char_length(p_term) loop
      body := body || case when i > 1 then '[ ' || unicode_spaces || '().-]*' else '' end || substr(p_term, i, 1);
    end loop;
    -- A 9-digit (Spanish national) number may be written after its country
    -- prefix: +34, 0034 or 34, with or without separators; a longer
    -- (international) one may start with + or 00.
    return '(?<![0-9])' || case when char_length(p_term) = 9
        then '(?:(?:\+|00)?[ ' || unicode_spaces || ']*34[ ' || unicode_spaces || '().-]*)?'
        else '(?:(?:\+|00)[ ' || unicode_spaces || ']*)?' end || body || '(?![0-9])';
  end if;
  for i in 1..char_length(p_term) loop
    ch := substr(p_term, i, 1);
    if p_kind = 'plate' and i > 1 then body := body || '[ ' || unicode_spaces || '-]*'; end if;
    if ch = ' ' then body := body || '[ \t\n\r' || unicode_spaces || ']+';
    elsif strpos(lower_chars || upper_chars, ch) > 0 then body := body || '[' || translate(ch, upper_chars, lower_chars) || translate(ch, lower_chars, upper_chars) || ']';
    elsif ch ~ '^[0-9]$' then body := body || ch;
    elsif ascii(ch) < 128 then body := body || '\' || ch;
    else body := body || ch;
    end if;
  end loop;
  return '(?<![^' || separators || '])' || body || '(?![^' || separators || '])';
end $$;

create or replace function public.erasure_patterns(p_names text[], p_phones text[], p_plates text[]) returns text[]
language plpgsql immutable set search_path = '' as $$
declare
  lower_chars constant text := 'abcdefghijklmnopqrstuvwxyzáéíóúüñàèìòùâêîôûäëïöç';
  upper_chars constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛÄËÏÖÇ';
  stop_words constant text[] := array['del','los','las','por','para','con','cliente','anonimizado','dato','datos','eliminado','eliminada','motivo'];
  unicode_spaces constant text := chr(160) || chr(8199) || chr(8239);
  raw text;
  full_name text;
  token text;
  digits text;
  plate text;
  pats text[] := '{}';
  lens integer[] := '{}';
  result text[];
begin
  foreach raw in array coalesce(p_names, '{}') loop
    continue when raw is null;
    full_name := regexp_replace(regexp_replace(normalize(raw, nfc), '[ \t\n\r' || unicode_spaces || ']+', ' ', 'g'), '^ +| +$', '', 'g');
    continue when char_length(full_name) < 2 or char_length(full_name) > 100 or full_name = 'Cliente anonimizado';
    if not (translate(full_name, upper_chars, lower_chars) = any(stop_words)) then
      pats := pats || public.erasure_term_pattern(full_name, 'name'); lens := lens || char_length(full_name);
    end if;
    foreach token in array regexp_split_to_array(full_name, '[ -]') loop
      if char_length(token) >= 3 and not (translate(token, upper_chars, lower_chars) = any(stop_words)) then
        pats := pats || public.erasure_term_pattern(token, 'name'); lens := lens || char_length(token);
      end if;
    end loop;
  end loop;
  foreach raw in array coalesce(p_phones, '{}') loop
    continue when raw is null;
    digits := regexp_replace(raw, '[^0-9]', '', 'g');
    continue when char_length(digits) < 7 or digits ~ '^0+$';
    if char_length(digits) > 9 then
      pats := pats || public.erasure_term_pattern(right(digits, 9), 'phone'); lens := lens || 9;
    end if;
    pats := pats || public.erasure_term_pattern(digits, 'phone'); lens := lens || char_length(digits);
  end loop;
  foreach raw in array coalesce(p_plates, '{}') loop
    continue when raw is null;
    plate := translate(regexp_replace(normalize(raw, nfc), '[ \t\n\r' || unicode_spaces || '-]', '', 'g'), lower_chars, upper_chars);
    continue when char_length(plate) < 3 or char_length(plate) > 20 or plate in ('OMITIR', 'NINGUNA');
    pats := pats || public.erasure_term_pattern(plate, 'plate'); lens := lens || char_length(plate);
  end loop;
  select coalesce(array_agg(pattern order by len desc, pattern collate "C"), '{}') into result
    from (select u.p as pattern, max(u.l) as len from unnest(pats, lens) as u(p, l) group by u.p) t;
  return result;
end $$;

create or replace function public.erasure_redact(p_text text, p_patterns text[]) returns text
language plpgsql immutable set search_path = '' as $$
declare
  pattern text;
  result text;
begin
  if p_text is null then return null; end if;
  result := normalize(p_text, nfc);
  foreach pattern in array coalesce(p_patterns, '{}') loop
    result := regexp_replace(result, pattern, '[dato eliminado]', 'g');
  end loop;
  return result;
end $$;

create or replace function public.erase_customer_personal_data(p_workshop_id uuid, p_customer_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  erased constant text := '[Eliminado por derecho de supresión]';
  names text[] := '{}';
  phones text[] := '{}';
  plates text[] := '{}';
  answers text[];
  patterns text[];
  customer record;
  conversation record;
  merged record;
begin
  select name, phone, phone_e164 into customer from public.customers where workshop_id = p_workshop_id and id = p_customer_id;
  if not found then return; end if;
  if customer.name <> 'Cliente anonimizado' then names := names || customer.name; end if;
  if customer.phone <> '+00000000' then phones := phones || customer.phone; end if;
  if customer.phone_e164 is not null then phones := phones || customer.phone_e164; end if;
  plates := plates || coalesce((select array_agg(plate) from public.vehicles where workshop_id = p_workshop_id and customer_id = p_customer_id and plate <> ''), '{}');
  -- The guided intake's answers, in its fixed question order (name, phone,
  -- brand, model, plate, ...), unchanged since the first commit. Only a
  -- complete, not yet scrubbed conversation of 8 answers is trusted.
  for conversation in
    select c.messages from public.conversations c
    join public.requests r on r.workshop_id = c.workshop_id and r.conversation_id = c.id
    where r.workshop_id = p_workshop_id and r.customer_id = p_customer_id
  loop
    select array_agg(m->>'content' order by o) into answers
      from jsonb_array_elements(conversation.messages) with ordinality as e(m, o) where m->>'role' = 'user';
    if coalesce(array_length(answers, 1), 0) = 8 and not (erased = any(answers)) then
      names := names || answers[1]; phones := phones || answers[2]; plates := plates || answers[5];
    end if;
  end loop;
  for merged in
    select metadata->'original_customer' as original from public.audit_events
    where workshop_id = p_workshop_id and action = 'customer_merged' and entity_id = p_customer_id
  loop
    if jsonb_typeof(merged.original->'name') = 'string' then names := names || (merged.original->>'name'); end if;
    if jsonb_typeof(merged.original->'phone') = 'string' then phones := phones || (merged.original->>'phone'); end if;
    if jsonb_typeof(merged.original->'phone_e164') = 'string' then phones := phones || (merged.original->>'phone_e164'); end if;
  end loop;
  patterns := public.erasure_patterns(names, phones, plates);

  -- Every message, whatever its role, is rebuilt as { role, content }: no
  -- extra keys and no original text survive.
  update public.conversations c set messages = x.messages
    from (select c2.id, coalesce((select jsonb_agg(jsonb_build_object('role', m->'role', 'content', erased) order by o)
                                  from jsonb_array_elements(c2.messages) with ordinality as e(m, o)), '[]'::jsonb) as messages
          from public.conversations c2
          where c2.workshop_id = p_workshop_id
            and c2.id in (select conversation_id from public.requests where workshop_id = p_workshop_id and customer_id = p_customer_id)) x
    where c.workshop_id = p_workshop_id and c.id = x.id and c.messages is distinct from x.messages;
  update public.requests r set reason = x.reason, availability = 'Eliminada', notes = '', version = r.version + 1
    from (select id, case when char_length(trim(t.redacted)) < 5 then 'Motivo eliminado' else t.redacted end as reason
          from (select id, left(public.erasure_redact(reason, patterns), 2000) as redacted from public.requests
                where workshop_id = p_workshop_id and customer_id = p_customer_id) t) x
    where r.workshop_id = p_workshop_id and r.id = x.id
      and (r.reason, r.availability, r.notes) is distinct from (x.reason, 'Eliminada', '');
  update public.appointments a set notes = x.notes, version = a.version + 1
    from (select a2.id, left(public.erasure_redact(a2.notes, patterns), 2000) as notes from public.appointments a2
          where a2.workshop_id = p_workshop_id
            and a2.request_id in (select id from public.requests where workshop_id = p_workshop_id and customer_id = p_customer_id)) x
    where a.workshop_id = p_workshop_id and a.id = x.id and a.notes is distinct from x.notes;
  update public.vehicles v set brand = x.brand, model = x.model, version = v.version + 1
    from (select id, left(public.erasure_redact(brand, patterns), 60) as brand, left(public.erasure_redact(model, patterns), 80) as model
          from public.vehicles where workshop_id = p_workshop_id and customer_id = p_customer_id) x
    where v.workshop_id = p_workshop_id and v.id = x.id and (v.brand, v.model) is distinct from (x.brand, x.model);
  update public.audit_events a set metadata = x.metadata
    from (select id, jsonb_build_object('original_customer', jsonb_build_object('id', metadata->'original_customer'->'id'), 'personal_data_erased', true) as metadata
          from public.audit_events where workshop_id = p_workshop_id and action = 'customer_merged' and entity_id = p_customer_id) x
    where a.workshop_id = p_workshop_id and a.id = x.id and a.metadata is distinct from x.metadata;
  update public.audit_events a set metadata = x.metadata
    from (select e.id, e.metadata
            || case when jsonb_typeof(e.metadata->'previous_brand') = 'string' then jsonb_build_object('previous_brand', public.erasure_redact(e.metadata->>'previous_brand', patterns)) else '{}'::jsonb end
            || case when jsonb_typeof(e.metadata->'previous_model') = 'string' then jsonb_build_object('previous_model', public.erasure_redact(e.metadata->>'previous_model', patterns)) else '{}'::jsonb end as metadata
          from public.audit_events e
          where e.workshop_id = p_workshop_id and e.action = 'vehicle_corrected'
            and e.entity_id in (select id from public.vehicles where workshop_id = p_workshop_id and customer_id = p_customer_id)) x
    where a.workshop_id = p_workshop_id and a.id = x.id and a.metadata is distinct from x.metadata;
end $$;

revoke all on function public.erasure_term_pattern(text, text) from public, anon, authenticated;
revoke all on function public.erasure_patterns(text[], text[], text[]) from public, anon, authenticated;
revoke all on function public.erasure_redact(text, text[]) from public, anon, authenticated;
revoke all on function public.erase_customer_personal_data(uuid, uuid) from public, anon, authenticated;

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
  if kind in ('settings','resource','workshop_hours','workshop_hour_exception','workshop_hour_exception_delete','customer_anonymize') and actor_role<>'owner' then raise exception 'Solo el propietario puede realizar esta operación.'; end if;
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
  elsif kind='customer_anonymize' then
    -- Anonymize instead of delete: requests/appointments/conversations for
    -- this customer are kept (the workshop's own operational/warranty
    -- history), only the identifying fields on customers/vehicles are
    -- scrubbed. phone must stay a syntactically valid phone (customers'
    -- own check constraint), so it becomes a fixed placeholder rather than
    -- an empty string; phone_e164 is nulled instead, which is what both the
    -- uniqueness index and the intake/customer lookups actually key off,
    -- so this placeholder never collides with a real customer and a later
    -- real submission from the original phone number correctly creates a
    -- fresh customer rather than resurrecting this one.
    item_id := (p_command->>'id')::uuid;
    select version into current_version from public.customers where workshop_id=p_workshop_id and id=item_id;
    if current_version is null then raise exception 'No se ha encontrado el cliente.'; end if;
    if current_version is distinct from (p_command->>'version')::integer then raise exception 'Este registro ha cambiado. Actualiza la vista antes de guardar.'; end if;
    -- 015: scrub the history first, while the record still holds its real
    -- name/phone/plates (the only change to 011's body).
    perform public.erase_customer_personal_data(p_workshop_id, item_id);
    insert into public.audit_events(workshop_id,user_id,action,entity_type,entity_id)
      select p_workshop_id,auth.uid(),'vehicle_plate_erased','vehicle',id from public.vehicles where workshop_id=p_workshop_id and customer_id=item_id and plate<>'';
    update public.vehicles set plate='',version=version+1 where workshop_id=p_workshop_id and customer_id=item_id and plate<>'';
    update public.customers set
      name='Cliente anonimizado',
      phone='+00000000',
      phone_e164=null,
      notes='Datos personales eliminados el '||to_char(clock_timestamp(),'YYYY-MM-DD')||' a petición del cliente (derecho de supresión, RGPD/LOPDGDD).',
      version=version+1
      where workshop_id=p_workshop_id and id=item_id;
  else raise exception 'Operación no reconocida.';
  end if;
  target_entity := case when kind in ('intake','status') then 'request' when kind in ('appointment','appointment_status') then 'appointment' when kind in ('settings','workshop_hours') then 'workshop' when kind in ('workshop_hour_exception','workshop_hour_exception_delete') then 'workshop_hour_exception' when kind='customer_anonymize' then 'customer' else kind end;
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

-- Backfill: customers anonymized under 011 (exact record left by that
-- command). Their real name/phone/plates are gone, so only identifiers that
-- can still be related to them safely are used: the answers of their own
-- complete guided conversations and customer_merged originals. Runs as the
-- migration's owner; no audit event (there is no acting user).
do $$
declare
  c record;
begin
  for c in
    select workshop_id, id from public.customers
    where name = 'Cliente anonimizado' and phone_e164 is null and notes like 'Datos personales eliminados el %'
  loop
    perform public.erase_customer_personal_data(c.workshop_id, c.id);
  end loop;
end $$;

commit;
