'use client';
import { useState, type FormEvent } from 'react';
import { Calendar, Clock, Plus, Trash2 } from 'lucide-react';
import type { Command, State, WorkshopHourException, WorkshopHourRange } from '@/lib/domain';
import { Field, Modal } from './ui';
type Execute = (c: Command) => Promise<boolean>;
const dayNames: Record<number, string> = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 7: 'Domingo' };
const days = [1, 2, 3, 4, 5, 6, 7];
// exception_date is a plain calendar date, not an instant: build it from its
// own y/m/d components so no timezone conversion can shift it to another day.
function dayLabel(isoDate: string) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(y, m - 1, d));
}
export function Hours({ state, execute }: { state: State; execute: Execute }) {
  const [adding, setAdding] = useState<WorkshopHourRange | null>(null);
  const [exception, setException] = useState<WorkshopHourException | null>(null);
  const [busy, setBusy] = useState(false);
  if (state.role === 'staff') return null;
  const ranges = state.hours ?? [];
  const exceptions = (state.hour_exceptions ?? []).slice().sort((a, b) => a.exception_date.localeCompare(b.exception_date));
  async function saveRange(e: FormEvent) {
    e.preventDefault(); if (!adding) return; setBusy(true);
    try { if (await execute({ type: 'workshop_hours', hours_version: state.workshop.hours_version, ranges: [...ranges, adding] })) setAdding(null); }
    finally { setBusy(false); }
  }
  async function removeRange(range: WorkshopHourRange) {
    setBusy(true);
    try { await execute({ type: 'workshop_hours', hours_version: state.workshop.hours_version, ranges: ranges.filter(r => r !== range) }); }
    finally { setBusy(false); }
  }
  async function saveException(e: FormEvent) {
    e.preventDefault(); if (!exception) return; setBusy(true);
    try { if (await execute({ type: 'workshop_hour_exception', exception })) setException(null); }
    finally { setBusy(false); }
  }
  async function removeException(item: WorkshopHourException) {
    setBusy(true);
    try { await execute({ type: 'workshop_hour_exception_delete', id: item.id, version: item.version }); }
    finally { setBusy(false); }
  }
  return <>
    <section className="card settings-card resource-settings">
      <div className="resource-heading"><div><h2>Horario estructurado</h2><p className="muted">{ranges.length ? 'Las citas solo pueden crearse dentro de estos tramos.' : 'Sin configurar todavía: las citas no están restringidas por horario.'}</p></div>
        <button className="button primary" onClick={() => setAdding({ day_of_week: 1, opens_at: '09:00', closes_at: '14:00' })}><Plus size={16}/>Añadir tramo</button></div>
      {days.flatMap(day => {
        const dayRanges = ranges.filter(r => r.day_of_week === day).sort((a, b) => a.opens_at.localeCompare(b.opens_at));
        if (!dayRanges.length) return [<div className="resource-row" key={day}><Clock size={18}/><div><b>{dayNames[day]}</b><small>Cerrado</small></div></div>];
        return dayRanges.map((r, i) => <div className="resource-row" key={day + '-' + r.opens_at + '-' + r.closes_at}><Clock size={18}/><div><b>{i === 0 ? dayNames[day] : ''}</b><small>{r.opens_at}–{r.closes_at}</small></div><button className="icon-button" aria-label={'Eliminar tramo de ' + dayNames[day] + ' ' + r.opens_at + '-' + r.closes_at} disabled={busy} onClick={() => void removeRange(r)}><Trash2 size={14}/></button></div>);
      })}
    </section>
    <section className="card settings-card resource-settings">
      <div className="resource-heading"><div><h2>Excepciones y festivos</h2><p className="muted">Sobrescriben el horario habitual para una fecha concreta.</p></div>
        <button className="button primary" onClick={() => setException({ id: crypto.randomUUID(), workshop_id: state.workshop.id, exception_date: '', closed: true, opens_at: null, closes_at: null })}><Plus size={16}/>Añadir excepción</button></div>
      {exceptions.map(item => <div className="resource-row" key={item.id}><Calendar size={18}/><div><b>{dayLabel(item.exception_date)}</b><small>{item.closed ? 'Cerrado todo el día' : item.opens_at + '–' + item.closes_at}</small></div><button className="icon-button" aria-label={'Eliminar excepción del ' + item.exception_date} disabled={busy} onClick={() => void removeException(item)}><Trash2 size={14}/></button></div>)}
      {!exceptions.length && <p className="muted">No hay excepciones próximas.</p>}
    </section>
    {adding && <Modal title="Añadir tramo de horario" onClose={() => !busy && setAdding(null)}><form onSubmit={saveRange}>
      <Field label="Día"><select value={adding.day_of_week} onChange={e => setAdding({ ...adding, day_of_week: Number(e.target.value) })}>{days.map(d => <option key={d} value={d}>{dayNames[d]}</option>)}</select></Field>
      <div className="form-grid"><Field label="Abre"><input required type="time" value={adding.opens_at} onChange={e => setAdding({ ...adding, opens_at: e.target.value })}/></Field><Field label="Cierra"><input required type="time" value={adding.closes_at} onChange={e => setAdding({ ...adding, closes_at: e.target.value })}/></Field></div>
      <button className="button primary full" disabled={busy}>Guardar tramo</button>
    </form></Modal>}
    {exception && <Modal title="Añadir excepción" onClose={() => !busy && setException(null)}><form onSubmit={saveException}>
      <Field label="Fecha"><input required type="date" value={exception.exception_date} onChange={e => setException({ ...exception, exception_date: e.target.value })}/></Field>
      <label className="checkbox-field"><input type="checkbox" checked={exception.closed} onChange={e => setException({ ...exception, closed: e.target.checked, opens_at: e.target.checked ? null : '09:00', closes_at: e.target.checked ? null : '14:00' })}/>Taller cerrado todo el día</label>
      {!exception.closed && <div className="form-grid"><Field label="Abre"><input required type="time" value={exception.opens_at ?? ''} onChange={e => setException({ ...exception, opens_at: e.target.value })}/></Field><Field label="Cierra"><input required type="time" value={exception.closes_at ?? ''} onChange={e => setException({ ...exception, closes_at: e.target.value })}/></Field></div>}
      <button className="button primary full" disabled={busy}>Guardar excepción</button>
    </form></Modal>}
  </>;
}
