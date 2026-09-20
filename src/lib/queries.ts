import type { State } from './domain';
export type View = 'dashboard' | 'requests' | 'customers' | 'vehicles' | 'conversations' | 'appointments' | 'reception' | 'settings';
export interface ViewQuery { view: View; offset: number; search: string; status: string }
export interface LookupOption { id: string; label: string }
export const PAGE_SIZE = 25;
export const defaultQuery: ViewQuery = { view: 'dashboard', offset: 0, search: '', status: 'all' };
export function projectState(s: State, query: ViewQuery = defaultQuery): State {
  const q = query.search.toLocaleLowerCase();
  const match = (value: string) => value.toLocaleLowerCase().includes(q);
  const name = (id: string) => s.customers.find(c => c.id===id)?.name ?? '';
  const plate = (id: string) => s.vehicles.find(v => v.id===id)?.plate ?? '';
  let ids: string[] = [];
  const requests = [...s.requests].sort((a,b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
  const appointments = [...s.appointments].sort((a,b) => (a.status==='scheduled'?0:1)-(b.status==='scheduled'?0:1) || (a.status==='scheduled' ? a.starts_at.localeCompare(b.starts_at) : b.starts_at.localeCompare(a.starts_at)) || a.id.localeCompare(b.id));
  if (query.view==='requests') ids = requests.filter(r => (query.status==='all'||r.status===query.status) && match(r.reason+' '+name(r.customer_id)+' '+(s.customers.find(c=>c.id===r.customer_id)?.phone??'')+' '+plate(r.vehicle_id))).map(r=>r.id);
  if (query.view==='customers') ids = [...s.customers].sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id)).filter(c=>match(c.name+' '+c.phone)).map(c=>c.id);
  if (query.view==='vehicles') ids = [...s.vehicles].sort((a,b)=>a.brand.localeCompare(b.brand)||a.id.localeCompare(b.id)).filter(v=>match(v.brand+' '+v.model+' '+v.plate+' '+name(v.customer_id))).map(v=>v.id);
  if (query.view==='conversations') ids = [...s.conversations].sort((a,b)=>b.created_at.localeCompare(a.created_at)||a.id.localeCompare(b.id)).filter(c=>match(c.messages.map(m=>m.content).join(' '))).map(c=>c.id);
  if (query.view==='appointments') ids = appointments.map(a=>a.id);
  const total = ids.length;
  ids = ids.slice(Math.max(0,query.offset),Math.max(0,query.offset)+PAGE_SIZE);
  const requestIds = new Set(query.view==='requests'?ids:query.view==='dashboard'?requests.slice(0,8).map(r=>r.id):[]);
  const appointmentIds = new Set(query.view==='appointments'?ids:query.view==='dashboard'?appointments.filter(a=>a.status==='scheduled'&&new Date(a.starts_at)>=new Date()).slice(0,8).map(a=>a.id):[]);
  const conversationIds = new Set(query.view==='conversations'?ids:[]);
  const customerIds = new Set(query.view==='customers'?ids:[]);
  const vehicleIds = new Set(query.view==='vehicles'?ids:[]);
  s.requests.filter(r=>conversationIds.has(r.conversation_id)).forEach(r=>requestIds.add(r.id));
  s.appointments.filter(a=>appointmentIds.has(a.id)).forEach(a=>requestIds.add(a.request_id));
  s.appointments.filter(a=>requestIds.has(a.request_id)&&a.status==='scheduled').forEach(a=>appointmentIds.add(a.id));
  s.requests.filter(r=>requestIds.has(r.id)).forEach(r=>{customerIds.add(r.customer_id);vehicleIds.add(r.vehicle_id);conversationIds.add(r.conversation_id);});
  s.vehicles.filter(v=>vehicleIds.has(v.id)).forEach(v=>customerIds.add(v.customer_id));
  return { ...s,
    requests: requests.filter(r=>requestIds.has(r.id)),
    appointments: appointments.filter(a=>appointmentIds.has(a.id)),
    conversations: s.conversations.filter(c=>conversationIds.has(c.id)).sort((a,b)=>b.created_at.localeCompare(a.created_at)),
    customers: s.customers.filter(c=>customerIds.has(c.id)).sort((a,b)=>a.name.localeCompare(b.name)),
    vehicles: s.vehicles.filter(v=>vehicleIds.has(v.id)).sort((a,b)=>a.brand.localeCompare(b.brand)),
    audit: s.role==='staff'?[]:(s.audit??[]).slice(0,20),
    page_info: { view:query.view,offset:query.offset,total,ids },
    metrics: { new_requests:s.requests.filter(r=>r.status==='nueva').length, upcoming:s.appointments.filter(a=>a.status==='scheduled'&&new Date(a.starts_at)>=new Date()).length, pending_customers:new Set(s.requests.filter(r=>['nueva','pendiente'].includes(r.status)).map(r=>r.customer_id)).size, completed:s.requests.filter(r=>r.status==='completada').length },
    customer_counts:Object.fromEntries([...customerIds].map(id=>[id,{vehicles:s.vehicles.filter(v=>v.customer_id===id).length,requests:s.requests.filter(r=>r.customer_id===id).length}]))
  };
}
