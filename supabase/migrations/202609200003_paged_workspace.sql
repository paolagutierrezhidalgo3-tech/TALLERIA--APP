begin;
create function public.workspace_snapshot(p_workshop_id uuid,p_view text default 'dashboard',p_offset integer default 0,p_search text default '',p_status text default 'all') returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare
  actor_role text; q text := lower(coalesce(p_search,''));
  ids uuid[] := '{}'; reqs uuid[] := '{}'; custs uuid[] := '{}'; vehs uuid[] := '{}'; convs uuid[] := '{}'; apps uuid[] := '{}'; total bigint := 0;
begin
  select role into actor_role from public.workshop_members where workshop_id=p_workshop_id and user_id=auth.uid();
  if actor_role is null then raise exception 'No tienes acceso a este taller.' using errcode='42501'; end if;
  if p_view not in ('dashboard','requests','customers','vehicles','conversations','appointments','reception','settings') or p_offset is null or p_offset<0 or p_offset>1000000 or length(q)>120 then raise exception 'La consulta no es válida.'; end if;
  if p_view='requests' then
    select count(*) into total from public.requests r join public.customers c on c.workshop_id=r.workshop_id and c.id=r.customer_id join public.vehicles v on v.workshop_id=r.workshop_id and v.id=r.vehicle_id where r.workshop_id=p_workshop_id and (p_status='all' or r.status=p_status) and strpos(lower(r.reason||' '||c.name||' '||c.phone||' '||v.plate),q)>0;
    select coalesce(array_agg(id),'{}'::uuid[]) into ids from (select r.id from public.requests r join public.customers c on c.workshop_id=r.workshop_id and c.id=r.customer_id join public.vehicles v on v.workshop_id=r.workshop_id and v.id=r.vehicle_id where r.workshop_id=p_workshop_id and (p_status='all' or r.status=p_status) and strpos(lower(r.reason||' '||c.name||' '||c.phone||' '||v.plate),q)>0 order by r.created_at desc,r.id limit 25 offset p_offset) page;
  elsif p_view='customers' then
    select count(*) into total from public.customers c where c.workshop_id=p_workshop_id and strpos(lower(c.name||' '||c.phone),q)>0;
    select coalesce(array_agg(id),'{}'::uuid[]) into ids from (select c.id from public.customers c where c.workshop_id=p_workshop_id and strpos(lower(c.name||' '||c.phone),q)>0 order by c.name,c.id limit 25 offset p_offset) page;
  elsif p_view='vehicles' then
    select count(*) into total from public.vehicles v join public.customers c on c.workshop_id=v.workshop_id and c.id=v.customer_id where v.workshop_id=p_workshop_id and strpos(lower(v.brand||' '||v.model||' '||v.plate||' '||c.name),q)>0;
    select coalesce(array_agg(id),'{}'::uuid[]) into ids from (select v.id from public.vehicles v join public.customers c on c.workshop_id=v.workshop_id and c.id=v.customer_id where v.workshop_id=p_workshop_id and strpos(lower(v.brand||' '||v.model||' '||v.plate||' '||c.name),q)>0 order by v.brand,v.id limit 25 offset p_offset) page;
  elsif p_view='conversations' then
    select count(*) into total from public.conversations c where c.workshop_id=p_workshop_id and strpos(lower(c.messages::text),q)>0;
    select coalesce(array_agg(id),'{}'::uuid[]) into ids from (select c.id from public.conversations c where c.workshop_id=p_workshop_id and strpos(lower(c.messages::text),q)>0 order by c.created_at desc,c.id limit 25 offset p_offset) page;
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
    'schema_version',2,'role',actor_role,'user_id',auth.uid(),
    'workshop',(select to_jsonb(w) from public.workshops w where id=p_workshop_id),
    'resources',(select coalesce(jsonb_agg(to_jsonb(r) order by r.name,r.id),'[]') from public.resources r where workshop_id=p_workshop_id),
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

create function public.lookup_options(p_workshop_id uuid,p_kind text,p_search text default '') returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare q text:=lower(coalesce(p_search,'')); result jsonb;
begin
  if not exists(select 1 from public.workshop_members where workshop_id=p_workshop_id and user_id=auth.uid()) then raise exception 'No tienes acceso a este taller.' using errcode='42501'; end if;
  if length(q)>120 then raise exception 'La búsqueda es demasiado larga.'; end if;
  if p_kind='customer' then
    select coalesce(jsonb_agg(to_jsonb(o)),'[]') into result from (
      select c.id,c.name||' · '||c.phone as label from public.customers c where workshop_id=p_workshop_id and strpos(lower(c.name||' '||c.phone),q)>0 order by c.name,c.id limit 20
    ) o;
  elsif p_kind='request' then
    select coalesce(jsonb_agg(to_jsonb(o)),'[]') into result from (
      select r.id,c.name||' · '||r.reason as label from public.requests r join public.customers c on c.workshop_id=r.workshop_id and c.id=r.customer_id
      where r.workshop_id=p_workshop_id and r.status not in ('completada','cancelada') and not exists(select 1 from public.appointments a where a.workshop_id=p_workshop_id and a.request_id=r.id and a.status='scheduled')
      and strpos(lower(c.name||' '||r.reason),q)>0 order by r.created_at desc,r.id limit 20
    ) o;
  else raise exception 'Tipo de búsqueda no válido.'; end if;
  return result;
end $$;
revoke all on function public.lookup_options(uuid,text,text) from public,anon;
grant execute on function public.lookup_options(uuid,text,text) to authenticated;
create index requests_customer_count on public.requests(workshop_id,customer_id);
commit;
