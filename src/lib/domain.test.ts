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
  it('anonimiza un cliente (derecho de supresión) preservando la solicitud y borrando la matrícula de sus vehículos, sin permitirlo a staff', () => {
    const s = receive();
    const staffState = { ...s, role: 'staff' as const };
    expect(() => applyCommand(staffState, { type: 'customer_anonymize', id: s.customers[0].id, version: s.customers[0].version }, now)).toThrow('propietario');
    expect(() => applyCommand(s, { type: 'customer_anonymize', id: s.customers[0].id, version: 99 }, now)).toThrow('ha cambiado');
    const next = applyCommand(s, { type: 'customer_anonymize', id: s.customers[0].id, version: s.customers[0].version }, now);
    expect(next.customers[0].name).toBe('Cliente anonimizado');
    expect(next.customers[0].phone_e164).toBeNull();
    expect(next.customers[0].notes).toContain('supresión');
    expect(next.vehicles[0].plate).toBe('');
    expect(next.requests).toHaveLength(1); // la solicitud se conserva
    expect(next.requests[0].customer_id).toBe(s.customers[0].id);
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
  it('en una hora local ambigua (retraso de reloj), usa el mismo desempate que PostgreSQL: el desplazamiento estándar, no el de horario de verano', () => {
    // 2030-11-03 es el domingo en que America/New_York atrasa el reloj:
    // 01:00-01:59 local ocurre dos veces (primero en EDT, luego en EST). El
    // tramo 01:00-02:00 debe resolverse, como en PostgreSQL, con el
    // desplazamiento estándar (EST, -05:00): la ventana real es
    // [06:00Z, 07:00Z), no [05:00Z, 07:00Z). 05:30Z es la primera vez que el
    // reloj marca la 01:30 (todavía en EDT) y debe quedar fuera del tramo.
    let s = receive();
    s = { ...s, workshop: { ...s.workshop, timezone: 'America/New_York' } };
    s = applyCommand(s, { type: 'workshop_hours', hours_version: s.workshop.hours_version, ranges: [{ day_of_week: 7, opens_at: '01:00', closes_at: '02:00' }] }, now);
    expect(() => applyCommand(s, appointment(s, '2030-11-03T05:30:00Z', 15), now)).toThrow('horario configurado');
    expect(applyCommand(s, appointment(s, '2030-11-03T06:30:00Z', 15), now).appointments).toHaveLength(1);
  });
  it('una hora local inexistente (adelanto de reloj) no admite ninguna cita en ese tramo', () => {
    // 2030-03-10 es el domingo en que America/New_York adelanta el reloj: el
    // reloj salta de la 01:59 EST directamente a las 03:00 EDT, así que
    // 02:00-02:59 local no existe nunca. El tramo 02:00-03:00 colapsa a un
    // único instante real y ninguna cita (de al menos 15 minutos) puede
    // encajar, igual que en PostgreSQL.
    let s = receive();
    s = { ...s, workshop: { ...s.workshop, timezone: 'America/New_York' } };
    s = applyCommand(s, { type: 'workshop_hours', hours_version: s.workshop.hours_version, ranges: [{ day_of_week: 7, opens_at: '02:00', closes_at: '03:00' }] }, now);
    expect(() => applyCommand(s, appointment(s, '2030-03-10T07:00:00Z', 15), now)).toThrow('horario configurado');
    // The original double-guess resolver (no disambiguation at all, just
    // whatever offset the naive first pass happened to converge to) opened
    // this range an hour too early -- [06:00Z, 07:00Z) instead of the
    // correct empty window -- and would have wrongly accepted this.
    expect(() => applyCommand(s, appointment(s, '2030-03-10T06:30:00Z', 15), now)).toThrow('horario configurado');
  });
  it('en una zona con horario de verano de 30 minutos (no de 1 hora), el tramo no se desplaza', () => {
    // Australia/Lord_Howe adelanta el reloj solo 30 minutos (DST +11:00
    // frente a un horario estándar de +10:30), no la 1 hora habitual. Un
    // cálculo que asumiera esa diferencia de 1 hora desplazaría incluso un
    // día normal (sin ambigüedad ni salto): el tramo real 09:00-10:00 local
    // del 7 de enero de 2030 (pleno verano austral, en DST) es
    // [22:00Z, 23:00Z) del día anterior, no [22:30Z, 23:30Z).
    let s = receive();
    s = { ...s, workshop: { ...s.workshop, timezone: 'Australia/Lord_Howe' } };
    s = applyCommand(s, { type: 'workshop_hours', hours_version: s.workshop.hours_version, ranges: [{ day_of_week: 1, opens_at: '09:00', closes_at: '10:00' }] }, now);
    expect(applyCommand(s, appointment(s, '2030-01-06T22:00:00Z', 30), now).appointments).toHaveLength(1);
    expect(() => applyCommand(s, appointment(s, '2030-01-06T22:45:00Z', 30), now)).toThrow('horario configurado');
  });
  it('en una zona que suspende el horario de verano en una fecha móvil (Ramadán), el tramo no se calcula a partir de enero/julio', () => {
    // Africa/Casablanca observa +01:00 casi todo el año, pero lo suspende a
    // +00:00 durante el Ramadán -- una ventana que no cae en ningún mes
    // fijo de un año a otro. Un cálculo que solo mirara enero y julio (que
    // en 2024 son ambos +01:00) nunca vería ese +00:00 y desplazaría el
    // tramo real 09:00-10:00 local del viernes 15 de marzo de 2024 (en
    // plena suspensión) una hora: [08:00Z, 09:00Z) en vez de la correcta
    // [09:00Z, 10:00Z). Fecha histórica y ya pasada, para no depender de
    // predicciones futuras del calendario islámico.
    const past = new Date('2024-01-01T00:00:00Z');
    let s = receive();
    s = { ...s, workshop: { ...s.workshop, timezone: 'Africa/Casablanca' } };
    s = applyCommand(s, { type: 'workshop_hours', hours_version: s.workshop.hours_version, ranges: [{ day_of_week: 5, opens_at: '09:00', closes_at: '10:00' }] }, past);
    expect(applyCommand(s, appointment(s, '2024-03-15T09:00:00Z', 15), past).appointments).toHaveLength(1);
    expect(() => applyCommand(s, appointment(s, '2024-03-15T08:00:00Z', 15), past)).toThrow('horario configurado');
  });
  it('una edición obsoleta no puede resucitar una excepción ya eliminada', () => {
    const s = receive();
    const id = crypto.randomUUID();
    let next = applyCommand(s, { type: 'workshop_hour_exception', exception: { id, workshop_id: s.workshop.id, exception_date: '2030-06-01', closed: true, opens_at: null, closes_at: null } }, now);
    const staleVersion = next.hour_exceptions![0].version;
    next = applyCommand(next, { type: 'workshop_hour_exception_delete', id, version: staleVersion }, now);
    expect(next.hour_exceptions).toHaveLength(0);
    expect(() => applyCommand(next, { type: 'workshop_hour_exception', exception: { id, workshop_id: s.workshop.id, exception_date: '2030-06-01', closed: false, opens_at: '09:00', closes_at: '10:00', version: staleVersion } }, now)).toThrow('ya no existe');
    expect(next.hour_exceptions).toHaveLength(0);
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
