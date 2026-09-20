'use client';
import { useState, type FormEvent } from 'react';
import type { Appointment, Command, Customer, ServiceRequest, State, Vehicle } from '@/lib/domain';
import { Field, Modal } from './ui';
type Execute = (c: Command) => Promise<boolean>;
export function CustomerEditor({ state, initial, execute, onClose }: { state: State; initial?: Customer; execute: Execute; onClose: () => void }) {
  const [value, setValue] = useState<Customer>(initial ?? { id: crypto.randomUUID(), workshop_id: state.workshop.id, name: '', phone: '', notes: '' });
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) { e.preventDefault(); setBusy(true); if (await execute({ type: 'customer', customer: value })) onClose(); setBusy(false); }
  return <Modal title={initial ? 'Editar cliente' : 'Nuevo cliente'} onClose={onClose}><form onSubmit={save}><Field label="Nombre"><input required minLength={2} maxLength={100} value={value.name} onChange={e => setValue({ ...value, name: e.target.value })}/></Field><Field label="Teléfono"><input required type="tel" maxLength={20} value={value.phone} onChange={e => setValue({ ...value, phone: e.target.value })}/></Field><Field label="Observaciones"><textarea maxLength={2000} value={value.notes} onChange={e => setValue({ ...value, notes: e.target.value })}/></Field><button className="button primary full" disabled={busy}>Guardar cliente</button></form></Modal>;
}
export function VehicleEditor({ state, initial, execute, onClose }: { state: State; initial?: Vehicle; execute: Execute; onClose: () => void }) {
  const [value, setValue] = useState<Vehicle>(initial ?? { id: crypto.randomUUID(), workshop_id: state.workshop.id, customer_id: state.customers[0]?.id ?? '', brand: '', model: '', plate: '' });
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) { e.preventDefault(); setBusy(true); if (await execute({ type: 'vehicle', vehicle: value })) onClose(); setBusy(false); }
  return <Modal title={initial ? 'Editar vehículo' : 'Nuevo vehículo'} onClose={onClose}><form onSubmit={save}><Field label="Cliente"><select required disabled={!!initial} value={value.customer_id} onChange={e => setValue({ ...value, customer_id: e.target.value })}><option value="">Selecciona un cliente</option>{state.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><div className="form-grid"><Field label="Marca"><input required maxLength={60} value={value.brand} onChange={e => setValue({ ...value, brand: e.target.value })}/></Field><Field label="Modelo"><input required maxLength={80} value={value.model} onChange={e => setValue({ ...value, model: e.target.value })}/></Field></div><Field label="Matrícula (opcional)"><input maxLength={20} value={value.plate} onChange={e => setValue({ ...value, plate: e.target.value })}/></Field><button className="button primary full" disabled={busy || !state.customers.length}>Guardar vehículo</button>{!state.customers.length && <p>Crea primero un cliente.</p>}</form></Modal>;
}
function localInput(iso: string) { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
export function AppointmentEditor({ state, request, initial, execute, onClose }: { state: State; request?: ServiceRequest; initial?: Appointment; execute: Execute; onClose: () => void }) {
  const choices = state.requests.filter(r => !['cancelada', 'completada'].includes(r.status) && !state.appointments.some(a => a.request_id === r.id && a.status === 'scheduled' && a.id !== initial?.id));
  const [requestId, setRequestId] = useState(initial?.request_id ?? request?.id ?? choices[0]?.id ?? '');
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
      const ok = await execute({ type: 'appointment', id: initial?.id ?? crypto.randomUUID(), request_id: requestId, starts_at: date.toISOString(), duration_minutes: minutes, notes });
      if (ok) onClose();
    } finally { setBusy(false); }
  }
  return <Modal title={initial ? 'Reprogramar cita' : 'Crear cita'} onClose={onClose}><form onSubmit={save}><Field label="Solicitud"><select required value={requestId} disabled={!!initial || !!request} onChange={e => setRequestId(e.target.value)}><option value="">Selecciona una solicitud</option>{choices.map(r => <option key={r.id} value={r.id}>{state.customers.find(c => c.id === r.customer_id)?.name} · {r.reason}</option>)}</select></Field><Field label="Fecha y hora" hint={'Introduce la hora de tu dispositivo (' + Intl.DateTimeFormat().resolvedOptions().timeZone + '). La agenda se muestra en ' + state.workshop.timezone + '.'}><input required name="starts_at" type="datetime-local" value={starts} onChange={e => setStarts(e.target.value)}/></Field><Field label="Duración (minutos)"><input required type="number" min={15} max={480} step={15} value={minutes} onChange={e => setMinutes(Number(e.target.value))}/></Field><Field label="Notas de la cita"><textarea maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)}/></Field><p role="alert" className={error ? "notice error" : "sr-only"}>{error}</p><button className="button primary full" disabled={busy || !requestId}>{busy ? 'Guardando…' : 'Guardar cita'}</button></form></Modal>;
}
export function Settings({ state, execute }: { state: State; execute: Execute }) {
  const [value, setValue] = useState(state.workshop);
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) { e.preventDefault(); setBusy(true); await execute({ type: 'settings', workshop: value }); setBusy(false); }
  return <form className="card settings-card" onSubmit={save}><h2>Tu taller</h2><p className="muted">La información que mantiene a tu equipo en sintonía.</p><div className="form-grid"><Field label="Nombre del taller"><input required minLength={2} maxLength={100} value={value.name} onChange={e => setValue({ ...value, name: e.target.value })}/></Field><Field label="Teléfono"><input type="tel" maxLength={20} value={value.phone} onChange={e => setValue({ ...value, phone: e.target.value })}/></Field></div><Field label="Dirección"><input maxLength={300} value={value.address} onChange={e => setValue({ ...value, address: e.target.value })}/></Field><Field label="Horario de atención" hint="Informativo en esta versión; revisa el horario al reservar una cita."><input maxLength={300} value={value.hours} onChange={e => setValue({ ...value, hours: e.target.value })}/></Field><div className="form-grid"><Field label="Zona horaria"><select value={value.timezone} onChange={e => setValue({ ...value, timezone: e.target.value })}>{['Europe/Madrid', 'Atlantic/Canary', 'America/Mexico_City', 'America/Bogota', 'America/Argentina/Buenos_Aires'].map(t => <option key={t}>{t}</option>)}</select></Field><Field label="Duración habitual de una cita"><select value={value.appointment_minutes} onChange={e => setValue({ ...value, appointment_minutes: Number(e.target.value) })}>{[15, 30, 45, 60, 90, 120].map(m => <option value={m} key={m}>{m} minutos</option>)}</select></Field></div><button className="button primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button></form>;
}
