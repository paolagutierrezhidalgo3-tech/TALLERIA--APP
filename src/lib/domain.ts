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
export interface Workshop { version?: number; id: string; name: string; phone: string; address: string; hours: string; timezone: string; appointment_minutes: number }
export interface Customer { version?: number; phone_e164?: string | null; id: string; workshop_id: string; name: string; phone: string; notes: string }
export interface Vehicle { version?: number; id: string; workshop_id: string; customer_id: string; brand: string; model: string; plate: string }
export interface Conversation { id: string; workshop_id: string; messages: Message[]; channel: 'simulator'; created_at: string }
export interface ServiceRequest { id: string; workshop_id: string; customer_id: string; vehicle_id: string; conversation_id: string; reason: string; availability: string; notes: string; status: RequestStatus; created_at: string }
export interface Appointment { resource_id?: string; id: string; workshop_id: string; request_id: string; starts_at: string; duration_minutes: number; status: 'scheduled' | 'completed' | 'cancelled'; notes: string }
export interface Resource { id: string; workshop_id: string; name: string; kind: 'bay' | 'mechanic' | 'lift'; active: boolean; version?: number }
export interface AuditEvent { id: string; workshop_id: string; user_id: string | null; action: string; entity_type: string; entity_id: string; created_at: string; metadata?: Record<string, unknown> }
export interface State { schema_version?: number; role?: 'owner' | 'staff'; user_id?: string; resources?: Resource[]; audit?: AuditEvent[]; metrics?: { new_requests: number; upcoming: number; pending_customers: number; completed: number }; page_info?: { view: string; offset: number; total: number; ids: string[] }; customer_counts?: Record<string, { vehicles: number; requests: number }>; workshop: Workshop; customers: Customer[]; vehicles: Vehicle[]; conversations: Conversation[]; requests: ServiceRequest[]; appointments: Appointment[] }
export type Command =
  | { type: 'intake'; id: string; data: Intake; messages: Message[] }
  | { type: 'status'; id: string; status: RequestStatus }
  | { type: 'appointment'; resource_id?: string; id: string; request_id: string; starts_at: string; duration_minutes: number; notes: string }
  | { type: 'appointment_status'; id: string; status: Appointment['status'] }
  | { type: 'customer'; customer: Customer }
  | { type: 'vehicle'; vehicle: Vehicle }
  | { type: 'settings'; workshop: Workshop }
  | { type: 'resource'; resource: Resource };

export function applyCommand(current: State, command: Command, now = new Date()): State {
  const s = structuredClone(current);
  const workshop_id = s.workshop.id;
  if ((command.type === 'settings' || command.type === 'resource') && s.role === 'staff') throw new Error('Solo el propietario puede realizar esta operación.');
  const recent = (s.audit ?? []).filter(a => a.user_id === (s.user_id ?? 'demo-owner') && new Date(a.created_at).getTime() > now.getTime() - 60000);
  if (command.type === 'intake' && s.requests.some(r => r.id === command.id)) return s;
  if (recent.length >= 100 || command.type === 'intake' && recent.filter(a => a.action === 'intake').length >= 15) throw new Error('Has realizado demasiadas operaciones. Espera un minuto y vuelve a intentarlo.');
  const checkVersion = (old: { version?: number } | undefined, value: { version?: number }) => { if (old && (old.version ?? 1) !== value.version) throw new Error('Este registro ha cambiado. Actualiza la vista antes de guardar.'); };
  if (command.type === 'intake') {
    if (s.requests.some(r => r.id === command.id)) return s;
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
    s.conversations.unshift({ id: conversation_id, workshop_id, messages: command.messages, channel: 'simulator', created_at: now.toISOString() });
    s.requests.unshift({ id: command.id, workshop_id, customer_id: customer.id, vehicle_id: vehicle.id, conversation_id, reason: d.reason, availability: d.availability, notes: d.notes, status: 'nueva', created_at: now.toISOString() });
  }
  if (command.type === 'status') {
    const request = s.requests.find(r => r.id === command.id);
    if (!request) throw new Error('No se ha encontrado la solicitud.');
    if (command.status === 'cita_creada' && !s.appointments.some(a => a.request_id === request.id && a.status === 'scheduled')) throw new Error('Crea primero una cita para esta solicitud.');
    if (s.appointments.some(a => a.request_id === request.id && a.status === 'scheduled') && command.status !== 'cita_creada') throw new Error('Completa o cancela primero la cita asociada.');
    request.status = command.status;
  }
  if (command.type === 'appointment') {
    const request = s.requests.find(r => r.id === command.request_id);
    if (!request || ['completada', 'cancelada'].includes(request.status)) throw new Error('La solicitud no está disponible para una cita.');
    const resource_id = command.resource_id ?? s.resources?.find(r => r.active)?.id;
    if (s.resources && !s.resources.some(r => r.id === resource_id && r.active)) throw new Error('Selecciona un recurso activo de este taller.');
    const start = new Date(command.starts_at).getTime();
    if (!Number.isFinite(start) || start <= now.getTime()) throw new Error('Selecciona una fecha y hora futuras.');
    if (!Number.isInteger(command.duration_minutes) || command.duration_minutes < 15 || command.duration_minutes > 480) throw new Error('La duración debe estar entre 15 y 480 minutos.');
    if (s.appointments.some(a => a.id !== command.id && a.request_id === request.id && a.status === 'scheduled')) throw new Error('Esta solicitud ya tiene una cita activa.');
    if (s.appointments.some(a => a.id !== command.id && a.status === 'scheduled' && a.resource_id === resource_id && start < new Date(a.starts_at).getTime() + a.duration_minutes * 60000 && start + command.duration_minutes * 60000 > new Date(a.starts_at).getTime())) throw new Error('Ese horario coincide con otra cita del mismo recurso. Elige otro horario o recurso.');
    const existing = s.appointments.find(a => a.id === command.id);
    if (existing && (existing.request_id !== request.id || existing.status !== 'scheduled')) throw new Error('No se puede modificar esta cita.');
    const appointment: Appointment = { id: command.id, workshop_id, resource_id, request_id: request.id, starts_at: new Date(start).toISOString(), duration_minutes: command.duration_minutes, notes: command.notes.trim().slice(0, 2000), status: 'scheduled' };
    s.appointments = [...s.appointments.filter(a => a.id !== command.id), appointment]; request.status = 'cita_creada';
  }
  if (command.type === 'appointment_status') {
    const appointment = s.appointments.find(a => a.id === command.id);
    if (!appointment || appointment.status !== 'scheduled' || command.status === 'scheduled') throw new Error('La cita ya no está activa.');
    appointment.status = command.status;
    const request = s.requests.find(r => r.id === appointment.request_id);
    if (request) request.status = command.status === 'completed' ? 'completada' : 'pendiente';
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
    s.workshop = { ...w, version: (s.workshop.version ?? 1) + 1 };
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
  const entity = command.type === 'customer' ? command.customer.id : command.type === 'vehicle' ? command.vehicle.id : command.type === 'settings' ? workshop_id : command.type === 'resource' ? command.resource.id : command.id;
  s.audit = [{ id: crypto.randomUUID(), workshop_id, user_id: s.user_id ?? 'demo-owner', action: command.type, entity_type: command.type === 'intake' || command.type === 'status' ? 'request' : command.type === 'appointment_status' ? 'appointment' : command.type, entity_id: entity, created_at: now.toISOString() }, ...(s.audit ?? [])].slice(0, 1000);
  return s;
}
