import type { State, Resource } from './domain';
import { tryNormalizePhone } from './phone';
// Mirrors public.slugify + generate_workshop_slug: lowercase, strip
// diacritics, collapse anything that isn't a-z0-9 into single hyphens, trim
// outer hyphens, then truncate. The trim runs a second time after the
// truncation too -- cutting at exactly 40 chars can land right after a
// hyphen and reintroduce a trailing one, same as the SQL side. No collision
// handling here (unlike the server's generate_workshop_slug) since a single
// browser's demo state only ever has one workshop.
function localSlug(name: string): string {
  const collapsed = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return collapsed.slice(0, 40).replace(/^-+|-+$/g, '');
}
function upgradeToV3(source: State): State {
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
function upgradeToV4(source: State): State {
  if (source.schema_version === 4) return source;
  const state = structuredClone(upgradeToV3(source));
  state.schema_version = 4;
  state.workshop.slug ??= localSlug(state.workshop.name) || 'taller';
  return state;
}
export function upgradeDemo(source: State): State {
  if (source.schema_version === 5) return source;
  const state = structuredClone(upgradeToV4(source));
  state.schema_version = 5;
  // Every demo saved before structured business hours existed has no
  // hours_version at all; the workshop_hours command compares it against
  // the value the Configuración form last saw, so an uninitialized counter
  // would reject the very first schedule the owner tries to save.
  state.workshop.hours_version ??= 1;
  return state;
}
