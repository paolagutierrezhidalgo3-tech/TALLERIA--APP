import { searchText } from './search';
import type { State } from './domain';
export type View = 'dashboard' | 'requests' | 'customers' | 'vehicles' | 'conversations' | 'appointments' | 'calendar' | 'customer_detail' | 'vehicle_detail' | 'reception' | 'settings';
// range_start/range_end (ISO instants) are only used by view:'calendar', to
// select appointments overlapping [range_start, range_end) instead of
// paginating by offset -- a calendar grid needs every appointment in the
// visible range, not one fixed-size page of it.
// entity_id is only used by view:'customer_detail'/'vehicle_detail': the
// customer or vehicle id whose full history (every request, every
// appointment regardless of status, and -- for a customer -- every vehicle)
// to return, capped at 200 requests, never paginated by offset either.
export interface ViewQuery { view: View; offset: number; search: string; status: string; range_start?: string; range_end?: string; entity_id?: string }
const HISTORY_LIMIT = 200;
export interface LookupOption { id: string; label: string; version?: number }
export const PAGE_SIZE = 25;
export const defaultQuery: ViewQuery = { view: 'dashboard', offset: 0, search: '', status: 'all' };
export function projectState(s: State, query: ViewQuery = defaultQuery): State {
  const q = searchText(query.search);
  const match = (value: string) => searchText(value).includes(q);
  const name = (id: string) => s.customers.find(c => c.id===id)?.name ?? '';
  const plate = (id: string) => s.vehicles.find(v => v.id===id)?.plate ?? '';
  let ids: string[] = [];
  const requests = [...s.requests].sort((a,b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
  const appointments = [...s.appointments].sort((a,b) => (a.status==='scheduled'?0:1)-(b.status==='scheduled'?0:1) || (a.status==='scheduled' ? a.starts_at.localeCompare(b.starts_at) : b.starts_at.localeCompare(a.starts_at)) || a.id.localeCompare(b.id));
  if (query.view==='requests') ids = requests.filter(r => (query.status==='all'||r.status===query.status) && match(r.reason+' '+name(r.customer_id)+' '+(s.customers.find(c=>c.id===r.customer_id)?.phone??'')+' '+plate(r.vehicle_id))).map(r=>r.id);
  if (query.view==='customers') ids = [...s.customers].sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id)).filter(c=>match(c.name+' '+c.phone)).map(c=>c.id);
  if (query.view==='vehicles') ids = [...s.vehicles].sort((a,b)=>a.brand.localeCompare(b.brand)||a.id.localeCompare(b.id)).filter(v=>match(v.brand+' '+v.model+' '+v.plate+' '+name(v.customer_id))).map(v=>v.id);
  if (query.view==='conversations') ids = [...s.conversations].sort((a,b)=>b.created_at.localeCompare(a.created_at)||a.id.localeCompare(b.id)).filter(c=>match(c.messages.map(m=>m.content).join(' '))).map(c=>c.id);
  if (query.view==='appointments') ids = appointments.filter(a => {
    const req = s.requests.find(r=>r.id===a.request_id);
    return (query.status==='all'||a.status===query.status) && match((req?.reason??'')+' '+name(req?.customer_id??'')+' '+plate(req?.vehicle_id??''));
  }).map(a=>a.id);
  if (query.view==='calendar') {
    const rangeStart = new Date(query.range_start ?? '').getTime();
    const rangeEnd = new Date(query.range_end ?? '').getTime();
    ids = Number.isFinite(rangeStart) && Number.isFinite(rangeEnd) ? appointments.filter(a => {
      const start = new Date(a.starts_at).getTime();
      return start < rangeEnd && start + a.duration_minutes*60000 > rangeStart;
    }).map(a=>a.id) : [];
  }
  let historyTotal: number | null = null;
  if (query.view==='customer_detail') { const all = requests.filter(r=>r.customer_id===query.entity_id); historyTotal = all.length; ids = all.slice(0,HISTORY_LIMIT).map(r=>r.id); }
  if (query.view==='vehicle_detail') { const all = requests.filter(r=>r.vehicle_id===query.entity_id); historyTotal = all.length; ids = all.slice(0,HISTORY_LIMIT).map(r=>r.id); }
  // For every other view, total is simply how many ids matched (SQL counts
  // the same way); the history views are the one case where the SQL side
  // counts BEFORE its own 200-row cap, so total can exceed ids.length here.
  const total = historyTotal ?? ids.length;
  // Calendar and the entity-history views never paginate: they need
  // everything relevant (a range, or a customer/vehicle's whole history),
  // never just one 25-row page of it.
  if (query.view !== 'calendar' && query.view !== 'customer_detail' && query.view !== 'vehicle_detail') ids = ids.slice(Math.max(0,query.offset),Math.max(0,query.offset)+PAGE_SIZE);
  const requestIds = new Set(query.view==='requests'||query.view==='customer_detail'||query.view==='vehicle_detail'?ids:query.view==='dashboard'?requests.slice(0,8).map(r=>r.id):[]);
  const appointmentIds = new Set(query.view==='appointments'||query.view==='calendar'?ids:query.view==='dashboard'?appointments.filter(a=>a.status==='scheduled'&&new Date(a.starts_at)>=new Date()).slice(0,8).map(a=>a.id):[]);
  const conversationIds = new Set(query.view==='conversations'?ids:[]);
  const vehicleEntity = query.view==='vehicle_detail' ? s.vehicles.find(v=>v.id===query.entity_id) : undefined;
  const customerIds = new Set(query.view==='customers'?ids:query.view==='customer_detail'&&query.entity_id?[query.entity_id]:vehicleEntity?[vehicleEntity.customer_id]:[]);
  const vehicleIds = new Set(query.view==='vehicles'?ids:query.view==='vehicle_detail'&&query.entity_id?[query.entity_id]:[]);
  // A vehicle with no requests yet still shows its owner and a customer with
  // no requests yet still shows all their vehicles -- neither is reachable
  // through the requests-based hydration step below on its own.
  if (query.view==='customer_detail' && query.entity_id) s.vehicles.filter(v=>v.customer_id===query.entity_id).forEach(v=>vehicleIds.add(v.id));
  // A history needs every appointment tied to its requests regardless of
  // status (scheduled/completed/cancelled) -- unlike the generic step just
  // below, which (for every other view) only pulls in *scheduled* ones,
  // because that's all any of those other views need.
  if (query.view==='customer_detail' || query.view==='vehicle_detail') s.appointments.filter(a=>requestIds.has(a.request_id)).forEach(a=>appointmentIds.add(a.id));
  s.requests.filter(r=>conversationIds.has(r.conversation_id)).forEach(r=>requestIds.add(r.id));
  s.appointments.filter(a=>appointmentIds.has(a.id)).forEach(a=>requestIds.add(a.request_id));
  s.appointments.filter(a=>requestIds.has(a.request_id)&&a.status==='scheduled').forEach(a=>appointmentIds.add(a.id));
  s.requests.filter(r=>requestIds.has(r.id)).forEach(r=>{customerIds.add(r.customer_id);vehicleIds.add(r.vehicle_id);conversationIds.add(r.conversation_id);});
  s.vehicles.filter(v=>vehicleIds.has(v.id)).forEach(v=>customerIds.add(v.customer_id));
  // Built from the customers that actually exist (matching SQL, which
  // derives customer_counts from real rows), not raw customerIds -- an
  // entity_id that doesn't correspond to any real customer/vehicle of this
  // workshop must not leave a phantom zero-count entry behind.
  const realCustomers = s.customers.filter(c=>customerIds.has(c.id));
  return { ...s,
    requests: requests.filter(r=>requestIds.has(r.id)),
    appointments: appointments.filter(a=>appointmentIds.has(a.id)),
    conversations: s.conversations.filter(c=>conversationIds.has(c.id)).sort((a,b)=>b.created_at.localeCompare(a.created_at)),
    customers: realCustomers.sort((a,b)=>a.name.localeCompare(b.name)),
    vehicles: s.vehicles.filter(v=>vehicleIds.has(v.id)).sort((a,b)=>a.brand.localeCompare(b.brand)),
    audit: s.role==='staff'?[]:(s.audit??[]).slice(0,20),
    page_info: { view:query.view,offset:query.offset,total,ids },
    metrics: { new_requests:s.requests.filter(r=>r.status==='nueva').length, upcoming:s.appointments.filter(a=>a.status==='scheduled'&&new Date(a.starts_at)>=new Date()).length, pending_customers:new Set(s.requests.filter(r=>['nueva','pendiente'].includes(r.status)).map(r=>r.customer_id)).size, completed:s.requests.filter(r=>r.status==='completada').length },
    customer_counts:Object.fromEntries(realCustomers.map(c=>[c.id,{vehicles:s.vehicles.filter(v=>v.customer_id===c.id).length,requests:s.requests.filter(r=>r.customer_id===c.id).length}]))
  };
}
