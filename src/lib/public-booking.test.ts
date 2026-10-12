import { describe, expect, it } from 'vitest';
import { BOOKING_UNAVAILABLE_MESSAGE, SLOT_TAKEN_MESSAGE, applyCommand, formatSlot, freeSlots, type Intake, type State } from './domain';
import { createDemo } from './demo';
import { activityActionLabel, activityActor } from './activity';

// Public self-booking in demo mode (the mirror of migration 022). Sunday
// 11 October 2026, 12:00 in Madrid (UTC+2); the workshop opens Monday
// 09:00-11:00 with 60-minute slots, so Monday has 09:00 and 10:00 local
// (07:00Z and 08:00Z).
const now = new Date('2026-10-11T10:00:00Z');
const from = new Date('2026-10-11T11:00:00Z'), to = new Date('2026-10-25T10:00:00Z');
const NINE = '2026-10-12T07:00:00.000Z', TEN = '2026-10-12T08:00:00.000Z';
const intake: Intake = { name: 'Cliente Público', phone: '600 123 456', brand: 'SEAT', model: 'León', plate: '', reason: 'Ruido al frenar', availability: 'Reservar el lun 12 oct, 09:00', notes: '' };
const bayA = '00000000-0000-4000-8000-00000000000a', bayB = '00000000-0000-4000-8000-00000000000b';
function workshop(extra: Partial<State> = {}): State {
  return {
    workshop: { version: 1, hours_version: 1, id: crypto.randomUUID(), slug: 'taller-uno', name: 'Taller Uno', phone: '', address: '', hours: '', timezone: 'Europe/Madrid', appointment_minutes: 60 },
    hours: [{ day_of_week: 1, opens_at: '09:00', closes_at: '11:00' }],
    resources: [{ id: bayA, workshop_id: 'w', name: 'Elevador 1', kind: 'lift', active: true }],
    customers: [], vehicles: [], conversations: [], requests: [], appointments: [], ...extra,
  };
}
function book(state: State, slot: string | undefined, data: Intake = intake, id = crypto.randomUUID(), channel: 'public' | 'simulator' = 'public') {
  return applyCommand(state, { type: 'intake', id, data, messages: [{ role: 'user', content: 'Hola' }], channel, consent: true, ...(slot ? { slot } : {}) }, now);
}

describe('huecos libres para la recepción pública', () => {
  it('reparte el horario en huecos de la duración del taller, solo en el futuro y dentro del horario', () => {
    expect(freeSlots(workshop(), from, to).map(f => f.starts_at)).toEqual([NINE, TEN, '2026-10-19T07:00:00.000Z', '2026-10-19T08:00:00.000Z']);
  });
  it('sin horario estructurado o sin recursos activos no hay huecos (se mantiene la disponibilidad en texto libre)', () => {
    expect(freeSlots(workshop({ hours: [] }), from, to)).toEqual([]);
    expect(freeSlots(workshop({ resources: [{ id: bayA, workshop_id: 'w', name: 'Elevador 1', kind: 'lift', active: false }] }), from, to)).toEqual([]);
  });
  it('un hueco ocupado en el único recurso desaparece; con dos recursos se ofrece en el que queda libre', () => {
    const busy = { version: 1, id: crypto.randomUUID(), workshop_id: 'w', request_id: 'r', resource_id: bayA, starts_at: NINE, duration_minutes: 60, notes: '', status: 'scheduled' as const };
    expect(freeSlots(workshop({ appointments: [busy] }), from, to).map(f => f.starts_at)[0]).toBe(TEN);
    const two = workshop({ appointments: [busy], resources: [{ id: bayB, workshop_id: 'w', name: 'Elevador 2', kind: 'lift', active: true }, { id: bayA, workshop_id: 'w', name: 'Elevador 1', kind: 'lift', active: true }] });
    expect(freeSlots(two, from, to)[0]).toEqual({ starts_at: NINE, resource_id: bayB });
    expect(freeSlots(two, from, to)[1]).toEqual({ starts_at: TEN, resource_id: bayA });
    // A cancelled appointment frees its slot again.
    expect(freeSlots(workshop({ appointments: [{ ...busy, status: 'cancelled' }] }), from, to)[0].starts_at).toBe(NINE);
  });
  it('una cita que se solapa solo en parte también ocupa el hueco', () => {
    const partial = { version: 1, id: crypto.randomUUID(), workshop_id: 'w', request_id: 'r', resource_id: bayA, starts_at: '2026-10-12T07:30:00.000Z', duration_minutes: 15, notes: '', status: 'scheduled' as const };
    expect(freeSlots(workshop({ appointments: [partial] }), from, to).map(f => f.starts_at).slice(0, 2)).toEqual([TEN, '2026-10-19T07:00:00.000Z']);
  });
  it('las excepciones de horario cierran el día o lo sustituyen por su propio tramo', () => {
    const closed = workshop({ hour_exceptions: [{ id: 'e', workshop_id: 'w', exception_date: '2026-10-12', closed: true, opens_at: null, closes_at: null }] });
    expect(freeSlots(closed, from, to).map(f => f.starts_at)).toEqual(['2026-10-19T07:00:00.000Z', '2026-10-19T08:00:00.000Z']);
    const special = workshop({ hour_exceptions: [{ id: 'e', workshop_id: 'w', exception_date: '2026-10-13', closed: false, opens_at: '16:00', closes_at: '17:30' }] });
    expect(freeSlots(special, from, new Date('2026-10-14T00:00:00Z')).map(f => f.starts_at)).toEqual([NINE, TEN, '2026-10-13T14:00:00.000Z']);
  });
  it('la hora se muestra en el reloj del taller', () => {
    expect(formatSlot(NINE, 'Europe/Madrid')).toBe('12/10/2026 09:00');
  });
});

describe('reserva desde la recepción pública (modo demo)', () => {
  it('crea la solicitud con la cita reservada en el recurso libre, visible en el panel', () => {
    const s = book(workshop(), NINE);
    expect(s.requests[0]).toMatchObject({ status: 'cita_creada', availability: 'Cita reservada por el cliente: 12/10/2026 09:00' });
    expect(s.appointments).toEqual([expect.objectContaining({ request_id: s.requests[0].id, resource_id: bayA, starts_at: NINE, duration_minutes: 60, status: 'scheduled', notes: 'Reservada por el cliente desde la recepción digital.' })]);
    expect(freeSlots(s, from, to).map(f => f.starts_at)[0]).toBe(TEN);
  });
  it('sin hora elegida funciona como antes: solicitud nueva y sin cita', () => {
    const s = book(workshop(), undefined, { ...intake, availability: 'Tardes' });
    expect(s.requests[0]).toMatchObject({ status: 'nueva', availability: 'Tardes' });
    expect(s.appointments).toEqual([]);
  });
  it('no permite reservar dos veces la misma hora: el segundo envío falla entero y no escribe nada', () => {
    const first = book(workshop(), NINE);
    expect(() => book(first, NINE, { ...intake, name: 'Otra Persona', phone: '600 999 888' })).toThrow(SLOT_TAKEN_MESSAGE);
    // The failed call never touches the state it was given.
    expect(first.requests).toHaveLength(1); expect(first.customers).toHaveLength(1);
    // Another free hour still works.
    expect(book(first, TEN, { ...intake, name: 'Otra Persona', phone: '600 999 888' }).appointments).toHaveLength(2);
  });
  it('tampoco permite reservar una hora que el taller ya ocupó desde el calendario', () => {
    const staff = applyCommand(workshop(), { type: 'intake', id: crypto.randomUUID(), data: { ...intake, phone: '600 111 222', availability: 'Mañanas' }, messages: [{ role: 'user', content: 'Hola' }] }, now);
    const booked = applyCommand(staff, { type: 'appointment', request_version: staff.requests[0].version, id: crypto.randomUUID(), request_id: staff.requests[0].id, resource_id: bayA, starts_at: NINE, duration_minutes: 60, notes: '' }, now);
    expect(() => book(booked, NINE)).toThrow(SLOT_TAKEN_MESSAGE);
  });
  it('y el calendario no puede pisar una hora reservada por un cliente', () => {
    const s = book(workshop(), NINE);
    const other = applyCommand(s, { type: 'intake', id: crypto.randomUUID(), data: { ...intake, phone: '600 111 222', availability: 'Mañanas' }, messages: [{ role: 'user', content: 'Hola' }] }, now);
    const request = other.requests.find(r => r.status === 'nueva')!;
    expect(() => applyCommand(other, { type: 'appointment', request_version: request.version, id: crypto.randomUUID(), request_id: request.id, resource_id: bayA, starts_at: NINE, duration_minutes: 60, notes: '' }, now)).toThrow('coincide con otra cita');
  });
  it('rechaza horas que no son un hueco ofrecido: desalineadas, fuera de horario, demasiado próximas o lejanas, o no válidas', () => {
    for (const slot of ['2026-10-12T07:30:00.000Z', '2026-10-12T12:00:00.000Z', '2026-10-11T10:05:00.000Z', '2026-11-02T08:00:00.000Z', 'mañana']) {
      expect(() => book(workshop(), slot), slot).toThrow(SLOT_TAKEN_MESSAGE);
    }
  });
  it('solo el canal público puede reservar por sí mismo', () => {
    expect(() => book(workshop(), NINE, intake, crypto.randomUUID(), 'simulator')).toThrow('La hora elegida no es válida.');
  });
  it('reenviar la misma solicitud no crea otra cita', () => {
    const id = crypto.randomUUID();
    const s = book(workshop(), NINE, intake, id);
    const again = book(s, NINE, intake, id);
    expect(again.requests).toHaveLength(1); expect(again.appointments).toHaveLength(1);
  });
  it('un reintento de una solicitud ya guardada debe pedir lo mismo que se guardó: otra hora o ninguna se rechaza', () => {
    const id = crypto.randomUUID();
    const s = book(workshop(), NINE, intake, id);
    expect(() => book(s, TEN, intake, id)).toThrow('Tu solicitud ya estaba enviada (Cita reservada por el cliente: 12/10/2026 09:00). Si quieres cambiar la hora, llama al taller.');
    expect(() => book(s, undefined, intake, id)).toThrow('Tu solicitud ya estaba enviada');
    const plain = book(workshop(), undefined, { ...intake, availability: 'Tardes' }, id);
    expect(() => book(plain, NINE, intake, id)).toThrow('Tu solicitud ya estaba enviada (Tardes).');
    expect(book(plain, undefined, intake, id).requests).toHaveLength(1);
  });
  it('la respuesta no depende de si el teléfono ya tiene citas (no revela nada a un anónimo)', () => {
    const s = book(workshop(), NINE);
    expect(book(s, TEN, { ...intake, phone: '+34 600 123 456' }).appointments).toHaveLength(2);
  });
  it('el reintento se compara con la hora reservada aunque el taller haya editado, movido o cancelado la cita', () => {
    const id = crypto.randomUUID();
    const s = book(workshop(), NINE, intake, id);
    const a = s.appointments[0], r = s.requests[0];
    const save = (starts_at: string, notes: string) => applyCommand(s, { type: 'appointment', id: a.id, version: a.version, request_id: id, request_version: r.version, resource_id: bayA, starts_at, duration_minutes: 60, notes }, now);
    for (const changed of [save(NINE, 'Traer las llaves de repuesto'), save(TEN, a.notes), applyCommand(s, { type: 'appointment_status', id: a.id, version: a.version, request_version: r.version, status: 'cancelled' }, now)]) {
      expect(() => book(changed, undefined, intake, id)).toThrow('Tu solicitud ya estaba enviada');
      expect(() => book(changed, '2026-10-19T07:00:00.000Z', intake, id)).toThrow('Tu solicitud ya estaba enviada (');
    }
    // Only notes changed: the booking still stands, so the retry succeeds.
    const edited = save(NINE, 'Traer las llaves de repuesto');
    expect(book(edited, NINE, intake, id)).toEqual(edited);
    // Moved or cancelled: never "Tu cita está reservada" for the old hour.
    for (const changed of [save(TEN, a.notes), applyCommand(s, { type: 'appointment_status', id: a.id, version: a.version, request_version: r.version, status: 'cancelled' }, now)]) {
      expect(() => book(changed, NINE, intake, id)).toThrow('el taller ha cambiado esa cita');
    }
  });
  it('un taller acepta como mucho 10 reservas por su cuenta en 24 horas', () => {
    const hours = [1, 2, 3, 4, 5, 6, 7].map(day_of_week => ({ day_of_week, opens_at: '08:00', closes_at: '20:00' }));
    let s = workshop({ hours });
    for (let i = 0; i < 10; i++) s = book(s, freeSlots(s, from, to)[0].starts_at, { ...intake, phone: '600 000 ' + String(100 + i) });
    expect(s.appointments).toHaveLength(10);
    expect(() => book(s, freeSlots(s, from, to)[0].starts_at, { ...intake, phone: '600 000 999' })).toThrow(BOOKING_UNAVAILABLE_MESSAGE);
    // Older than 24 hours no longer counts.
    const later = { ...s, audit: s.audit!.map(a => ({ ...a, created_at: '2026-10-10T09:00:00.000Z' })) };
    expect(book(later, freeSlots(later, from, to)[0].starts_at, { ...intake, phone: '600 000 999' }).appointments).toHaveLength(11);
  });
  it('la actividad del taller muestra la reserva como hecha por el cliente', () => {
    const s = book(workshop(), NINE);
    const event = s.audit!.find(a => a.action === 'public_booking')!;
    expect(activityActionLabel(event.action)).toBe('Cita reservada por el cliente desde la recepción online');
    expect(activityActor(event, s, null)).toBe('Cliente (recepción online)');
  });
  it('la demo trae horario de lunes a viernes, así que el enlace público ofrece huecos', () => {
    const demo = createDemo();
    const week = freeSlots(demo, new Date(Date.now() + 3600000), new Date(Date.now() + 14 * 86400000));
    expect(week.length).toBeGreaterThan(0);
    expect(demo.appointments).toHaveLength(1);
  });
});

describe('demos guardadas antes del horario de ejemplo', () => {
  it('reciben el horario de ejemplo solo si nunca se configuró, y así el enlace público ofrece horas', async () => {
    const { upgradeDemo, DEMO_SCHEMA_VERSION } = await import('./demo-migration');
    const old = { ...workshop({ hours: undefined }), schema_version: 6 } as State;
    const upgraded = upgradeDemo(old);
    expect(upgraded.schema_version).toBe(DEMO_SCHEMA_VERSION);
    expect(upgraded.hours).toHaveLength(10);
    expect(freeSlots(upgraded, from, to).length).toBeGreaterThan(0);
    // A schedule the owner saved -- even an empty one -- is never replaced.
    expect(upgradeDemo({ ...workshop({ hours: [] }), schema_version: 6 } as State).hours).toEqual([]);
    expect(upgradeDemo({ ...workshop(), schema_version: 6 } as State).hours).toEqual([{ day_of_week: 1, opens_at: '09:00', closes_at: '11:00' }]);
  });
});
