import type { State, Resource } from './domain';
import { tryNormalizePhone } from './phone';
export function upgradeDemo(source: State): State {
  if (source.schema_version === 3) return source;
  if (source.schema_version === 2) {
    const upgraded = structuredClone(source);
    upgraded.schema_version = 3;
    upgraded.requests.forEach(r => { r.version ??= 1; });
    upgraded.appointments.forEach(a => { a.version ??= 1; });
    return upgraded;
  }
  const state = structuredClone(source);
  state.schema_version = 3;
  state.workshop.version ??= 1;
  const primary: Resource = { id: crypto.randomUUID(), workshop_id: state.workshop.id, name: 'Puesto principal', kind: 'bay', active: true, version: 1 };
  state.resources = state.resources?.length ? state.resources : [primary];
  state.audit ??= [];
  const seen = new Map<string, string>();
  const redirects = new Map<string, string>();
  state.customers = [...state.customers].sort((a,b) => a.id.localeCompare(b.id)).filter(c => {
    c.version ??= 1;
    const normalized = tryNormalizePhone(c.phone);
    c.phone_e164 = normalized;
    if (!normalized) return true;
    const keeper = seen.get(normalized);
    if (keeper) {
      redirects.set(c.id, keeper);
      state.audit!.push({ id: crypto.randomUUID(), workshop_id: state.workshop.id, user_id: null, action: 'customer_merged', entity_type: 'customer', entity_id: keeper, created_at: new Date().toISOString(), metadata: { original_customer: { ...c } } });
      return false;
    }
    seen.set(normalized,c.id); c.phone = normalized; return true;
  });
  state.vehicles.forEach(v => { v.customer_id = redirects.get(v.customer_id) ?? v.customer_id; v.version ??= 1; });
  state.requests.forEach(r => { r.version ??= 1; r.customer_id = redirects.get(r.customer_id) ?? r.customer_id; });
  state.requests.sort((a,b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
  state.appointments.forEach(a => { a.version ??= 1; a.resource_id ??= state.resources![0].id; });
  return state;
}
