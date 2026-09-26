import { z } from 'zod';
import { normalizePhone, tryNormalizePhone } from './phone';
export { normalizePhone } from './phone';

export const statuses = ['nueva', 'pendiente', 'en_proceso', 'cita_creada', 'completada', 'cancelada'] as const;
export type RequestStatus = typeof statuses[number];
export const statusLabels: Record<RequestStatus, string> = { nueva: 'Nueva', pendiente: 'Pendiente', en_proceso: 'En proceso', cita_creada: 'Cita creada', completada: 'Completada', cancelada: 'Cancelada' };
export const phoneSchema = z.string().transform((value, ctx) => { try { return normalizePhone(value); } catch (error) { ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Teléfono no válido' }); return z.NEVER; } });
export const intakeSchema = z.object({
  name: z.string().trim().min(2, 'Escribe el nombre del cliente').max(100),
  phone: phoneSchema,
  brand: z.string().trim().min(1, 'Indica la marca').max(60),
  model: z.string().trim().min(1, 'Indica el modelo').max(80),
  plate: z.string().trim().max(20).transform(v => v.toUpperCase().replace(/\s/g, '')),
  reason: z.string().trim().min(5, 'Describe la consulta').max(2000),
  availability: z.string().trim().min(2, 'Indica la disponibilidad').max(300),
  notes: z.string().trim().max(2000),
});
export type Intake = z.infer<typeof intakeSchema>;
export interface Message { role: 'assistant' | 'user'; content: string }
export interface Workshop { version?: number; hours_version?: number; slug?: string; id: string; name: string; phone: string; address: string; hours: string; timezone: string; appointment_minutes: number }
export interface Customer { version?: number; phone_e164?: string | null; id: string; workshop_id: string; name: string; phone: string; notes: string }
export interface Vehicle { version?: number; id: string; workshop_id: string; customer_id: string; brand: string; model: string; plate: string }
export interface Conversation { id: string; workshop_id: string; messages: Message[]; channel: 'simulator' | 'public'; created_at: string }
export interface ServiceRequest { version?: number; consent_at?: string | null; id: string; workshop_id: string; customer_id: string; vehicle_id: string; conversation_id: string; reason: string; availability: string; notes: string; status: RequestStatus; created_at: string }
export interface Appointment { version?: number; resource_id?: string; id: string; workshop_id: string; request_id: string; starts_at: string; duration_minutes: number; status: 'scheduled' | 'completed' | 'cancelled'; notes: string }
export interface Resource { id: string; workshop_id: string; name: string; kind: 'bay' | 'mechanic' | 'lift'; active: boolean; version?: number }
export interface AuditEvent { id: string; workshop_id: string; user_id: string | null; action: string; entity_type: string; entity_id: string; created_at: string; metadata?: Record<string, unknown> }
// day_of_week is ISO: 1=lunes .. 7=domingo. A day with no ranges is closed.
export interface WorkshopHourRange { day_of_week: number; opens_at: string; closes_at: string }
export interface WorkshopHourException { version?: number; id: string; workshop_id: string; exception_date: string; closed: boolean; opens_at: string | null; closes_at: string | null }
export interface State { schema_version?: number; role?: 'owner' | 'staff'; user_id?: string; resources?: Resource[]; hours?: WorkshopHourRange[]; hour_exceptions?: WorkshopHourException[]; audit?: AuditEvent[]; metrics?: { new_requests: number; upcoming: number; pending_customers: number; completed: number }; page_info?: { view: string; offset: number; total: number; ids: string[] }; customer_counts?: Record<string, { vehicles: number; requests: number }>; workshop: Workshop; customers: Customer[]; vehicles: Vehicle[]; conversations: Conversation[]; requests: ServiceRequest[]; appointments: Appointment[] }
export type Command =
  | { type: 'intake'; id: string; data: Intake; messages: Message[]; channel?: 'simulator' | 'public'; consent?: boolean }
  | { type: 'status'; version?: number; id: string; status: RequestStatus }
  | { type: 'appointment'; version?: number; request_version?: number; resource_id?: string; id: string; request_id: string; starts_at: string; duration_minutes: number; notes: string }
  | { type: 'appointment_status'; version?: number; request_version?: number; id: string; status: Appointment['status'] }
  | { type: 'customer'; customer: Customer }
  | { type: 'vehicle'; vehicle: Vehicle }
  | { type: 'settings'; workshop: Workshop }
  | { type: 'resource'; resource: Resource }
  | { type: 'workshop_hours'; hours_version?: number; ranges: WorkshopHourRange[] }
  | { type: 'workshop_hour_exception'; exception: WorkshopHourException }
  | { type: 'workshop_hour_exception_delete'; id: string; version?: number }
  | { type: 'customer_anonymize'; id: string; version?: number };

// Right-of-erasure marker (RGPD/LOPDGDD): kept as plain text in `notes`
// instead of a boolean flag so it stays visible and self-explanatory in a
// customer editor that otherwise just shows free text, and so a future
// export of a customer's data carries its own explanation. The editor UI
// checks this exact prefix to know a customer is already anonymized.
export const ANONYMIZED_MARKER = 'Datos personales eliminados';

// A workshop with no customers and no requests yet has nothing for the
// dashboard to show; the caller uses this to switch to a first-run guide
// instead of an empty metrics grid and empty-state messages everywhere.
export function isWorkshopEmpty(state: State): boolean {
  return state.customers.length === 0 && state.requests.length === 0;
}

const ownerOnlyCommands = new Set<Command['type']>(['settings', 'resource', 'workshop_hours', 'workshop_hour_exception', 'workshop_hour_exception_delete', 'customer_anonymize']);
// The calendar date and ISO weekday (1=lunes..7=domingo) an instant falls on
// in a given IANA timezone. Never used for time-of-day comparisons -- those
// go through zonedTimeToUtc below instead, so a DST change can't make a
// later instant format as an earlier-looking wall-clock string.
function localDateParts(date: Date, timeZone: string): { date: string; day_of_week: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  const isoDay: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { date: `${parts.year}-${parts.month}-${parts.day}`, day_of_week: isoDay[parts.weekday] };
}
function offsetMsAt(instant: number, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(fmt.formatToParts(new Date(instant)).map(x => [x.type, x.value]));
  const hour = p.hour === '24' ? 0 : Number(p.hour);
  const asIfUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second));
  return asIfUtc - instant;
}
// Mirrors is_within_business_hours in PostgreSQL: resolves a wall-clock
// "HH:MM on this calendar date, in this timezone" into the real UTC instant
// it refers to. A local time near an offset change can be either ambiguous
// (repeated, e.g. 02:30 the night the clocks go back) or nonexistent
// (skipped, e.g. 02:30 the night they go forward); PostgreSQL's "timestamp
// AT TIME ZONE" resolves both cases to whichever of the two candidate
// offsets is algebraically smaller, so this finds the two offsets actually
// in effect close to this date -- not assumed, and not sampled from fixed
// reference months, since a change can fall outside any such sample
// (Morocco suspends DST for Ramadan on a date that isn't fixed year to
// year) -- and picks whichever one round-trips back to the requested
// wall-clock time, falling back to the smaller one whenever that isn't
// exactly one of them. Verified
// against PostgreSQL for Europe/Madrid, America/New_York, Australia/Sydney,
// Australia/Lord_Howe (30-minute DST) and Africa/Casablanca (its Ramadan
// offset, adjacent to no fixed calendar month).
function zonedTimeToUtc(isoDate: string, time: string, timeZone: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const nearbyOffset = offsetMsAt(guess - offsetMsAt(guess, timeZone), timeZone);
  const dayMs = 86400000;
  // No real timezone changes its offset twice within a couple of days, so
  // probing this far to either side of a first, rough guess always lands
  // clear of the change itself and catches both offsets around it.
  const before = offsetMsAt(guess - nearbyOffset - 2 * dayMs, timeZone);
  const after = offsetMsAt(guess - nearbyOffset + 2 * dayMs, timeZone);
  const lower = Math.min(before, after), upper = Math.max(before, after);
  const upperCandidate = guess - upper;
  const upperIsValid = offsetMsAt(upperCandidate, timeZone) === upper;
  const lowerCandidate = guess - lower;
  const lowerIsValid = offsetMsAt(lowerCandidate, timeZone) === lower;
  return upperIsValid && !lowerIsValid ? upperCandidate : lowerCandidate;
}
// A workshop that never configured structured hours has none of these
// ranges, so it stays unrestricted, exactly like the free-text hours field
// always was.
function isWithinBusinessHours(s: State, start: Date, durationMinutes: number): boolean {
  const hours = s.hours ?? [];
  if (hours.length === 0) return true;
  const tz = s.workshop.timezone;
  const startMs = start.getTime();
  const endMs = startMs + durationMinutes * 60000;
  const from = localDateParts(start, tz);
  // Ranges never span midnight, so an appointment crossing into the next
  // local day can never be fully inside one and is rejected outright.
  if (from.date !== localDateParts(new Date(endMs), tz).date) return false;
  const exception = (s.hour_exceptions ?? []).find(e => e.exception_date === from.date);
  if (exception) {
    if (exception.closed || !exception.opens_at || !exception.closes_at) return false;
    return startMs >= zonedTimeToUtc(from.date, exception.opens_at, tz) && endMs <= zonedTimeToUtc(from.date, exception.closes_at, tz);
  }
  return hours.some(h => h.day_of_week === from.day_of_week && startMs >= zonedTimeToUtc(from.date, h.opens_at, tz) && endMs <= zonedTimeToUtc(from.date, h.closes_at, tz));
}
export function applyCommand(current: State, command: Command, now = new Date()): State {
  const s = structuredClone(current);
  const workshop_id = s.workshop.id;
  if (ownerOnlyCommands.has(command.type) && s.role === 'staff') throw new Error('Solo el propietario puede realizar esta operación.');
  const recent = (s.audit ?? []).filter(a => a.user_id === (s.user_id ?? 'demo-owner') && new Date(a.created_at).getTime() > now.getTime() - 60000);
  if (command.type === 'intake' && s.requests.some(r => r.id === command.id)) return s;
  if (recent.length >= 100 || command.type === 'intake' && recent.filter(a => a.action === 'intake').length >= 15) throw new Error('Has realizado demasiadas operaciones. Espera un minuto y vuelve a intentarlo.');
  const checkVersion = (old: { version?: number } | undefined, value: { version?: number }) => { if (old && (old.version ?? 1) !== value.version) throw new Error('Este registro ha cambiado. Actualiza la vista antes de guardar.'); };
  if (command.type === 'intake') {
    if (s.requests.some(r => r.id === command.id)) return s;
    // Mirrors public_intake's own check: the public link's consent
    // checkbox is a real required field, not a bot heuristic, so a public
    // submission without it is rejected the same way a missing name would
    // be. Manual/staff intake (the default channel) never needed it.
    if (command.channel === 'public' && !command.consent) throw new Error('Debes aceptar el aviso legal para continuar.');
    const d = intakeSchema.parse(command.data);
    let customer = s.customers.find(c => tryNormalizePhone(c.phone) === normalizePhone(d.phone));
    if (!customer) { customer = { id: crypto.randomUUID(), workshop_id, name: d.name, phone: d.phone, phone_e164: d.phone, notes: '', version: 1 }; s.customers.push(customer); }
    let vehicle = s.vehicles.find(v => d.plate ? v.plate === d.plate : v.customer_id === customer.id && v.brand.toLowerCase() === d.brand.toLowerCase() && v.model.toLowerCase() === d.model.toLowerCase());
    if (vehicle && vehicle.customer_id !== customer.id) throw new Error('Esta matrícula pertenece a otro cliente. Revisa el teléfono y la matrícula.');
    if (!vehicle) { vehicle = { id: crypto.randomUUID(), workshop_id, customer_id: customer.id, brand: d.brand, model: d.model, plate: d.plate, version: 1 }; s.vehicles.push(vehicle); }
    // A reviewed intake can correct the description of the same customer's plate.
    if (vehicle.brand !== d.brand || vehicle.model !== d.model) {
      vehicle.brand = d.brand; vehicle.model = d.model; vehicle.version = (vehicle.version ?? 1) + 1;
    }
    const conversation_id = crypto.randomUUID();
    s.conversations.unshift({ id: conversation_id, workshop_id, messages: command.messages, channel: command.channel ?? 'simulator', created_at: now.toISOString() });
    s.requests.unshift({ version: 1, id: command.id, workshop_id, customer_id: customer.id, vehicle_id: vehicle.id, conversation_id, reason: d.reason, availability: d.availability, notes: d.notes, status: 'nueva', created_at: now.toISOString(), consent_at: command.channel === 'public' ? now.toISOString() : null });
  }
  if (command.type === 'status') {
    const request = s.requests.find(r => r.id === command.id);
    if (!request) throw new Error('No se ha encontrado la solicitud.');
    checkVersion(request, command);
    if (command.status === 'cita_creada' && !s.appointments.some(a => a.request_id === request.id && a.status === 'scheduled')) throw new Error('Crea primero una cita para esta solicitud.');
    if (s.appointments.some(a => a.request_id === request.id && a.status === 'scheduled') && command.status !== 'cita_creada') throw new Error('Completa o cancela primero la cita asociada.');
    request.status = command.status; request.version = (request.version ?? 1) + 1;
  }
  if (command.type === 'appointment') {
    const request = s.requests.find(r => r.id === command.request_id);
    if (!request || ['completada', 'cancelada'].includes(request.status)) throw new Error('La solicitud no está disponible para una cita.');
    checkVersion(request, { version: command.request_version });
    const resource_id = command.resource_id ?? s.resources?.find(r => r.active)?.id;
    if (s.resources && !s.resources.some(r => r.id === resource_id && r.active)) throw new Error('Selecciona un recurso activo de este taller.');
    const start = new Date(command.starts_at).getTime();
    if (!Number.isFinite(start) || start <= now.getTime()) throw new Error('Selecciona una fecha y hora futuras.');
    if (!Number.isInteger(command.duration_minutes) || command.duration_minutes < 15 || command.duration_minutes > 480) throw new Error('La duración debe estar entre 15 y 480 minutos.');
    if (!isWithinBusinessHours(s, new Date(start), command.duration_minutes)) throw new Error('La cita debe estar dentro del horario configurado del taller.');
    if (s.appointments.some(a => a.id !== command.id && a.request_id === request.id && a.status === 'scheduled')) throw new Error('Esta solicitud ya tiene una cita activa.');
    if (s.appointments.some(a => a.id !== command.id && a.status === 'scheduled' && a.resource_id === resource_id && start < new Date(a.starts_at).getTime() + a.duration_minutes * 60000 && start + command.duration_minutes * 60000 > new Date(a.starts_at).getTime())) throw new Error('Ese horario coincide con otra cita del mismo recurso. Elige otro horario o recurso.');
    const existing = s.appointments.find(a => a.id === command.id);
    checkVersion(existing, command);
    if (existing && (existing.request_id !== request.id || existing.status !== 'scheduled')) throw new Error('No se puede modificar esta cita.');
    const appointment: Appointment = { version: existing ? (existing.version ?? 1) + 1 : 1, id: command.id, workshop_id, resource_id, request_id: request.id, starts_at: new Date(start).toISOString(), duration_minutes: command.duration_minutes, notes: command.notes.trim().slice(0, 2000), status: 'scheduled' };
    s.appointments = [...s.appointments.filter(a => a.id !== command.id), appointment]; request.status = 'cita_creada'; request.version = (request.version ?? 1) + 1;
  }
  if (command.type === 'appointment_status') {
    const appointment = s.appointments.find(a => a.id === command.id);
    if (!appointment || appointment.status !== 'scheduled' || command.status === 'scheduled') throw new Error('La cita ya no está activa.');
    checkVersion(appointment, command);
    const request = s.requests.find(r => r.id === appointment.request_id);
    if (!request) throw new Error('No se ha encontrado la solicitud.');
    checkVersion(request, { version: command.request_version });
    appointment.status = command.status; appointment.version = (appointment.version ?? 1) + 1;
    request.status = command.status === 'completed' ? 'completada' : 'pendiente'; request.version = (request.version ?? 1) + 1;
  }
  if (command.type === 'customer') {
    const c = { ...command.customer, phone: phoneSchema.parse(command.customer.phone) };
    checkVersion(s.customers.find(other => other.id === c.id), c);
    if (c.workshop_id !== workshop_id || c.name.trim().length < 2 || c.name.length > 100 || c.notes.length > 2000) throw new Error('Revisa los datos del cliente.');
    if (s.customers.some(other => other.id !== c.id && tryNormalizePhone(other.phone) === normalizePhone(c.phone))) throw new Error('Ya existe un cliente con ese teléfono.');
    s.customers = [...s.customers.filter(other => other.id !== c.id), { ...c, name: c.name.trim(), phone: c.phone, phone_e164: c.phone, version: (s.customers.find(other => other.id === c.id)?.version ?? 0) + 1 }];
  }
  if (command.type === 'vehicle') {
    const v = { ...command.vehicle, plate: command.vehicle.plate.toUpperCase().replace(/\s/g, '') };
    if (v.workshop_id !== workshop_id || !s.customers.some(c => c.id === v.customer_id) || !v.brand.trim() || !v.model.trim()) throw new Error('Revisa el cliente y los datos del vehículo.');
    const old = s.vehicles.find(other => other.id === v.id);
    checkVersion(old, v);
    if (v.brand.length > 60 || v.model.length > 80 || v.plate.length > 20) throw new Error('Revisa los datos del vehículo.');
    if (old && old.customer_id !== v.customer_id) throw new Error('No se puede cambiar el propietario de un vehículo existente.');
    if (v.plate && s.vehicles.some(other => other.id !== v.id && other.plate === v.plate)) throw new Error('Ya existe un vehículo con esa matrícula.');
    s.vehicles = [...s.vehicles.filter(other => other.id !== v.id), { ...v, version: (old?.version ?? 0) + 1 }];
  }
  if (command.type === 'settings') {
    const w = { ...command.workshop };
    checkVersion(s.workshop, w);
    if (w.name.length > 100 || w.address.length > 300 || w.hours.length > 300) throw new Error('Revisa los datos del taller.');
    if (w.phone) w.phone = normalizePhone(w.phone);
    if (w.id !== workshop_id || w.name.trim().length < 2 || !Number.isInteger(w.appointment_minutes) || w.appointment_minutes < 15 || w.appointment_minutes > 480) throw new Error('Revisa el nombre y la duración de las citas.');
    try { new Intl.DateTimeFormat('es', { timeZone: w.timezone }); } catch { throw new Error('Zona horaria no válida.'); }
    // The Configuración form can hold a stale copy of the workshop while
    // horarios saves in the background; keep the counter that command owns
    // instead of overwriting it with whatever this form last saw.
    s.workshop = { ...w, version: (s.workshop.version ?? 1) + 1, hours_version: s.workshop.hours_version };
  }
  if (command.type === 'resource') {
    const r = command.resource;
    const resources = s.resources ?? [];
    const old = resources.find(item => item.id === r.id);
    checkVersion(old, r);
    if (r.workshop_id !== workshop_id || r.name.trim().length < 2 || r.name.length > 100 || !['bay', 'mechanic', 'lift'].includes(r.kind)) throw new Error('Revisa los datos del recurso.');
    if (!old && resources.length >= 50) throw new Error('El taller admite hasta 50 recursos.');
    if (resources.some(item => item.id !== r.id && item.name.trim().toLowerCase() === r.name.trim().toLowerCase())) throw new Error('Ya existe un recurso con ese nombre.');
    if (!r.active && s.appointments.some(a => a.resource_id === r.id && a.status === 'scheduled')) throw new Error('Reasigna o cierra las citas de este recurso antes de desactivarlo.');
    if (!r.active && !resources.some(item => item.id !== r.id && item.active)) throw new Error('Debe quedar al menos un recurso activo.');
    s.resources = [...resources.filter(item => item.id !== r.id), { ...r, name: r.name.trim(), version: (old?.version ?? 0) + 1 }];
  }
  if (command.type === 'workshop_hours') {
    const ranges = command.ranges;
    if (ranges.length > 30) throw new Error('El horario no es válido.');
    // Its own counter, separate from workshop.version: replacing the weekly
    // schedule must not remount (and discard unsaved edits in) the settings
    // form, which is keyed by workshop.version.
    if ((s.workshop.hours_version ?? 1) !== command.hours_version) throw new Error('Este registro ha cambiado. Actualiza la vista antes de guardar.');
    for (const r of ranges) {
      if (!Number.isInteger(r.day_of_week) || r.day_of_week < 1 || r.day_of_week > 7) throw new Error('El horario no es válido.');
      if (!/^\d{2}:\d{2}$/.test(r.opens_at) || !/^\d{2}:\d{2}$/.test(r.closes_at) || r.closes_at <= r.opens_at) throw new Error('El horario no es válido.');
    }
    const seen = new Set(ranges.map(r => r.day_of_week + '|' + r.opens_at + '|' + r.closes_at));
    if (seen.size !== ranges.length) throw new Error('Hay horarios duplicados.');
    s.hours = ranges.map(r => ({ ...r }));
    s.workshop = { ...s.workshop, hours_version: (s.workshop.hours_version ?? 1) + 1 };
  }
  if (command.type === 'workshop_hour_exception') {
    const e = command.exception;
    if (e.workshop_id !== workshop_id) throw new Error('Taller no válido.');
    const old = (s.hour_exceptions ?? []).find(item => item.id === e.id);
    // e.version only exists once the client has actually loaded a saved
    // exception; a stale edit/delete race that arrives after it's already
    // been removed must not be treated as a brand-new creation with that
    // same id, or it would silently resurrect a closure the owner deleted.
    if (!old && e.version !== undefined) throw new Error('La excepción ya no existe. Actualiza la vista.');
    checkVersion(old, e);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.exception_date)) throw new Error('Revisa la fecha de la excepción.');
    if (!e.closed && (!e.opens_at || !e.closes_at || e.closes_at <= e.opens_at)) throw new Error('Revisa el horario de la excepción.');
    if ((s.hour_exceptions ?? []).some(item => item.id !== e.id && item.exception_date === e.exception_date)) throw new Error('Ya existe una excepción para esa fecha.');
    const record: WorkshopHourException = { id: e.id, workshop_id, exception_date: e.exception_date, closed: e.closed, opens_at: e.closed ? null : e.opens_at, closes_at: e.closed ? null : e.closes_at, version: (old?.version ?? 0) + 1 };
    s.hour_exceptions = [...(s.hour_exceptions ?? []).filter(item => item.id !== e.id), record];
  }
  if (command.type === 'workshop_hour_exception_delete') {
    const old = (s.hour_exceptions ?? []).find(item => item.id === command.id);
    if (!old) throw new Error('La excepción ya no existe.');
    checkVersion(old, { version: command.version });
    s.hour_exceptions = (s.hour_exceptions ?? []).filter(item => item.id !== command.id);
  }
  if (command.type === 'customer_anonymize') {
    const customer = s.customers.find(c => c.id === command.id);
    if (!customer) throw new Error('No se ha encontrado el cliente.');
    checkVersion(customer, command);
    for (const v of s.vehicles) if (v.customer_id === customer.id && v.plate) { v.plate = ''; v.version = (v.version ?? 1) + 1; }
    customer.name = 'Cliente anonimizado';
    customer.phone = '+00000000';
    customer.phone_e164 = null;
    customer.notes = `${ANONYMIZED_MARKER} el ${now.toISOString().slice(0, 10)} a petición del cliente (derecho de supresión, RGPD/LOPDGDD).`;
    customer.version = (customer.version ?? 1) + 1;
  }
  const entity = command.type === 'customer' ? command.customer.id : command.type === 'vehicle' ? command.vehicle.id : command.type === 'settings' || command.type === 'workshop_hours' ? workshop_id : command.type === 'resource' ? command.resource.id : command.type === 'workshop_hour_exception' ? command.exception.id : command.id;
  const entityType = command.type === 'intake' || command.type === 'status' ? 'request' : command.type === 'appointment_status' ? 'appointment' : command.type === 'workshop_hours' ? 'workshop' : command.type === 'workshop_hour_exception' || command.type === 'workshop_hour_exception_delete' ? 'workshop_hour_exception' : command.type === 'customer_anonymize' ? 'customer' : command.type;
  s.audit = [{ id: crypto.randomUUID(), workshop_id, user_id: s.user_id ?? 'demo-owner', action: command.type, entity_type: entityType, entity_id: entity, created_at: now.toISOString() }, ...(s.audit ?? [])].slice(0, 1000);
  return s;
}
