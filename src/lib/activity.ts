import type { AuditEvent, State } from './domain';
import type { TeamLoadState, TeamMember } from './supabase/team';

// Human-readable view of an audit_events row for the owner's "Actividad del
// taller" list. Internal action names, entity ids, user ids and metadata are
// never returned as-is: an unknown action falls back to a generic label, and
// an object that can't be named reliably is simply left out.
export interface ActivityLine { action: string; subject: string | null; actor: string }

export const DEMO_USER_ID = 'demo-owner';

const actionLabels: Record<string, string> = {
  intake: 'Registró una nueva solicitud',
  public_intake: 'Nueva solicitud desde la recepción online',
  status: 'Cambió el estado de una solicitud',
  appointment: 'Creó o modificó una cita',
  appointment_status: 'Cambió el estado de una cita',
  customer: 'Guardó los datos de un cliente',
  vehicle: 'Guardó los datos de un vehículo',
  settings: 'Actualizó los datos del taller',
  resource: 'Guardó un recurso del taller',
  workshop_hours: 'Actualizó el horario semanal',
  workshop_hour_exception: 'Guardó un día con horario especial',
  workshop_hour_exception_delete: 'Eliminó un día con horario especial',
  customer_anonymize: 'Eliminó los datos personales de un cliente',
  vehicle_plate_erased: 'Borró la matrícula de un vehículo',
  vehicle_corrected: 'Corrigió la marca o el modelo de un vehículo',
  customer_merged: 'Unificó clientes duplicados',
  phone_review_required: 'Teléfono de cliente pendiente de revisar',
  workshop_created: 'Creó el taller',
  member_invited: 'Invitó a un miembro al equipo',
  invitation_revoked: 'Canceló una invitación al equipo',
  member_removed: 'Retiró el acceso a un miembro del equipo',
  member_joined: 'Se unió al equipo',
};

export const UNKNOWN_ACTION_LABEL = 'Otra operación en el taller';

export function activityActionLabel(action: string): string {
  return Object.hasOwn(actionLabels, action) ? actionLabels[action] : UNKNOWN_ACTION_LABEL;
}

const currentUserId = (state: State) => state.user_id ?? DEMO_USER_ID;

// `memberEmails` comes from list_members (user_id -> email); null or missing
// entries mean the teammate can't be named (not loaded yet, call failed,
// demo mode, or no longer a member).
export function activityActor(event: AuditEvent, state: State, memberEmails: ReadonlyMap<string, string> | null): string {
  // public_intake is written with a null user_id by the anonymous public
  // reception, so it must be checked before the null -> "Sistema" rule.
  if (event.action === 'public_intake') return 'Cliente (recepción online)';
  if (event.user_id === null) return 'Sistema';
  if (event.user_id === currentUserId(state)) return 'Tú';
  return memberEmails?.get(event.user_id) ?? 'Otro miembro del equipo';
}

// Only a real calendar date in a plausible range is shown: Date.UTC silently
// rolls over impossible values (2026-02-30 -> 2 de marzo) and maps years
// below 100 to 19xx, so the rebuilt date must match the original exactly.
function exceptionDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 2000 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

// Only objects the settings view always receives can be named. The settings
// payload doesn't carry customers, vehicles, requests or appointments (they
// are loaded per page elsewhere), so those rows show just action + author +
// date rather than a name that would appear or vanish depending on which
// page was open before.
export function activitySubject(event: AuditEvent, state: State, memberEmails: ReadonlyMap<string, string> | null): string | null {
  switch (event.entity_type) {
    case 'resource': { const name = state.resources?.find(r => r.id === event.entity_id)?.name; return name ? `Recurso: ${name}` : null; }
    case 'workshop_hour_exception': {
      const date = state.hour_exceptions?.find(e => e.id === event.entity_id)?.exception_date;
      const label = date ? exceptionDate(date) : null;
      return label ? `Día: ${label}` : null;
    }
    case 'invitation': {
      // The invited address is the only metadata ever shown; the owner
      // already sees it in the Equipo screen.
      const email = event.action === 'member_invited' ? event.metadata?.email : undefined;
      return typeof email === 'string' && email ? `Invitación a ${email}` : null;
    }
    case 'member': {
      if (event.entity_id === event.user_id) return null;
      const email = memberEmails?.get(event.entity_id);
      return email ? `Miembro: ${email}` : null;
    }
    default: return null;
  }
}

export function describeActivity(event: AuditEvent, state: State, memberEmails: ReadonlyMap<string, string> | null): ActivityLine {
  return { action: activityActionLabel(event.action), subject: activitySubject(event, state, memberEmails), actor: activityActor(event, state, memberEmails) };
}

// Member lookup cache for the Activity list. `emails` holds every member a
// successful list_members call returned. `missing` holds the ids a successful
// call did NOT return, each tagged with the id of that user's latest
// member_joined row at request time ('' if none): the negative answer only
// stands while that tag is unchanged, so someone removed and later re-admitted
// with the same UUID is looked up again exactly once, without a call on every
// render. `seq` is the number of the newest list_members request applied so
// far (see applyMemberSnapshot).
export interface MemberLookup { seq: number; emails: ReadonlyMap<string, string>; missing: ReadonlyMap<string, string> }
export const emptyMemberLookup: MemberLookup = { seq: 0, emails: new Map(), missing: new Map() };
export interface PendingMember { id: string; join: string }

function latestJoins(audit: readonly AuditEvent[]): Map<string, AuditEvent> {
  const joins = new Map<string, AuditEvent>();
  for (const event of audit) {
    if (event.action !== 'member_joined' || event.user_id === null) continue;
    const previous = joins.get(event.user_id);
    if (!previous || event.created_at > previous.created_at || (event.created_at === previous.created_at && event.id > previous.id)) joins.set(event.user_id, event);
  }
  return joins;
}

// Users the list needs an email for that no successful call has answered for
// their current join: teammates (not the current user, not the anonymous
// public reception, not system rows) and the target of member_removed.
// Sorted so it can be turned into a stable effect dependency.
export function pendingMembers(state: State, lookup: MemberLookup): PendingMember[] {
  const me = currentUserId(state);
  const audit = state.audit ?? [];
  const ids = new Set<string>();
  for (const event of audit) {
    if (event.action !== 'public_intake' && event.user_id !== null && event.user_id !== me) ids.add(event.user_id);
    if (event.entity_type === 'member' && event.entity_id !== event.user_id && event.entity_id !== me) ids.add(event.entity_id);
  }
  const joins = latestJoins(audit);
  // With no member_joined visible (e.g. it left the last-20 audit window),
  // keep the marker already recorded instead of treating it as a change.
  return [...ids].sort()
    .map(id => ({ id, join: joins.get(id)?.id ?? lookup.missing.get(id) ?? '' }))
    .filter(p => !lookup.emails.has(p.id) && lookup.missing.get(p.id) !== p.join);
}

export const pendingMembersKey = (pending: readonly PendingMember[]) => pending.map(p => `${p.id}@${p.join}`).join(',');
export const parsePendingMembersKey = (key: string): PendingMember[] => key ? key.split(',').map(part => { const [id, join = ''] = part.split('@'); return { id, join }; }) : [];

// Responses can arrive out of order, and each one is the team as it was when
// that request ran. Only a response from a request newer than the last one
// applied is taken; an older one is dropped whole, so it can never overwrite a
// newer email or negative answer. Ids only the dropped request asked for stay
// pending and are asked for once more.
export function applyMemberSnapshot(lookup: MemberLookup, seq: number, requested: readonly PendingMember[], members: readonly TeamMember[]): MemberLookup {
  if (seq <= lookup.seq) return lookup;
  const emails = new Map([...lookup.emails, ...members.map(m => [m.user_id, m.email] as const)]);
  const missing = new Map(lookup.missing);
  for (const p of requested) { if (emails.has(p.id)) missing.delete(p.id); else missing.set(p.id, p.join); }
  return { seq, emails, missing };
}

// One list_members request of an Activity instance. `seq` numbers requests
// per instance; `isMounted` is false once that instance unmounted (including
// a workshop change, which remounts through its key), so nothing from a
// previous context is ever applied. Only the latest request settles the
// failure/retry state.
export interface MemberLoadContext {
  isMounted(): boolean;
  isLatest(seq: number): boolean;
  apply(update: (prev: MemberLookup) => MemberLookup): void;
  settle(failed: boolean): void;
}

export async function runMemberLoad(ctx: MemberLoadContext, fetchMembers: () => Promise<TeamLoadState>, seq: number, requested: readonly PendingMember[]): Promise<void> {
  const result = await fetchMembers();
  if (!ctx.isMounted()) return;
  if (result.status === 'ready') ctx.apply(prev => applyMemberSnapshot(prev, seq, requested, result.snapshot.members));
  if (ctx.isLatest(seq)) ctx.settle(result.status !== 'ready');
}

// What the member-loading effect depends on. While no load has failed it is
// just the pending set, so a new audit row arriving mid-request (saving a
// resource, polling) neither cancels a valid in-flight call nor starts a
// duplicate one. After a failure (`failedHead` = audit head when that request
// started) it is null until the audit list moves past that head, and then a
// key tied to the failure -- not to the live head -- so later audit rows don't
// restart the retry either. '' / null mean "don't load".
export function memberLoadKey(pendingKey: string, failedHead: string | null, auditHead: string | undefined): string | null {
  if (!pendingKey) return null;
  if (failedHead === null) return pendingKey;
  return (auditHead ?? '') === failedHead ? null : `${pendingKey}#retry:${failedHead}`;
}
