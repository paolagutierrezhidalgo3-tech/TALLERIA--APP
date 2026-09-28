'use client';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { businessHoursForDate, localDateParts, localMinutesOfDay, zonedTimeToUtc, type Appointment, type Command, type State } from '@/lib/domain';
import { addDaysISO, endRowExclusive, fromMinutes, noon, rangeDatesForMode, rowContaining, toMinutes } from '@/lib/calendar-layout';
import { AppointmentCard, Empty } from './ui';
type Execute = (c: Command) => Promise<boolean>;
export interface CalendarProps {
  state: State;
  appointments: Appointment[];
  busy: boolean;
  execute: Execute;
  mode: 'day' | 'week';
  onModeChange: (mode: 'day' | 'week') => void;
  anchor: string;
  onAnchorChange: (iso: string) => void;
  onCreate: (resourceId: string, startsAtIso: string) => void;
  onReprogram: (a: Appointment) => void;
  onCancel: (a: Appointment) => void;
}
export function Calendar({ state, appointments, busy, execute, mode, onModeChange, anchor, onAnchorChange, onCreate, onReprogram, onCancel }: CalendarProps) {
  const tz = state.workshop.timezone;
  const todayISO = localDateParts(new Date(), tz).date;
  const { startISO, endISO } = rangeDatesForMode(anchor, mode);
  const rangeLabel = mode === 'day'
    ? new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(noon(anchor))
    : new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(noon(startISO)) + ' – ' + new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(noon(addDaysISO(endISO, -1)));
  return <section className="card calendar-card">
    <div className="calendar-toolbar">
      <div className="calendar-nav">
        <button type="button" className="icon-button" aria-label="Anterior" onClick={() => onAnchorChange(addDaysISO(anchor, mode === 'day' ? -1 : -7))}><ChevronLeft size={18}/></button>
        <button type="button" className="button small" onClick={() => onAnchorChange(todayISO)}>Hoy</button>
        <button type="button" className="icon-button" aria-label="Siguiente" onClick={() => onAnchorChange(addDaysISO(anchor, mode === 'day' ? 1 : 7))}><ChevronRight size={18}/></button>
        <b className="calendar-range-label">{rangeLabel}</b>
      </div>
      <div className="calendar-mode-toggle" role="group" aria-label="Vista de la agenda">
        <button type="button" className={mode === 'day' ? 'active' : ''} aria-pressed={mode === 'day'} onClick={() => onModeChange('day')}>Día</button>
        <button type="button" className={mode === 'week' ? 'active' : ''} aria-pressed={mode === 'week'} onClick={() => onModeChange('week')}>Semana</button>
      </div>
    </div>
    {mode === 'day'
      ? <DayGrid state={state} appointments={appointments} dateISO={anchor} busy={busy} execute={execute} onCreate={onCreate} onReprogram={onReprogram} onCancel={onCancel}/>
      : <WeekStrip state={state} appointments={appointments} startISO={startISO} busy={busy} execute={execute} onCreate={onCreate} onReprogram={onReprogram} onCancel={onCancel} onOpenDay={dateISO => { onAnchorChange(dateISO); onModeChange('day'); }}/>}
  </section>;
}
interface PositionedItem { a: Appointment; startRow: number; span: number }
function DayGrid({ state, appointments, dateISO, busy, execute, onCreate, onReprogram, onCancel }: { state: State; appointments: Appointment[]; dateISO: string; busy: boolean; execute: Execute; onCreate: CalendarProps['onCreate']; onReprogram: CalendarProps['onReprogram']; onCancel: CalendarProps['onCancel'] }) {
  const tz = state.workshop.timezone;
  const ranges = businessHoursForDate(state, dateISO);
  const activeResources = (state.resources ?? []).filter(r => r.active);
  // An appointment kept from before its resource was deactivated (only
  // possible for a completed/cancelled one -- deactivating a resource with a
  // scheduled cita is blocked) still needs a column, or it would silently
  // disappear from the grid.
  const retiredIds = [...new Set(appointments.map(a => a.resource_id).filter((id): id is string => !!id && !activeResources.some(r => r.id === id)))];
  const columns = [...activeResources, ...retiredIds.map(id => ({ id, name: 'Recurso retirado', kind: 'bay' as const, active: false }))];
  if (!columns.length) return <Empty title="Añade un recurso para usar el calendario">Ve a Configuración → Recursos y capacidad para crear el primero.</Empty>;
  if (ranges !== null && ranges.length === 0 && !appointments.length) return <Empty title="Taller cerrado este día">Puedes forzar una cita igualmente desde «Nueva cita» en la lista, pero aquí no hay horario que mostrar.</Empty>;

  // Grid sizing is a display heuristic only (how much of the day to show) --
  // it uses approximate wall-clock minutes, which is fine for that. Actual
  // placement of every cita below is always based on real instants compared
  // against real row boundaries (zonedTimeToUtc), never on wall-clock
  // arithmetic, so a clock change never mis-sizes or mis-times a block, and
  // a heuristic that guesses the window too small only clamps a cita to the
  // edge row instead of hiding or mis-placing it.
  const approxStarts = appointments.map(a => localMinutesOfDay(new Date(a.starts_at), tz));
  const approxEnds = appointments.map((a, i) => approxStarts[i] + a.duration_minutes);
  const lowerBounds = [...(ranges ?? []).map(r => toMinutes(r.opens_at)), ...approxStarts, 480];
  const upperBounds = [...(ranges ?? []).map(r => toMinutes(r.closes_at)), ...approxEnds, 1200];
  const slot = 30;
  const gridStart = Math.max(0, Math.floor(Math.min(...lowerBounds) / slot) * slot);
  const gridEnd = Math.min(1440, Math.max(gridStart + slot, Math.ceil(Math.max(...upperBounds) / slot) * slot));
  const rows = (gridEnd - gridStart) / slot;

  // The real instant each row boundary refers to on this specific date,
  // resolved the same DST-correct way business-hours enforcement already
  // does (zonedTimeToUtc) -- so a cita's real duration, not its wall-clock
  // minutes, decides how many rows it spans even across a clock change.
  const boundaries = Array.from({ length: rows + 1 }, (_, i) => zonedTimeToUtc(dateISO, fromMinutes(gridStart + i * slot), tz));
  function isRowOpen(row: number) {
    if (ranges === null) return true;
    return ranges.some(r => boundaries[row] >= zonedTimeToUtc(dateISO, r.opens_at, tz) && boundaries[row + 1] <= zonedTimeToUtc(dateISO, r.closes_at, tz));
  }

  const items: PositionedItem[] = appointments.map(a => {
    const startInstant = new Date(a.starts_at).getTime();
    const endInstant = startInstant + a.duration_minutes * 60000;
    const startRow = rowContaining(startInstant, boundaries);
    const span = Math.max(1, endRowExclusive(endInstant, boundaries) - startRow);
    return { a, startRow, span };
  });
  function appointmentCard(item: PositionedItem) {
    const request = state.requests.find(r => r.id === item.a.request_id);
    const resourceName = columns.find(c => c.id === item.a.resource_id)?.name;
    return <AppointmentCard key={item.a.id} appointment={item.a} customerName={request && state.customers.find(c => c.id === request.customer_id)?.name} reason={request?.reason} resourceName={resourceName} timezone={tz} actionable busy={busy}
      onReprogram={() => onReprogram(item.a)}
      onComplete={() => void execute({ type: 'appointment_status', id: item.a.id, version: item.a.version, request_version: request?.version, status: 'completed' })}
      onCancel={() => onCancel(item.a)}/>;
  }
  return <div className="day-grid" style={{ gridTemplateColumns: `64px repeat(${columns.length}, minmax(150px,1fr))`, gridTemplateRows: `auto repeat(${rows}, 32px)` }}>
    <div className="day-grid-cell day-grid-corner" style={{ gridColumn: 1, gridRow: 1 }}/>
    {columns.map((col, i) => <div key={col.id} className="day-grid-cell day-grid-col-head" style={{ gridColumn: i + 2, gridRow: 1 }}>{col.name}</div>)}
    {Array.from({ length: rows }).map((_, row) => row % 2 === 0 ? <div key={'t' + row} className="day-grid-cell day-grid-time" style={{ gridColumn: 1, gridRow: row + 2 }}>{fromMinutes(gridStart + row * slot)}</div> : null)}
    {columns.flatMap((col, colIdx) => {
      // Group this resource's citas into clusters of rows that mutually
      // overlap (two back-to-back 15-minute citas sharing one 30-minute row
      // count as a cluster too, since the grid can't split a row between
      // them): every cluster gets one grid cell stacking all of its citas,
      // so none of them is ever silently dropped -- unlike picking a single
      // "covering" cita per cell, which hid the rest.
      const resourceItems = items.filter(it => it.a.resource_id === col.id).sort((x, y) => x.startRow - y.startRow || x.span - y.span);
      const clusters: PositionedItem[][] = [];
      for (const it of resourceItems) {
        const last = clusters[clusters.length - 1];
        const lastEnd = last ? Math.max(...last.map(x => x.startRow + x.span)) : -Infinity;
        if (last && it.startRow < lastEnd) last.push(it); else clusters.push([it]);
      }
      const coveredRows = new Set<number>();
      const blocks = clusters.map(cluster => {
        const startRow = Math.min(...cluster.map(it => it.startRow));
        const span = Math.max(...cluster.map(it => it.startRow + it.span)) - startRow;
        for (let i = 0; i < span; i++) coveredRows.add(startRow + i);
        const ordered = [...cluster].sort((x, y) => (x.a.status === 'scheduled' ? 0 : 1) - (y.a.status === 'scheduled' ? 0 : 1) || x.startRow - y.startRow);
        return <div key={col.id + '-c-' + cluster[0].a.id} className="day-grid-appointment" style={{ gridColumn: colIdx + 2, gridRow: `${startRow + 2} / span ${span}` }}>{ordered.map(appointmentCard)}</div>;
      });
      const slots = Array.from({ length: rows }).map((_, row) => {
        if (coveredRows.has(row)) return null;
        const open = isRowOpen(row);
        const label = fromMinutes(gridStart + row * slot) + ' · ' + col.name;
        return <button key={col.id + '-s-' + row} type="button" disabled={!open} className={'day-grid-slot' + (open ? '' : ' closed')} aria-label={open ? 'Crear cita a las ' + label : 'Fuera de horario, ' + label} style={{ gridColumn: colIdx + 2, gridRow: row + 2 }} onClick={() => onCreate(col.id, new Date(boundaries[row]).toISOString())}/>;
      });
      return [...blocks, ...slots];
    })}
  </div>;
}
function WeekStrip({ state, appointments, startISO, busy, execute, onCreate, onReprogram, onCancel, onOpenDay }: { state: State; appointments: Appointment[]; startISO: string; busy: boolean; execute: Execute; onCreate: CalendarProps['onCreate']; onReprogram: CalendarProps['onReprogram']; onCancel: CalendarProps['onCancel']; onOpenDay: (iso: string) => void }) {
  const tz = state.workshop.timezone;
  const todayISO = localDateParts(new Date(), tz).date;
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(startISO, i));
  const firstActiveResource = (state.resources ?? []).find(r => r.active);
  return <div className="week-strip">
    {days.map(dayISO => {
      const ranges = businessHoursForDate(state, dayISO);
      const closed = ranges !== null && ranges.length === 0;
      // Overlap with the day's real instant span, not a string match on the
      // cita's own start date: a cita starting the previous evening and
      // ending after local midnight still belongs on this day too (it may
      // legitimately appear under both), instead of vanishing from the week
      // entirely because its start date isn't this one.
      const dayStart = zonedTimeToUtc(dayISO, '00:00', tz);
      const dayEnd = zonedTimeToUtc(addDaysISO(dayISO, 1), '00:00', tz);
      const dayAppointments = appointments.filter(a => {
        const start = new Date(a.starts_at).getTime();
        return start < dayEnd && start + a.duration_minutes * 60000 > dayStart;
      }).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      return <div className={'week-day' + (dayISO === todayISO ? ' is-today' : '')} key={dayISO}>
        <button type="button" className="week-day-head" onClick={() => onOpenDay(dayISO)}>
          <span>{new Intl.DateTimeFormat('es-ES', { weekday: 'short' }).format(noon(dayISO))}</span>
          <b>{Number(dayISO.slice(8, 10))}</b>
        </button>
        {closed && !dayAppointments.length
          ? <p className="muted week-day-closed">Cerrado</p>
          : <div className="week-day-list">{!dayAppointments.length && <p className="muted">Sin citas</p>}{dayAppointments.map(a => {
              const request = state.requests.find(r => r.id === a.request_id);
              return <AppointmentCard key={a.id} appointment={a} customerName={request && state.customers.find(c => c.id === request.customer_id)?.name} reason={request?.reason} resourceName={state.resources?.find(res => res.id === a.resource_id)?.name} timezone={tz} actionable busy={busy}
                onReprogram={() => onReprogram(a)}
                onComplete={() => void execute({ type: 'appointment_status', id: a.id, version: a.version, request_version: request?.version, status: 'completed' })}
                onCancel={() => onCancel(a)}/>;
            })}</div>}
        {firstActiveResource && !closed && <button type="button" className="button small week-day-add" onClick={() => {
          const openMinutes = ranges === null ? 9 * 60 : toMinutes(ranges[0].opens_at);
          onCreate(firstActiveResource.id, new Date(zonedTimeToUtc(dayISO, fromMinutes(openMinutes), tz)).toISOString());
        }}><Plus size={14}/>Nueva cita</button>}
      </div>;
    })}
  </div>;
}
