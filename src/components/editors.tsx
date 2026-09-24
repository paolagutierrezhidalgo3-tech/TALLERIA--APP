'use client';
import { useState, type FormEvent } from 'react';
import { Check, Copy, Link as LinkIcon } from 'lucide-react';
import type { Appointment, Command, Customer, ServiceRequest, State, Vehicle } from '@/lib/domain';
import { Field, Modal } from './ui';
import { Lookup, type FindOptions } from './lookup';
type Execute = (c: Command) => Promise<boolean>;
export function CustomerEditor({ state, initial, execute, onClose }: { state: State; initial?: Customer; execute: Execute; onClose: () => void }) {
  const [value, setValue] = useState<Customer>(initial ?? { id: crypto.randomUUID(), workshop_id: state.workshop.id, name: '', phone: '', notes: '' });
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) { e.preventDefault(); setBusy(true); if (await execute({ type: 'customer', customer: value })) onClose(); setBusy(false); }
  return <Modal title={initial ? 'Editar cliente' : 'Nuevo cliente'} onClose={onClose}><form onSubmit={save}><Field label="Nombre"><input required minLength={2} maxLength={100} value={value.name} onChange={e => setValue({ ...value, name: e.target.value })}/></Field><Field label="Teléfono"><input required type="tel" maxLength={20} value={value.phone} onChange={e => setValue({ ...value, phone: e.target.value })}/></Field><Field label="Observaciones"><textarea maxLength={2000} value={value.notes} onChange={e => setValue({ ...value, notes: e.target.value })}/></Field><button className="button primary full" disabled={busy}>Guardar cliente</button></form></Modal>;
}
export function VehicleEditor({ state, initial, execute, onClose, find }: { state: State; initial?: Vehicle; execute: Execute; onClose: () => void; find: FindOptions }) {
  const [value, setValue] = useState<Vehicle>(initial ?? { id: crypto.randomUUID(), workshop_id: state.workshop.id, customer_id: state.customers[0]?.id ?? '', brand: '', model: '', plate: '' });
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) { e.preventDefault(); setBusy(true); if (await execute({ type: 'vehicle', vehicle: value })) onClose(); setBusy(false); }
  return <Modal title={initial ? 'Editar vehículo' : 'Nuevo vehículo'} onClose={onClose}><form onSubmit={save}><Lookup kind="customer" label="Cliente" disabled={!!initial} selected={value.customer_id} onChange={id=>setValue({...value,customer_id:id})} find={find} initial={state.customers.map(c=>({id:c.id,label:c.name}))}/><div className="form-grid"><Field label="Marca"><input required maxLength={60} value={value.brand} onChange={e => setValue({ ...value, brand: e.target.value })}/></Field><Field label="Modelo"><input required maxLength={80} value={value.model} onChange={e => setValue({ ...value, model: e.target.value })}/></Field></div><Field label="Matrícula (opcional)"><input maxLength={20} value={value.plate} onChange={e => setValue({ ...value, plate: e.target.value })}/></Field><button className="button primary full" disabled={busy || !value.customer_id}>Guardar vehículo</button></form></Modal>;
}
function localInput(iso: string) { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
export function AppointmentEditor({ state, request, initial, execute, onClose, find }: { state: State; request?: ServiceRequest; initial?: Appointment; execute: Execute; onClose: () => void; find: FindOptions }) {
  const choices = state.requests.filter(r => !['cancelada', 'completada'].includes(r.status) && !state.appointments.some(a => a.request_id === r.id && a.status === 'scheduled' && a.id !== initial?.id));
  const [requestId, setRequestId] = useState(initial?.request_id ?? request?.id ?? choices[0]?.id ?? '');
  const [requestVersion, setRequestVersion] = useState(state.requests.find(r=>r.id===(initial?.request_id ?? request?.id ?? choices[0]?.id))?.version);
  const [resourceId, setResourceId] = useState(initial?.resource_id ?? state.resources?.find(r=>r.active)?.id ?? '');
  const [starts, setStarts] = useState(initial ? localInput(initial.starts_at) : '');
  const [minutes, setMinutes] = useState(initial?.duration_minutes ?? state.workshop.appointment_minutes);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('');
    const date = new Date(String(new FormData(e.currentTarget).get('starts_at') ?? ''));
    if (!Number.isFinite(date.getTime())) { setError('Selecciona una fecha y hora válidas.'); return; }
    setBusy(true);
    try {
      const ok = await execute({ type: 'appointment', version: initial?.version, request_version: requestVersion, id: initial?.id ?? crypto.randomUUID(), request_id: requestId, resource_id: resourceId, starts_at: date.toISOString(), duration_minutes: minutes, notes });
      if (ok) onClose();
    } finally { setBusy(false); }
  }
  return <Modal title={initial ? 'Reprogramar cita' : 'Crear cita'} onClose={onClose}><form onSubmit={save}><Lookup kind="request" label="Solicitud" disabled={!!initial||!!request} selected={requestId} onChange={(id,version)=>{setRequestId(id);setRequestVersion(version);}} find={find} initial={choices.map(r=>({id:r.id,version:r.version,label:(state.customers.find(c=>c.id===r.customer_id)?.name??"")+" · "+r.reason}))}/><Field label="Recurso"><select required value={resourceId} onChange={e=>setResourceId(e.target.value)}><option value="">Selecciona un recurso</option>{state.resources?.filter(r=>r.active).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field><Field label="Fecha y hora" hint={'Introduce la hora de tu dispositivo (' + Intl.DateTimeFormat().resolvedOptions().timeZone + '). La agenda se muestra en ' + state.workshop.timezone + '.'}><input required name="starts_at" type="datetime-local" value={starts} onChange={e => setStarts(e.target.value)}/></Field><Field label="Duración (minutos)"><input required type="number" min={15} max={480} step={15} value={minutes} onChange={e => setMinutes(Number(e.target.value))}/></Field><Field label="Notas de la cita"><textarea maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)}/></Field><p role="alert" className={error ? "notice error" : "sr-only"}>{error}</p><button className="button primary full" disabled={busy || !requestId}>{busy ? 'Guardando…' : 'Guardar cita'}</button></form></Modal>;
}
function PublicLink({ slug }: { slug?: string }) {
  const [copied, setCopied] = useState(false);
  if (!slug) return null;
  const url = (typeof window !== 'undefined' ? window.location.origin : '') + '/r/' + slug;
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard unavailable; the link is still selectable */ }
  }
  return <section className="card settings-card">
    <div className="resource-heading"><div><h2>Tu recepción digital</h2><p className="muted">Comparte este enlace con tus clientes: pueden escribir su consulta sin cuenta ni instalar nada.</p></div></div>
    <div className="resource-row"><div><b><LinkIcon size={14}/> {url}</b></div><button type="button" className="button primary" onClick={() => void copy()}>{copied ? <><Check size={14}/>Copiado</> : <><Copy size={14}/>Copiar enlace</>}</button></div>
  </section>;
}
export function Settings({ state, execute }: { state: State; execute: Execute }) {
  const [value, setValue] = useState(state.workshop);
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) { e.preventDefault(); setBusy(true); await execute({ type: 'settings', workshop: value }); setBusy(false); }
  return <><PublicLink slug={state.workshop.slug}/><form className="card settings-card" onSubmit={save}><h2>Tu taller</h2><p className="muted">La información que mantiene a tu equipo en sintonía.</p><div className="form-grid"><Field label="Nombre del taller"><input required minLength={2} maxLength={100} value={value.name} onChange={e => setValue({ ...value, name: e.target.value })}/></Field><Field label="Teléfono"><input type="tel" maxLength={20} value={value.phone} onChange={e => setValue({ ...value, phone: e.target.value })}/></Field></div><Field label="Dirección"><input maxLength={300} value={value.address} onChange={e => setValue({ ...value, address: e.target.value })}/></Field><Field label="Horario de atención" hint="Texto informativo para tus clientes. Para bloquear citas fuera de horario, configura el horario estructurado más abajo."><input maxLength={300} value={value.hours} onChange={e => setValue({ ...value, hours: e.target.value })}/></Field><div className="form-grid"><Field label="Zona horaria"><select value={value.timezone} onChange={e => setValue({ ...value, timezone: e.target.value })}>{['Europe/Madrid', 'Atlantic/Canary', 'America/Mexico_City', 'America/Bogota', 'America/Argentina/Buenos_Aires'].map(t => <option key={t}>{t}</option>)}</select></Field><Field label="Duración habitual de una cita"><select value={value.appointment_minutes} onChange={e => setValue({ ...value, appointment_minutes: Number(e.target.value) })}>{[15, 30, 45, 60, 90, 120].map(m => <option value={m} key={m}>{m} minutos</option>)}</select></Field></div><button className="button primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button></form></>;
}
