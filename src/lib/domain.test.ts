import { describe, expect, it } from 'vitest';
import { applyCommand, intakeSchema, isWorkshopEmpty, type Command, type Intake, type State } from './domain';
import { MockReceptionProvider, questions } from './reception/provider';
const now = new Date('2030-01-01T08:00:00Z');
const intake: Intake = { name: 'Cliente Prueba', phone: '600 123 456', brand: 'SEAT', model: 'León', plate: '1234 bcd', reason: 'Revisión anual', availability: 'Mañanas', notes: '' };
function empty(): State { return { workshop: { version: 1, hours_version: 1, id: crypto.randomUUID(), name: 'Taller Uno', phone: '', address: '', hours: '', timezone: 'Europe/Madrid', appointment_minutes: 60 }, customers: [], vehicles: [], conversations: [], requests: [], appointments: [] }; }
function receive(state = empty(), data = intake, id = crypto.randomUUID()) { return applyCommand(state, { type: 'intake', id, data, messages: [{ role: 'user', content: 'Quiero una revisión' }] }, now); }
function appointment(state: State, starts_at = '2030-01-02T10:00:00Z', duration_minutes = 60): Command { return { type: 'appointment', request_version: state.requests[0].version, id: crypto.randomUUID(), request_id: state.requests[0].id, starts_at, duration_minutes, notes: '' }; }
describe('Recepción y organización', () => {
  it('crea y enlaza las cuatro entidades sin mutar el estado anterior', () => {
    const original = empty(); const s = receive(original);
    expect(original.requests).toHaveLength(0); expect(s.requests).toHaveLength(1);
    expect(s.requests[0].customer_id).toBe(s.customers[0].id);
    expect(s.requests[0].vehicle_id).toBe(s.vehicles[0].id);
    expect(s.requests[0].conversation_id).toBe(s.conversations[0].id);
    expect(s.vehicles[0].plate).toBe('1234BCD');
    expect(s.vehicles[0].workshop_id).toBe(s.workshop.id);
  });
  it('deduplica por teléfono y matrícula', () => {
    const s = receive(receive(), { ...intake, phone: '600123456' });
    expect(s.requests).toHaveLength(2); expect(s.customers).toHaveLength(1); expect(s.vehicles).toHaveLength(1);
  });
  it('admite varios vehículos por cliente', () => {
    const s = receive(receive(), { ...intake, model: 'Ibiza', plate: '5678FGH' });
    expect(s.customers).toHaveLength(1); expect(s.vehicles).toHaveLength(2);
  });
  it('es idempotente al reenviar el mismo identificador', () => {
    const s = receive(); expect(receive(s, intake, s.requests[0].id).requests).toHaveLength(1);
  });
  it('el canal público exige consentimiento y registra cuándo se dio; el registro manual no lo necesita', () => {
    expect(() => applyCommand(empty(), { type: 'intake', id: crypto.randomUUID(), data: intake, messages: [], channel: 'public' }, now)).toThrow('aviso legal');
    const s = applyCommand(empty(), { type: 'intake', id: crypto.randomUUID(), data: intake, messages: [], channel: 'public', consent: true }, now);
    expect(s.requests[0].consent_at).toBe(now.toISOString());
    expect(s.conversations[0].channel).toBe('public');
    const manual = receive();
    expect(manual.requests[0].consent_at).toBeFalsy();
    expect(manual.conversations[0].channel).toBe('simulator');
  });
  it('rechaza una matrícula asociada a otro cliente sin dejar registros parciales', () => {
    const s = receive();
    expect(() => receive(s, { ...intake, name: 'Otra persona', phone: '611222333' })).toThrow('otro cliente');
    expect(s.customers).toHaveLength(1);
  });
  it('valida los campos y acepta matrícula desconocida', () => {
    expect(intakeSchema.safeParse({ ...intake, phone: 'hola' }).success).toBe(false);
    expect(intakeSchema.safeParse({ ...intake, reason: '' }).success).toBe(false);
    expect(receive(empty(), { ...intake, plate: '' }).vehicles[0].plate).toBe('');
  });
  it('extrae las respuestas guiadas y respeta omitir', async () => {
    const values = ['María', '611222333', 'Toyota', 'Yaris', 'omitir', 'Cambio de aceite', 'Mañanas', 'omitir'];
    const messages = questions.flatMap((q, i) => [{ role: 'assistant' as const, content: q.prompt }, { role: 'user' as const, content: values[i] }]);
    const draft = await new MockReceptionProvider().extract(messages);
    expect(draft.name).toBe('María'); expect(draft.plate).toBe(''); expect(draft.notes).toBe('');
    expect(intakeSchema.safeParse(draft).success).toBe(true);
  });
});
describe('Citas y estados', () => {
  it('crea cita y actualiza solicitud', () => { const s = receive(); const next = applyCommand(s, appointment(s), now); expect(next.requests[0].status).toBe('cita_creada'); expect(next.appointments).toHaveLength(1); });
  it('no permite citas pasadas ni duración inválida', () => {
    const s = receive(); expect(() => applyCommand(s, appointment(s, '2020-01-01'), now)).toThrow('futuras');
    const cmd = appointment(s); if (cmd.type === 'appointment') expect(() => applyCommand(s, { ...cmd, duration_minutes: -5 }, now)).toThrow('duración');
  });
  it('rechaza solapamientos pero permite horarios consecutivos', () => {
    let s = receive(); s = applyCommand(s, appointment(s), now);
    s = receive(s, { ...intake, phone: '600111222', plate: '9876ABC' });
    expect(() => applyCommand(s, appointment(s, '2030-01-02T10:30:00Z'), now)).toThrow('coincide');
    expect(applyCommand(s, appointment(s, '2030-01-02T11:00:00Z'), now).appointments).toHaveLength(2);
  });
  it('impide dos citas activas para una solicitud', () => { const s = receive(); const next = applyCommand(s, appointment(s), now); expect(() => applyCommand(next, appointment(next, '2030-01-03T10:00:00Z'), now)).toThrow('ya tiene'); });
  it('completa la solicitud al completar la cita', () => { const s = receive(); const next = applyCommand(s, appointment(s), now); const done = applyCommand(next, { type: 'appointment_status', version: next.appointments[0].version, request_version: next.requests[0].version, id: next.appointments[0].id, status: 'completed' }, now); expect(done.requests[0].status).toBe('completada'); });
  it('devuelve la solicitud a pendiente al cancelar su cita', () => { const s = receive(); const next = applyCommand(s, appointment(s), now); const done = applyCommand(next, { type: 'appointment_status', version: next.appointments[0].version, request_version: next.requests[0].version, id: next.appointments[0].id, status: 'cancelled' }, now); expect(done.requests[0].status).toBe('pendiente'); });
  it('impide estados incoherentes y reabrir citas cerradas', () => {
    const s = receive(); expect(() => applyCommand(s, { type: 'status', version: s.requests[0].version, id: s.requests[0].id, status: 'cita_creada' }, now)).toThrow('primero');
    const next = applyCommand(s, appointment(s), now); expect(() => applyCommand(next, { type: 'status', version: next.requests[0].version, id: next.requests[0].id, status: 'completada' }, now)).toThrow('cita asociada');
    const done = applyCommand(next, { type: 'appointment_status', version: next.appointments[0].version, request_version: next.requests[0].version, id: next.appointments[0].id, status: 'cancelled' }, now);
    expect(() => applyCommand(done, { type: 'appointment_status', id: done.appointments[0].id, status: 'scheduled' }, now)).toThrow('activa');
  });
  it('valida relaciones y duplicados en edición', () => {
    const s = receive();
    expect(() => applyCommand(s, { type: 'customer', customer: { ...s.customers[0], id: crypto.randomUUID() } }, now)).toThrow('teléfono');
    expect(() => applyCommand(s, { type: 'vehicle', vehicle: { ...s.vehicles[0], workshop_id: crypto.randomUUID() } }, now)).toThrow('Revisa');
  });
});
describe('Horario estructurado', () => {
  // 2030-01-02 is a Wednesday (day_of_week 3); Europe/Madrid is UTC+1 in January.
  it('sin horario configurado, las citas no están restringidas (igual que antes)', () => {
    const s = receive();
    expect(applyCommand(s, appointment(s), now).appointments).toHaveLength(1);
  });
  it('bloquea una cita fuera de los tramos configurados y permite una dentro', () => {
    let s = receive();
    s = applyCommand(s, { type: 'workshop_hours', hours_version: s.workshop.hours_version, ranges: [{ day_of_week: 3, opens_at: '09:00', closes_at: '14:00' }] }, now);
    expect(() => applyCommand(s, appointment(s, '2030-01-02T16:00:00Z'), now)).toThrow('horario configurado');
    expect(applyCommand(s, appointment(s, '2030-01-02T10:00:00Z'), now).appointments).toHaveLength(1);
  });
  it('guardar el horario no toca workshop.version, para no descartar una edición de Configuración en curso', () => {
    const s = receive();
    const next = applyCommand(s, { type: 'workshop_hours', hours_version: s.workshop.hours_version, ranges: [{ day_of_week: 3, opens_at: '09:00', closes_at: '14:00' }] }, now);
    expect(next.workshop.version).toBe(s.workshop.version);
    expect(next.workshop.hours_version).toBe((s.workshop.hours_version ?? 1) + 1);
  });
  it('rechaza una cita que se sale del tramo aunque empiece dentro', () => {
    // 09:00Z = 10:00 local (Europe/Madrid, enero); con 60 min termina a las
    // 11:00 local, fuera del tramo 09:00-10:30 aunque el inicio sí encaje.
    let s = receive();
    s = applyCommand(s, { type: 'workshop_hours', hours_version: s.workshop.hours_version, ranges: [{ day_of_week: 3, opens_at: '09:00', closes_at: '10:30' }] }, now);
    expect(() => applyCommand(s, appointment(s, '2030-01-02T09:00:00Z'), now)).toThrow('horario configurado');
  });
  it('un día cerrado (sin tramos) bloquea aunque otros días estén abiertos', () => {
    let s = receive();
    s = applyCommand(s, { type: 'workshop_hours', hours_version: s.workshop.hours_version, ranges: [{ day_of_week: 1, opens_at: '09:00', closes_at: '20:00' }] }, now);
    expect(() => applyCommand(s, appointment(s, '2030-01-02T10:00:00Z'), now)).toThrow('horario configurado');
  });
  it('una excepción cerrada bloquea ese día aunque el horario semanal lo permita', () => {
    let s = receive();
    s = applyCommand(s, { type: 'workshop_hours', hours_version: s.workshop.hours_version, ranges: [{ day_of_week: 3, opens_at: '09:00', closes_at: '14:00' }] }, now);
    s = applyCommand(s, { type: 'workshop_hour_exception', exception: { id: crypto.randomUUID(), workshop_id: s.workshop.id, exception_date: '2030-01-02', closed: true, opens_at: null, closes_at: null } }, now);
    expect(() => applyCommand(s, appointment(s, '2030-01-02T10:00:00Z'), now)).toThrow('horario configurado');
  });
  it('una excepción abierta sustituye por completo al horario semanal de ese día', () => {
    let s = receive();
    s = applyCommand(s, { type: 'workshop_hours', hours_version: s.workshop.hours_version, ranges: [{ day_of_week: 3, opens_at: '09:00', closes_at: '10:00' }] }, now);
    s = applyCommand(s, { type: 'workshop_hour_exception', exception: { id: crypto.randomUUID(), workshop_id: s.workshop.id, exception_date: '2030-01-02', closed: false, opens_at: '15:00', closes_at: '18:00' } }, now);
    expect(() => applyCommand(s, appointment(s, '2030-01-02T09:00:00Z'), now)).toThrow('horario configurado');
    expect(applyCommand(s, appointment(s, '2030-01-02T16:00:00Z'), now).appointments).toHaveLength(1);
  });
  it('el cambio de hora no permite que una cita de 60 minutos "encoja" y quepa donde en realidad no cabe', () => {
    // 2030-03-31 es el domingo en que Europe/Madrid adelanta el reloj: a las
    // 01:00Z el horario local salta de las 02:00 a las 03:00. Una cita que
    // empieza a las 00:30Z (01:30 local) y dura 60 minutos termina a la
    // 01:30Z real, que son las 03:30 locales -- no las 02:30 que daría sumar
    // la duración sobre la hora local ya convertida. Con cierre a las 03:00,
    // la cita debe rechazarse por acabar 30 minutos tarde en la realidad.
    let s = receive();
    s = applyCommand(s, { type: 'workshop_hours', hours_version: s.workshop.hours_version, ranges: [{ day_of_week: 7, opens_at: '01:00', closes_at: '03:00' }] }, now);
    expect(() => applyCommand(s, appointment(s, '2030-03-31T00:30:00Z'), now)).toThrow('horario configurado');
  });
  it('una hora local repetida al retrasar el reloj no permite colarse fuera de horario', () => {
    // 2030-10-27 es el domingo en que Europe/Madrid atrasa el reloj: las
    // 02:00-02:59 locales ocurren dos veces. Una cita de 30 minutos que
    // empieza a las 00:45Z (02:45 local, primera vez) termina a la 01:15Z
    // (02:15 local, segunda vez): el reloj parece retroceder aunque solo
    // pasaron 30 minutos reales, y una comparación por texto de "02:45" a
    // "02:15" podría leerlo como que cabe en un tramo 02:00-02:30.
    let s = receive();
    s = applyCommand(s, { type: 'workshop_hours', hours_version: s.workshop.hours_version, ranges: [{ day_of_week: 7, opens_at: '02:00', closes_at: '02:30' }] }, now);
    expect(() => applyCommand(s, appointment(s, '2030-10-27T00:45:00Z', 30), now)).toThrow('horario configurado');
  });
  it('valida tramos, rechaza duplicados y exige la versión del taller', () => {
    const s = receive();
    expect(() => applyCommand(s, { type: 'workshop_hours', hours_version: s.workshop.hours_version, ranges: [{ day_of_week: 8, opens_at: '09:00', closes_at: '10:00' }] }, now)).toThrow('no es válido');
    expect(() => applyCommand(s, { type: 'workshop_hours', hours_version: s.workshop.hours_version, ranges: [{ day_of_week: 1, opens_at: '10:00', closes_at: '09:00' }] }, now)).toThrow('no es válido');
    expect(() => applyCommand(s, { type: 'workshop_hours', hours_version: s.workshop.hours_version, ranges: [{ day_of_week: 1, opens_at: '09:00', closes_at: '10:00' }, { day_of_week: 1, opens_at: '09:00', closes_at: '10:00' }] }, now)).toThrow('duplicados');
    expect(() => applyCommand(s, { type: 'workshop_hours', hours_version: (s.workshop.hours_version ?? 1) + 1, ranges: [] }, now)).toThrow('ha cambiado');
  });
  it('solo el propietario administra horarios y excepciones', () => {
    const s = receive(); s.role = 'staff';
    expect(() => applyCommand(s, { type: 'workshop_hours', hours_version: s.workshop.hours_version, ranges: [] }, now)).toThrow('propietario');
    expect(() => applyCommand(s, { type: 'workshop_hour_exception', exception: { id: crypto.randomUUID(), workshop_id: s.workshop.id, exception_date: '2030-01-02', closed: true, opens_at: null, closes_at: null } }, now)).toThrow('propietario');
  });
  it('gestiona excepciones: crea, exige versión al editar y permite eliminar', () => {
    const s = receive();
    const id = crypto.randomUUID();
    const withException = applyCommand(s, { type: 'workshop_hour_exception', exception: { id, workshop_id: s.workshop.id, exception_date: '2030-06-01', closed: true, opens_at: null, closes_at: null } }, now);
    expect(withException.hour_exceptions).toHaveLength(1);
    expect(() => applyCommand(withException, { type: 'workshop_hour_exception', exception: { id, workshop_id: s.workshop.id, exception_date: '2030-06-01', closed: false, opens_at: '09:00', closes_at: '10:00' } }, now)).toThrow('ha cambiado');
    const edited = applyCommand(withException, { type: 'workshop_hour_exception', exception: { id, workshop_id: s.workshop.id, exception_date: '2030-06-01', closed: false, opens_at: '09:00', closes_at: '10:00', version: withException.hour_exceptions![0].version }, }, now);
    expect(edited.hour_exceptions![0].closed).toBe(false);
    const deleted = applyCommand(edited, { type: 'workshop_hour_exception_delete', id, version: edited.hour_exceptions![0].version }, now);
    expect(deleted.hour_exceptions).toHaveLength(0);
  });
});
describe('Arranque de un taller nuevo', () => {
  it('un taller recién creado, sin clientes ni solicitudes, cuenta como vacío', () => {
    expect(isWorkshopEmpty(empty())).toBe(true);
  });
  it('deja de ser vacío en cuanto hay una solicitud (y por tanto un cliente)', () => {
    expect(isWorkshopEmpty(receive())).toBe(false);
  });
  it('un cliente sin solicitudes todavía también cuenta como no-vacío', () => {
    const s = receive();
    const onlyCustomer: State = { ...empty(), customers: s.customers };
    expect(isWorkshopEmpty(onlyCustomer)).toBe(false);
  });
});
