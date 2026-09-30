import { describe, expect, it } from 'vitest';
import { activityActionLabel, applyMemberSnapshot, describeActivity, emptyMemberLookup, memberLoadKey, parsePendingMembersKey, pendingMembers, pendingMembersKey, runMemberLoad, UNKNOWN_ACTION_LABEL, type MemberLoadContext, type MemberLookup, type PendingMember } from './activity';
import { upgradeDemo } from './demo-migration';
import { applyCommand, type AuditEvent, type State } from './domain';
import { projectState } from './queries';
import type { TeamLoadState, TeamMember } from './supabase/team';

const W = '0a0a0a0a-0000-4000-8000-000000000000';
const OWNER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const GONE = '33333333-3333-4333-8333-333333333333';
const NEWCOMER = '44444444-4444-4444-8444-444444444444';
const C1 = 'c1c1c1c1-0000-4000-8000-000000000001';
const V1 = 'd1d1d1d1-0000-4000-8000-000000000001';
const R1 = 'e1e1e1e1-0000-4000-8000-000000000001';
const A1 = 'f1f1f1f1-0000-4000-8000-000000000001';
const RES = 'b1b1b1b1-0000-4000-8000-000000000001';
const EX = 'a1a1a1a1-0000-4000-8000-000000000001';
const INV = '99999999-0000-4000-8000-000000000001';
const MISSING = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

const ALL_ACTIONS = [
  'intake', 'public_intake', 'status', 'appointment', 'appointment_status', 'customer', 'vehicle', 'settings', 'resource',
  'workshop_hours', 'workshop_hour_exception', 'workshop_hour_exception_delete', 'customer_anonymize', 'vehicle_plate_erased',
  'vehicle_corrected', 'customer_merged', 'phone_review_required', 'workshop_created', 'member_invited', 'invitation_revoked',
  'member_removed', 'member_joined',
];
// Entity type each action is written with (SQL migrations and domain.ts).
const ENTITY_OF: Record<string, string> = {
  intake: 'request', public_intake: 'request', status: 'request', appointment: 'appointment', appointment_status: 'appointment',
  customer: 'customer', vehicle: 'vehicle', settings: 'workshop', resource: 'resource', workshop_hours: 'workshop',
  workshop_hour_exception: 'workshop_hour_exception', workshop_hour_exception_delete: 'workshop_hour_exception',
  customer_anonymize: 'customer', vehicle_plate_erased: 'vehicle', vehicle_corrected: 'vehicle', customer_merged: 'customer',
  phone_review_required: 'customer', workshop_created: 'workshop', member_invited: 'invitation', invitation_revoked: 'invitation',
  member_removed: 'member', member_joined: 'member',
};

// A "full" state, as a page other than settings could have loaded it.
function fullState(overrides: Partial<State> = {}): State {
  return {
    role: 'owner', user_id: OWNER,
    workshop: { id: W, name: 'Taller', phone: '', address: '', hours: '', timezone: 'Europe/Madrid', appointment_minutes: 60 },
    customers: [{ id: C1, workshop_id: W, name: 'Ana López', phone: '+34600000000', notes: '' }],
    vehicles: [{ id: V1, workshop_id: W, customer_id: C1, brand: 'Seat', model: 'Ibiza', plate: '1234BCD' }],
    requests: [{ id: R1, workshop_id: W, customer_id: C1, vehicle_id: V1, conversation_id: '', reason: 'Revisión', availability: '', notes: '', status: 'nueva', created_at: '2026-10-01T08:00:00Z' }],
    appointments: [{ id: A1, workshop_id: W, request_id: R1, starts_at: '2026-10-02T08:00:00Z', duration_minutes: 60, status: 'scheduled', notes: '' }],
    conversations: [],
    resources: [{ id: RES, workshop_id: W, name: 'Elevador 1', kind: 'lift', active: true }],
    hour_exceptions: [{ id: EX, workshop_id: W, exception_date: '2026-12-25', closed: true, opens_at: null, closes_at: null }],
    ...overrides,
  };
}

function event(action: string, entity_type: string, entity_id: string, user_id: string | null = OWNER, metadata?: Record<string, unknown>): AuditEvent {
  return { id: crypto.randomUUID(), workshop_id: W, user_id, action, entity_type, entity_id, created_at: '2026-10-01T09:00:00Z', metadata };
}

const members = new Map([[OWNER, 'owner@taller.es'], [STAFF, 'staff@taller.es']]);
// Applies a response as the next, newest request (sequence handled explicitly
// in the ordering tests below).
const apply = (lookup: MemberLookup, requested: readonly PendingMember[], team: readonly TeamMember[]) => applyMemberSnapshot(lookup, lookup.seq + 1, requested, team);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const lineText = (e: AuditEvent, s: State, m: ReadonlyMap<string, string> | null) => Object.values(describeActivity(e, s, m)).filter(Boolean).join(' | ');

function expectNothingInternal(e: AuditEvent, text: string) {
  expect(text).not.toMatch(UUID);
  expect(text).not.toContain(e.entity_id);
  if (e.user_id) expect(text).not.toContain(e.user_id);
  expect(text).not.toContain(e.action);
  expect(text).not.toContain(e.entity_type);
  expect(text).not.toMatch(/migraci/i);
}

describe('Actividad del taller: acciones', () => {
  it.each(ALL_ACTIONS)('traduce %s a un texto en español sin el nombre interno', action => {
    const label = activityActionLabel(action);
    expect(label).not.toBe(UNKNOWN_ACTION_LABEL);
    expect(label).not.toContain(action);
    expect(label).not.toContain('_');
  });

  it('una acción desconocida muestra un texto genérico, nunca el nombre interno', () => {
    expect(activityActionLabel('some_future_action')).toBe(UNKNOWN_ACTION_LABEL);
    expect(activityActionLabel('toString')).toBe(UNKNOWN_ACTION_LABEL);
    expect(activityActionLabel('__proto__')).toBe(UNKNOWN_ACTION_LABEL);
  });
});

describe('Actividad del taller: autor', () => {
  it('public_intake aparece como cliente de la recepción online, nunca como migración', () => {
    const line = describeActivity(event('public_intake', 'request', R1, null), fullState(), members);
    expect(line.actor).toBe('Cliente (recepción online)');
  });

  it('un evento sin usuario que no viene de la recepción pública es del sistema', () => {
    expect(describeActivity(event('customer_merged', 'customer', C1, null), fullState(), members).actor).toBe('Sistema');
    expect(describeActivity(event('phone_review_required', 'customer', C1, null), fullState(), null).actor).toBe('Sistema');
  });

  it('el usuario actual aparece como "Tú", aunque list_members no haya cargado', () => {
    expect(describeActivity(event('status', 'request', R1, OWNER), fullState(), members).actor).toBe('Tú');
    expect(describeActivity(event('status', 'request', R1, OWNER), fullState(), null).actor).toBe('Tú');
  });

  it('en modo demo el propietario ficticio es el usuario actual', () => {
    expect(describeActivity(event('status', 'request', R1, 'demo-owner'), fullState({ user_id: undefined }), null).actor).toBe('Tú');
  });

  it('otro miembro aparece con su email resuelto por list_members', () => {
    expect(describeActivity(event('status', 'request', R1, STAFF), fullState(), members).actor).toBe('staff@taller.es');
  });

  it('si el miembro no se puede resolver aparece como otro miembro, sin UUID', () => {
    for (const map of [members, null]) expect(describeActivity(event('status', 'request', R1, GONE), fullState(), map).actor).toBe('Otro miembro del equipo');
    expect(describeActivity(event('status', 'request', R1, STAFF), fullState(), null).actor).toBe('Otro miembro del equipo');
  });
});

describe('Actividad del taller: objeto afectado', () => {
  it('no nombra clientes, vehículos, solicitudes ni citas aunque estén cargados', () => {
    // Settings never receives them, so naming them only sometimes would be
    // inconsistent; the row stays action + author + date.
    const s = fullState();
    expect(describeActivity(event('customer', 'customer', C1), s, null).subject).toBeNull();
    expect(describeActivity(event('vehicle', 'vehicle', V1), s, null).subject).toBeNull();
    expect(describeActivity(event('status', 'request', R1), s, null).subject).toBeNull();
    expect(describeActivity(event('appointment_status', 'appointment', A1), s, null).subject).toBeNull();
  });

  it('customer_anonymize y customer_merged nunca muestran el nombre anterior ni la metadata', () => {
    const merged = event('customer_merged', 'customer', C1, null, { original_customer: { name: 'Nombre Antiguo', phone: '+34611111111' } });
    const text = lineText(merged, fullState(), null);
    expect(text).not.toContain('Nombre Antiguo');
    expect(text).not.toContain('611111111');
    expect(text).not.toContain('Ana López');
    expect(lineText(event('customer_anonymize', 'customer', C1), fullState(), null)).not.toContain('Ana López');
  });

  it('resuelve recurso y día con horario especial, que Configuración siempre recibe', () => {
    const s = fullState();
    expect(describeActivity(event('resource', 'resource', RES), s, null).subject).toBe('Recurso: Elevador 1');
    expect(describeActivity(event('workshop_hour_exception', 'workshop_hour_exception', EX), s, null).subject).toBe('Día: 25 de diciembre de 2026');
  });

  it('un día especial borrado o con fecha no válida no muestra nada', () => {
    expect(describeActivity(event('workshop_hour_exception_delete', 'workshop_hour_exception', MISSING), fullState(), null).subject).toBeNull();
    const broken = fullState({ hour_exceptions: [{ id: EX, workshop_id: W, exception_date: 'garbage', closed: true, opens_at: null, closes_at: null }] });
    expect(describeActivity(event('workshop_hour_exception', 'workshop_hour_exception', EX), broken, null).subject).toBeNull();
  });

  it('un id que existe como cliente no se confunde con un recurso', () => {
    const s = fullState({ resources: [{ id: C1, workshop_id: W, name: 'Puesto A', kind: 'bay', active: true }] });
    expect(describeActivity(event('customer', 'customer', C1), s, null).subject).toBeNull();
    expect(describeActivity(event('resource', 'resource', C1), s, null).subject).toBe('Recurso: Puesto A');
  });

  it('los ajustes del taller y el horario semanal no muestran el id del taller', () => {
    expect(describeActivity(event('settings', 'workshop', W), fullState(), null).subject).toBeNull();
    expect(describeActivity(event('workshop_hours', 'workshop', W), fullState(), null).subject).toBeNull();
  });

  it('la invitación muestra solo el email invitado y ningún otro metadato', () => {
    const line = describeActivity(event('member_invited', 'invitation', INV, OWNER, { email: 'nuevo@taller.es', internal: 'x-secret' }), fullState(), members);
    expect(line.subject).toBe('Invitación a nuevo@taller.es');
    expect(lineText(event('member_invited', 'invitation', INV, OWNER, { email: 'nuevo@taller.es', internal: 'x-secret' }), fullState(), members)).not.toContain('x-secret');
    expect(describeActivity(event('member_invited', 'invitation', INV, OWNER, { email: 42 }), fullState(), members).subject).toBeNull();
    expect(describeActivity(event('invitation_revoked', 'invitation', INV, OWNER, { email: 'x@y.es' }), fullState(), members).subject).toBeNull();
  });

  it('un miembro retirado se muestra por email si es resoluble, y member_joined no repite al autor', () => {
    expect(describeActivity(event('member_removed', 'member', STAFF), fullState(), members).subject).toBe('Miembro: staff@taller.es');
    expect(describeActivity(event('member_removed', 'member', GONE), fullState(), members).subject).toBeNull();
    expect(describeActivity(event('member_joined', 'member', STAFF, STAFF), fullState(), members).subject).toBeNull();
  });

  it.each(ALL_ACTIONS)('%s sin objetos relacionados cargados no filtra ids, nombres internos ni metadata', action => {
    const empty = fullState({ customers: [], vehicles: [], requests: [], appointments: [], resources: [], hour_exceptions: [] });
    const e = event(action, ENTITY_OF[action], MISSING, action === 'public_intake' ? null : GONE, { original_customer: { name: 'Nombre Antiguo' }, previous_brand: 'MarcaVieja' });
    for (const map of [members, null]) {
      const text = lineText(e, empty, map);
      expectNothingInternal(e, text);
      expect(text).not.toContain('Nombre Antiguo');
      expect(text).not.toContain('MarcaVieja');
    }
  });
});

describe('Actividad del taller en la vista real de Configuración', () => {
  // Builds a real demo workshop through applyCommand (so audit rows carry
  // the same action/entity pairs as production) and then projects it the
  // way the settings page actually receives it.
  function settingsView(): { full: State; view: State } {
    let s = upgradeDemo({ workshop: { id: W, name: 'Taller', phone: '', address: '', hours: '', timezone: 'Europe/Madrid', appointment_minutes: 60 }, customers: [], vehicles: [], requests: [], conversations: [], appointments: [] });
    s = { ...s, user_id: OWNER, role: 'owner' };
    s = applyCommand(s, { type: 'intake', id: crypto.randomUUID(), data: { name: 'José García', phone: '600123456', brand: 'SEAT', model: 'León', plate: '1234BCD', reason: 'Revisión anual', availability: 'Mañanas', notes: '' }, messages: [{ role: 'user', content: 'Hola' }] });
    const request = s.requests[0];
    s = applyCommand(s, { type: 'status', id: request.id, version: request.version, status: 'pendiente' });
    s = applyCommand(s, { type: 'appointment', id: crypto.randomUUID(), request_id: request.id, request_version: s.requests[0].version, starts_at: '2030-01-02T10:00:00Z', duration_minutes: 60, notes: '' });
    const customer = s.customers[0];
    s = applyCommand(s, { type: 'customer_anonymize', id: customer.id, version: customer.version });
    s = { ...s, user_id: STAFF };
    s = applyCommand(s, { type: 'resource', resource: { ...s.resources![0], name: 'Elevador principal' } });
    s = { ...s, user_id: OWNER };
    s.audit = [
      event('member_removed', 'member', GONE),
      event('member_joined', 'member', NEWCOMER, NEWCOMER),
      event('public_intake', 'request', MISSING, null),
      event('customer_merged', 'customer', MISSING, null, { original_customer: { name: 'Duplicado Antiguo', phone: '+34622222222' } }),
      ...s.audit!,
    ];
    return { full: s, view: projectState(s, { view: 'settings', offset: 0, search: '', status: 'all' }) };
  }

  it('la vista de Configuración no trae clientes, vehículos, solicitudes ni citas', () => {
    const { view } = settingsView();
    expect(view.customers).toEqual([]);
    expect(view.vehicles).toEqual([]);
    expect(view.requests).toEqual([]);
    expect(view.appointments).toEqual([]);
    expect(view.audit!.length).toBeGreaterThan(0);
  });

  it('cada fila es útil (acción + autor) y no contiene UUIDs, nombres internos ni metadata', () => {
    const { view } = settingsView();
    for (const map of [members, null]) {
      for (const e of view.audit!) {
        const line = describeActivity(e, view, map);
        expect(line.action).not.toBe(UNKNOWN_ACTION_LABEL);
        expect(line.actor).toBeTruthy();
        const text = lineText(e, view, map);
        expectNothingInternal(e, text);
        expect(text).not.toContain('Duplicado Antiguo');
        expect(text).not.toContain('622222222');
        expect(text).not.toContain('José García');
      }
    }
  });

  it('atribuye cada fila al autor correcto y resuelve el recurso', () => {
    const { view } = settingsView();
    const byAction = (action: string) => describeActivity(view.audit!.find(e => e.action === action)!, view, members);
    expect(byAction('public_intake').actor).toBe('Cliente (recepción online)');
    expect(byAction('customer_merged').actor).toBe('Sistema');
    expect(byAction('intake').actor).toBe('Tú');
    expect(byAction('resource').actor).toBe('staff@taller.es');
    expect(byAction('resource').subject).toBe('Recurso: Elevador principal');
    expect(byAction('member_joined').actor).toBe('Otro miembro del equipo');
  });
});

describe('Actividad del taller: carga de miembros', () => {
  const member = (user_id: string, email: string): TeamMember => ({ user_id, email, role: 'staff', created_at: '2026-10-01T00:00:00Z' });
  const ids = (s: State, lookup: MemberLookup) => pendingMembers(s, lookup).map(p => p.id);
  const joined = (id: string, at: string): AuditEvent => ({ ...event('member_joined', 'member', id, id), created_at: at });
  const removed = (id: string, at: string): AuditEvent => ({ ...event('member_removed', 'member', id), created_at: at });

  it('no pide list_members si solo hay acciones propias, del sistema o de la recepción pública', () => {
    const s = fullState({ audit: [event('status', 'request', R1, OWNER), event('public_intake', 'request', R1, null), event('customer_merged', 'customer', C1, null), event('member_joined', 'member', OWNER, OWNER)] });
    expect(pendingMembers(s, emptyMemberLookup)).toEqual([]);
    expect(pendingMembers(fullState({ audit: [] }), emptyMemberLookup)).toEqual([]);
    expect(pendingMembers(fullState({ audit: undefined }), emptyMemberLookup)).toEqual([]);
    expect(memberLoadKey(pendingMembersKey(pendingMembers(s, emptyMemberLookup)), null, s.audit![0].id)).toBeNull();
  });

  it('pide los autores ajenos y el destinatario de member_removed, ordenados y sin repetir', () => {
    const s = fullState({ audit: [event('status', 'request', R1, STAFF), event('member_removed', 'member', GONE), event('vehicle', 'vehicle', V1, STAFF)] });
    expect(ids(s, emptyMemberLookup)).toEqual([STAFF, GONE].sort());
  });

  it('la clave de carga se serializa y se recupera sin pérdida', () => {
    const s = fullState({ audit: [joined(NEWCOMER, '2026-10-01T10:00:00Z'), event('status', 'request', R1, STAFF)] });
    const pending = pendingMembers(s, emptyMemberLookup);
    expect(pending).toHaveLength(2);
    expect(parsePendingMembersKey(pendingMembersKey(pending))).toEqual(pending);
    expect(parsePendingMembersKey('')).toEqual([]);
  });

  it('tras una respuesta correcta no vuelve a pedir, ni siquiera por miembros ya retirados', () => {
    const s = fullState({ audit: [event('status', 'request', R1, STAFF), event('status', 'request', R1, GONE)] });
    const lookup = apply(emptyMemberLookup, pendingMembers(s, emptyMemberLookup), [member(OWNER, 'owner@taller.es'), member(STAFF, 'staff@taller.es')]);
    expect(pendingMembers(s, lookup)).toEqual([]);
    // More audit rows from the same authors don't reopen the lookup.
    const more = fullState({ audit: [event('resource', 'resource', RES, STAFF), event('status', 'request', R1, GONE), ...s.audit!] });
    expect(pendingMembers(more, lookup)).toEqual([]);
    expect(describeActivity(s.audit![0], s, lookup.emails).actor).toBe('staff@taller.es');
    expect(describeActivity(s.audit![1], s, lookup.emails).actor).toBe('Otro miembro del equipo');
  });

  it('si list_members falla, las filas usan el fallback y el autor sigue pendiente', () => {
    const s = fullState({ audit: [event('status', 'request', R1, STAFF)] });
    // A failed call leaves the lookup untouched.
    expect(describeActivity(s.audit![0], s, emptyMemberLookup.emails).actor).toBe('Otro miembro del equipo');
    expect(ids(s, emptyMemberLookup)).toEqual([STAFF]);
  });

  it('un miembro que se une después vuelve a disparar la carga y se resuelve', () => {
    const before = fullState({ audit: [event('status', 'request', R1, STAFF)] });
    const lookup = apply(emptyMemberLookup, pendingMembers(before, emptyMemberLookup), [member(STAFF, 'staff@taller.es')]);
    const after = fullState({ audit: [event('status', 'request', R1, NEWCOMER), ...before.audit!] });
    expect(ids(after, lookup)).toEqual([NEWCOMER]);
    const updated = apply(lookup, pendingMembers(after, lookup), [member(STAFF, 'staff@taller.es'), member(NEWCOMER, 'nuevo@taller.es')]);
    expect(pendingMembers(after, updated)).toEqual([]);
    expect(describeActivity(after.audit![0], after, updated.emails).actor).toBe('nuevo@taller.es');
  });

  it('un email conocido se conserva aunque el miembro ya no esté en una respuesta posterior', () => {
    const lookup = apply(emptyMemberLookup, [{ id: STAFF, join: '' }], [member(STAFF, 'staff@taller.es')]);
    const later = apply(lookup, [{ id: NEWCOMER, join: '' }], [member(NEWCOMER, 'nuevo@taller.es')]);
    expect(later.emails.get(STAFF)).toBe('staff@taller.es');
  });

  // Ronda 2, hallazgo 1: a successful answer without the user used to mark
  // them as checked forever, so re-admitting the same UUID never resolved.
  it('un miembro retirado y readmitido con el mismo UUID se vuelve a consultar una sola vez y se resuelve', () => {
    const afterRemoval = fullState({ audit: [removed(STAFF, '2026-10-01T10:00:00Z'), event('status', 'request', R1, STAFF)] });
    const lookup = apply(emptyMemberLookup, pendingMembers(afterRemoval, emptyMemberLookup), []);
    expect(pendingMembers(afterRemoval, lookup)).toEqual([]);
    expect(describeActivity(afterRemoval.audit![1], afterRemoval, lookup.emails).actor).toBe('Otro miembro del equipo');

    const rejoin = joined(STAFF, '2026-10-01T11:00:00Z');
    const rejoined = fullState({ audit: [rejoin, ...afterRemoval.audit!] });
    expect(pendingMembers(rejoined, lookup)).toEqual([{ id: STAFF, join: rejoin.id }]);

    const resolved = apply(lookup, pendingMembers(rejoined, lookup), [member(STAFF, 'staff@taller.es')]);
    expect(pendingMembers(rejoined, resolved)).toEqual([]);
    expect(describeActivity(rejoined.audit![0], rejoined, resolved.emails).actor).toBe('staff@taller.es');
  });

  it('si la readmisión aún no aparece en list_members, no vuelve a consultar hasta otra readmisión', () => {
    const rejoin = joined(STAFF, '2026-10-01T11:00:00Z');
    const s = fullState({ audit: [rejoin, event('status', 'request', R1, STAFF)] });
    const lookup = apply(emptyMemberLookup, pendingMembers(s, emptyMemberLookup), []);
    const more = fullState({ audit: [event('resource', 'resource', RES, STAFF), ...s.audit!] });
    expect(pendingMembers(more, lookup)).toEqual([]);
    const again = joined(STAFF, '2026-10-01T12:00:00Z');
    expect(ids(fullState({ audit: [again, ...more.audit!] }), lookup)).toEqual([STAFF]);
  });

  // Ronda 3, hallazgo 1: once the member_joined row left the last-20 audit
  // window, the marker fell back to '' and a visible member_removed of the
  // same user reopened the lookup without any real re-admission.
  it('si el member_joined sale de la ventana de auditoría no vuelve a consultar, pero una readmisión nueva sí', () => {
    const join = joined(STAFF, '2026-10-01T09:00:00Z');
    const withJoin = fullState({ audit: [removed(STAFF, '2026-10-01T10:00:00Z'), join] });
    const lookup = apply(emptyMemberLookup, pendingMembers(withJoin, emptyMemberLookup), []);
    expect(lookup.missing.get(STAFF)).toBe(join.id);

    const shifted = fullState({ audit: [event('resource', 'resource', RES, OWNER), removed(STAFF, '2026-10-01T10:00:00Z')] });
    expect(pendingMembers(shifted, lookup)).toEqual([]);

    const rejoin = joined(STAFF, '2026-10-01T11:00:00Z');
    expect(pendingMembers(fullState({ audit: [rejoin, ...shifted.audit!] }), lookup)).toEqual([{ id: STAFF, join: rejoin.id }]);
  });

  // Ronda 4, hallazgo 1: the effect used to drop an in-flight answer whenever
  // the pending set changed. Activity now always applies a successful answer
  // (only unmount drops it); these cover applying it late, after the window
  // or the pending set moved on.
  it('una respuesta que llega después de que la readmisión salga de la ventana se aplica y resuelve el email sin más consultas', () => {
    const j0 = joined(STAFF, '2026-10-01T08:00:00Z');
    const initial = fullState({ audit: [j0, event('status', 'request', R1, STAFF)] });
    const lookup = apply(emptyMemberLookup, pendingMembers(initial, emptyMemberLookup), []);
    const j1 = joined(STAFF, '2026-10-01T11:00:00Z');
    const rejoined = fullState({ audit: [j1, event('status', 'request', R1, STAFF)] });
    const requested = pendingMembers(rejoined, lookup);
    expect(requested).toEqual([{ id: STAFF, join: j1.id }]);

    // While the call is in flight J1 leaves the window: nothing is pending
    // any more, but the answer must still be used when it arrives.
    const shifted = fullState({ audit: [event('resource', 'resource', RES, OWNER), event('status', 'request', R1, STAFF)] });
    expect(pendingMembers(shifted, lookup)).toEqual([]);
    const late = apply(lookup, requested, [member(STAFF, 'staff@taller.es')]);
    expect(describeActivity(shifted.audit![1], shifted, late.emails).actor).toBe('staff@taller.es');
    expect(pendingMembers(shifted, late)).toEqual([]);
  });

  it('variante: un UUID nunca consultado cuya readmisión sale de la ventana queda resuelto con la respuesta tardía', () => {
    const j1 = joined(STAFF, '2026-10-01T11:00:00Z');
    const requested = pendingMembers(fullState({ audit: [j1, event('status', 'request', R1, STAFF)] }), emptyMemberLookup);
    const shifted = fullState({ audit: [event('status', 'request', R1, STAFF)] });
    const late = apply(emptyMemberLookup, requested, [member(STAFF, 'staff@taller.es')]);
    expect(pendingMembers(shifted, late)).toEqual([]);
  });

  it('una respuesta negativa tardía de una petición superada no oculta una readmisión más reciente', () => {
    const j1 = joined(STAFF, '2026-10-01T11:00:00Z');
    const requestedJ1 = pendingMembers(fullState({ audit: [j1, event('status', 'request', R1, STAFF)] }), emptyMemberLookup);
    const j2 = joined(STAFF, '2026-10-01T12:00:00Z');
    const now = fullState({ audit: [j2, j1, event('status', 'request', R1, STAFF)] });
    const afterOld = apply(emptyMemberLookup, requestedJ1, []);
    expect(pendingMembers(now, afterOld)).toEqual([{ id: STAFF, join: j2.id }]);
  });

  it('una respuesta tardía no borra un email que ya resolvió una petición más reciente', () => {
    const newer = applyMemberSnapshot(emptyMemberLookup, 2, [{ id: STAFF, join: '' }], [member(STAFF, 'staff@taller.es')]);
    const afterOld = applyMemberSnapshot(newer, 1, [{ id: STAFF, join: '' }], []);
    expect(afterOld.emails.get(STAFF)).toBe('staff@taller.es');
    expect(pendingMembers(fullState({ audit: [event('status', 'request', R1, STAFF)] }), afterOld)).toEqual([]);
  });

  it('la readmisión más reciente se identifica por fecha aunque la lista no venga ordenada', () => {
    const older = joined(STAFF, '2026-10-01T09:00:00Z');
    const newer = joined(STAFF, '2026-10-01T12:00:00Z');
    expect(pendingMembers(fullState({ audit: [older, newer] }), emptyMemberLookup)).toEqual([{ id: STAFF, join: newer.id }]);
  });

  it('el propietario actual como destinatario de un evento de miembro no dispara consultas', () => {
    const lookup: MemberLookup = { seq: 1, emails: new Map([[STAFF, 'staff@taller.es']]), missing: new Map() };
    expect(pendingMembers(fullState({ audit: [event('member_removed', 'member', OWNER, STAFF)] }), lookup)).toEqual([]);
  });
});

// Ronda 2, hallazgo 2: auditHead used to be a direct effect dependency, so a
// new audit row while list_members was in flight cancelled a valid response
// and started a duplicate call. memberLoadKey is now the effect's only
// load-related dependency (together with the workshop id).
describe('Actividad del taller: reintentos de la carga de miembros', () => {
  const P = `${STAFF}@`;

  it('sin fallo, un cambio de la cabecera de auditoría no cambia la clave (no cancela ni duplica la carga en curso)', () => {
    expect(memberLoadKey(P, null, 'head-1')).toBe(P);
    expect(memberLoadKey(P, null, 'head-2')).toBe(P);
    expect(memberLoadKey(P, null, undefined)).toBe(P);
  });

  it('sin autores pendientes no hay carga, haya fallado antes o no', () => {
    expect(memberLoadKey('', null, 'head-1')).toBeNull();
    expect(memberLoadKey('', 'head-1', 'head-2')).toBeNull();
  });

  it('tras un fallo no reintenta mientras la auditoría no avance', () => {
    expect(memberLoadKey(P, 'head-1', 'head-1')).toBeNull();
    expect(memberLoadKey(P, '', undefined)).toBeNull();
  });

  it('tras un fallo reintenta cuando llega una operación nueva, y la clave no cambia con más operaciones', () => {
    const retry = memberLoadKey(P, 'head-1', 'head-2');
    expect(retry).not.toBeNull();
    expect(retry).not.toBe(P);
    expect(memberLoadKey(P, 'head-1', 'head-3')).toBe(retry);
  });

  it('un segundo fallo espera a otra operación nueva y un éxito vuelve a la clave normal', () => {
    // The retry started at head-2 and failed -> failedHead becomes head-2.
    expect(memberLoadKey(P, 'head-2', 'head-2')).toBeNull();
    expect(memberLoadKey(P, 'head-2', 'head-3')).not.toBe(memberLoadKey(P, 'head-1', 'head-3'));
    expect(memberLoadKey(P, null, 'head-3')).toBe(P);
  });

  it('la clave de reintento conserva los autores pendientes que se pedirán', () => {
    const pending = [{ id: STAFF, join: '' }, { id: NEWCOMER, join: 'j1' }];
    const retry = memberLoadKey(pendingMembersKey(pending), 'head-1', 'head-2')!;
    expect(parsePendingMembersKey(retry.split('#')[0])).toEqual(pending);
  });
});

// Ronda 2, hallazgo 3: Date.UTC rolled impossible dates over into real ones.
describe('Actividad del taller: fechas de días especiales', () => {
  const subjectFor = (exception_date: string) =>
    describeActivity(event('workshop_hour_exception', 'workshop_hour_exception', EX), fullState({ hour_exceptions: [{ id: EX, workshop_id: W, exception_date, closed: true, opens_at: null, closes_at: null }] }), null).subject;

  it.each(['2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '2025-02-29', '0099-12-25', '1999-12-31', '2101-01-01', '275760-09-14', '2026-1-5', '2026-12-25T00:00:00Z', ' 2026-12-25', ''])('%j no se muestra', date => {
    expect(subjectFor(date)).toBeNull();
  });

  it.each([['2024-02-29', 'Día: 29 de febrero de 2024'], ['2026-01-01', 'Día: 1 de enero de 2026'], ['2100-12-31', 'Día: 31 de diciembre de 2100']])('%s se muestra como %s', (date, label) => {
    expect(subjectFor(date)).toBe(label);
  });
});

// Ronda 5: responses can arrive out of order. The cache only takes a response
// newer than the last one applied (applyMemberSnapshot), and runMemberLoad is
// the effect body the Activity component runs for every request.
describe('Actividad del taller: orden de respuestas de list_members', () => {
  const member = (user_id: string, email: string): TeamMember => ({ user_id, email, role: 'staff', created_at: '2026-10-01T00:00:00Z' });
  const ask = (id: string, join = ''): PendingMember => ({ id, join });

  it('respuesta nueva después de antigua: se aplican ambas en orden y queda el email nuevo', () => {
    const afterOld = applyMemberSnapshot(emptyMemberLookup, 1, [ask(STAFF)], [member(STAFF, 'anterior@taller.es')]);
    const afterNew = applyMemberSnapshot(afterOld, 2, [ask(STAFF)], [member(STAFF, 'nuevo@taller.es')]);
    expect(afterNew.seq).toBe(2);
    expect(afterNew.emails.get(STAFF)).toBe('nuevo@taller.es');
  });

  it('respuesta antigua positiva después de nueva: se ignora y no pisa el email nuevo', () => {
    const afterNew = applyMemberSnapshot(emptyMemberLookup, 2, [ask(STAFF)], [member(STAFF, 'nuevo@taller.es')]);
    const afterOld = applyMemberSnapshot(afterNew, 1, [ask(STAFF)], [member(STAFF, 'anterior@taller.es')]);
    expect(afterOld).toBe(afterNew);
    expect(afterOld.emails.get(STAFF)).toBe('nuevo@taller.es');
  });

  it('respuesta antigua negativa después de nueva negativa: no reabre la consulta', () => {
    const j1 = event('member_joined', 'member', STAFF, STAFF);
    const j2 = { ...event('member_joined', 'member', STAFF, STAFF), created_at: '2026-10-01T12:00:00Z' };
    const s = fullState({ audit: [j2, j1, event('status', 'request', R1, STAFF)] });
    const afterNew = applyMemberSnapshot(emptyMemberLookup, 2, [ask(STAFF, j2.id)], []);
    expect(pendingMembers(s, afterNew)).toEqual([]);
    const afterOld = applyMemberSnapshot(afterNew, 1, [ask(STAFF, j1.id)], []);
    expect(afterOld.missing.get(STAFF)).toBe(j2.id);
    expect(pendingMembers(s, afterOld)).toEqual([]);
  });

  it('respuesta antigua negativa después de nueva positiva: no borra el email', () => {
    const afterNew = applyMemberSnapshot(emptyMemberLookup, 2, [ask(STAFF)], [member(STAFF, 'staff@taller.es')]);
    const afterOld = applyMemberSnapshot(afterNew, 1, [ask(STAFF)], []);
    expect(afterOld.emails.get(STAFF)).toBe('staff@taller.es');
    expect(afterOld.missing.has(STAFF)).toBe(false);
  });

  it('respuesta antigua cuando todavía no se ha aplicado ninguna nueva: se aplica', () => {
    const afterOld = applyMemberSnapshot(emptyMemberLookup, 1, [ask(STAFF)], [member(STAFF, 'staff@taller.es')]);
    expect(afterOld.seq).toBe(1);
    expect(afterOld.emails.get(STAFF)).toBe('staff@taller.es');
    // The newer request (2) still applies when it arrives afterwards.
    expect(applyMemberSnapshot(afterOld, 2, [ask(STAFF)], [member(STAFF, 'nuevo@taller.es')]).emails.get(STAFF)).toBe('nuevo@taller.es');
  });

  it('una respuesta con el mismo número que la ya aplicada no se vuelve a aplicar', () => {
    const once = applyMemberSnapshot(emptyMemberLookup, 3, [ask(STAFF)], [member(STAFF, 'a@taller.es')]);
    expect(applyMemberSnapshot(once, 3, [ask(STAFF)], [member(STAFF, 'b@taller.es')])).toBe(once);
  });

  it('ids que no cubría la petición nueva: si se descarta la antigua siguen pendientes y se vuelven a pedir', () => {
    const s = fullState({ audit: [event('status', 'request', R1, STAFF), event('status', 'request', R1, NEWCOMER)] });
    // Request 1 asked for both; request 2 only for STAFF and arrived first.
    const afterNew = applyMemberSnapshot(emptyMemberLookup, 2, [ask(STAFF)], [member(STAFF, 'staff@taller.es')]);
    const afterOld = applyMemberSnapshot(afterNew, 1, [ask(NEWCOMER), ask(STAFF)], [member(STAFF, 'staff@taller.es'), member(NEWCOMER, 'nuevo@taller.es')]);
    expect(afterOld).toBe(afterNew);
    expect(pendingMembers(s, afterOld)).toEqual([ask(NEWCOMER)]);
    const afterRetry = applyMemberSnapshot(afterOld, 3, [ask(NEWCOMER)], [member(STAFF, 'staff@taller.es'), member(NEWCOMER, 'nuevo@taller.es')]);
    expect(pendingMembers(s, afterRetry)).toEqual([]);
    expect(describeActivity(s.audit![1], s, afterRetry.emails).actor).toBe('nuevo@taller.es');
  });

  // A stand-in for one mounted Activity instance: its own cache, request
  // counter and mounted flag, wired to runMemberLoad exactly like the effect.
  function instance() {
    const self = { lookup: emptyMemberLookup, mounted: true, latest: 0, failed: null as boolean | null, applied: 0 };
    const ctx: MemberLoadContext = {
      isMounted: () => self.mounted,
      isLatest: seq => seq === self.latest,
      apply: update => { self.applied++; self.lookup = update(self.lookup); },
      settle: failed => { self.failed = failed; },
    };
    return { self, ctx, next: () => ++self.latest };
  }
  function deferred() {
    let resolve!: (value: TeamLoadState) => void;
    const promise = new Promise<TeamLoadState>(r => { resolve = r; });
    return { promise, resolve };
  }
  const ready = (...team: TeamMember[]): TeamLoadState => ({ status: 'ready', snapshot: { members: team, invitations: [] } });

  it('runMemberLoad: dos peticiones solapadas que llegan en orden inverso dejan el email de la más nueva', async () => {
    const a = instance();
    const r1 = deferred(), r2 = deferred();
    const p1 = runMemberLoad(a.ctx, () => r1.promise, a.next(), [ask(STAFF)]);
    const p2 = runMemberLoad(a.ctx, () => r2.promise, a.next(), [ask(STAFF)]);
    r2.resolve(ready(member(STAFF, 'nuevo@taller.es'))); await p2;
    r1.resolve(ready(member(STAFF, 'anterior@taller.es'))); await p1;
    expect(a.self.lookup.emails.get(STAFF)).toBe('nuevo@taller.es');
    expect(a.self.failed).toBe(false);
  });

  it('runMemberLoad: solo la petición más reciente decide el estado de fallo', async () => {
    const a = instance();
    const r1 = deferred(), r2 = deferred();
    const p1 = runMemberLoad(a.ctx, () => r1.promise, a.next(), [ask(STAFF)]);
    const p2 = runMemberLoad(a.ctx, () => r2.promise, a.next(), [ask(STAFF)]);
    r2.resolve({ status: 'error', message: 'x' }); await p2;
    expect(a.self.failed).toBe(true);
    // The older one succeeds later: its emails are taken (nothing newer was
    // applied), but it doesn't clear the newer request's failure.
    r1.resolve(ready(member(STAFF, 'staff@taller.es'))); await p1;
    expect(a.self.lookup.emails.get(STAFF)).toBe('staff@taller.es');
    expect(a.self.failed).toBe(true);
  });

  it('runMemberLoad: una respuesta que llega tras desmontar no se aplica', async () => {
    const a = instance();
    const r1 = deferred();
    const p1 = runMemberLoad(a.ctx, () => r1.promise, a.next(), [ask(STAFF)]);
    a.self.mounted = false;
    r1.resolve(ready(member(STAFF, 'staff@taller.es'))); await p1;
    expect(a.self.applied).toBe(0);
    expect(a.self.lookup).toBe(emptyMemberLookup);
    expect(a.self.failed).toBeNull();
  });

  it('runMemberLoad: al cambiar de taller, la respuesta del taller anterior nunca llega al nuevo', async () => {
    // Activity is keyed by workshop id: the old instance unmounts and a new
    // one starts with its own cache and counter.
    const oldWorkshop = instance();
    const rOld = deferred();
    const pOld = runMemberLoad(oldWorkshop.ctx, () => rOld.promise, oldWorkshop.next(), [ask(STAFF)]);
    oldWorkshop.self.mounted = false;
    const newWorkshop = instance();
    const rNew = deferred();
    const pNew = runMemberLoad(newWorkshop.ctx, () => rNew.promise, newWorkshop.next(), [ask(NEWCOMER)]);
    rOld.resolve(ready(member(STAFF, 'otro-taller@taller.es'))); await pOld;
    expect(newWorkshop.self.lookup.emails.has(STAFF)).toBe(false);
    expect(oldWorkshop.self.applied).toBe(0);
    rNew.resolve(ready(member(NEWCOMER, 'nuevo@taller.es'))); await pNew;
    expect(newWorkshop.self.lookup.emails.get(NEWCOMER)).toBe('nuevo@taller.es');
    expect(newWorkshop.self.lookup.emails.has(STAFF)).toBe(false);
  });
});
