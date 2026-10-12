'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Bot, Check, Clock, MapPin, Send, Wrench } from 'lucide-react';
import { localDateParts, type Intake } from '@/lib/domain';
import { questions } from '@/lib/reception/provider';
import { useIntakeWizard, type IntakeSubmission } from '@/lib/reception/use-intake-wizard';
import { publicDemoAvailability, publicDemoIntake, publicDemoWorkshop, type PublicAvailability, type PublicWorkshopInfo } from '@/lib/reception/public-demo';
import { getSupabase, isSupabaseMode } from '@/lib/supabase/client';
import { databaseMessage } from '@/lib/security';
import { Field } from './ui';

const labels: Record<keyof Intake, string> = { name: 'Tu nombre', phone: 'Teléfono', brand: 'Marca', model: 'Modelo', plate: 'Matrícula (opcional)', reason: 'Motivo de la consulta', availability: 'Disponibilidad', notes: 'Observaciones (opcional)' };

// "lun 13 oct" / "10:00" on the workshop's wall clock, never the device's.
function slotDay(iso: string, timeZone: string) { return new Intl.DateTimeFormat('es-ES', { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso)); }
function slotTime(iso: string, timeZone: string) { return new Intl.DateTimeFormat('es-ES', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)); }
function slotLabel(iso: string, timeZone: string) { return slotDay(iso, timeZone) + ', ' + slotTime(iso, timeZone); }

/** Free slots grouped by the workshop's local day, in order. */
function slotsByDay(availability: PublicAvailability) {
  const days = new Map<string, string[]>();
  for (const iso of availability.slots) {
    const key = localDateParts(new Date(iso), availability.timezone).date;
    days.set(key, [...(days.get(key) ?? []), iso]);
  }
  return [...days];
}

function SlotPicker({ availability, onPick, onSkip }: { availability: PublicAvailability; onPick: (iso: string) => void; onSkip: () => void }) {
  const days = slotsByDay(availability);
  const [picked, setDay] = useState('');
  const day = days.some(([key]) => key === picked) ? picked : days[0]?.[0] ?? '';
  const times = days.find(([key]) => key === day)?.[1] ?? [];
  return <div className="slot-picker" role="group" aria-label="Horas libres del taller">
    <small className="muted">Horas libres ({availability.duration_minutes} min). Elige una o escribe tu disponibilidad.</small>
    <div className="slot-days">{days.map(([key, list]) => <button type="button" key={key} className={'button small' + (key === day ? ' primary' : '')} aria-pressed={key === day} onClick={() => setDay(key)}>{slotDay(list[0], availability.timezone)}</button>)}</div>
    <div className="slot-times">{times.map(iso => <button type="button" key={iso} className="button small" onClick={() => onPick(iso)}>{slotTime(iso, availability.timezone)}</button>)}</div>
    <button type="button" className="text-button" onClick={onSkip}>Ninguna me va bien, prefiero escribirlo</button>
  </div>;
}

function Wizard({ onSubmit, slug, availability, reloadAvailability }: { onSubmit: (s: IntakeSubmission, consent: boolean) => Promise<boolean>; slug: string; availability: PublicAvailability | null; reloadAvailability: () => void }) {
  const [done, setDone] = useState<{ slot?: string } | null>(null);
  const [consent, setConsent] = useState(false);
  const [typing, setTyping] = useState(false);
  const { messages, answer, setAnswer, draft, setDraft, error, busy, count, chat, send, chooseSlot, slot, setSlot, confirm } = useIntakeWizard(async s => {
    const ok = await onSubmit(s, consent);
    if (ok) setDone({ slot: s.slot });
    return ok;
  }, reloadAvailability);
  const tz = availability?.timezone ?? 'Europe/Madrid';
  const hasSlots = (availability?.slots.length ?? 0) > 0;
  const askingAvailability = questions[count]?.field === 'availability';
  const showPicker = !draft && askingAvailability && hasSlots && !typing;
  if (done) return <div className="card settings-card"><span className="feature-icon"><Check size={24}/></span><h2>{done.slot ? 'Tu cita está reservada.' : 'Gracias, ya lo tenemos.'}</h2><p className="muted">{done.slot ? `Te esperamos el ${slotLabel(done.slot, tz)}. Si el taller necesita cambiarla, te llamará al teléfono que has indicado.` : 'El taller revisará tu consulta y se pondrá en contacto contigo para confirmar la cita.'}</p></div>;
  const reviewSlots = availability?.slots ?? [];
  // A slot chosen in the chat that a refresh no longer lists still shows,
  // so the select never silently changes what the visitor picked.
  const slotOptions = slot && !reviewSlots.includes(slot) ? [slot, ...reviewSlots] : reviewSlots;
  return <div className="reception-grid"><section className="card chat-card"><div className="chat-head"><span className="bot-icon"><Bot size={22}/></span><div><h3>Recepcionista digital</h3><span className="online"><i/>Cuéntanos qué necesitas</span></div></div><div ref={chat} className="chat-messages" aria-live="polite">{messages.map((m, i) => <div className={'message ' + m.role} key={i}>{m.role === 'assistant' && <small>TALLER</small>}<p>{m.content}</p></div>)}</div>{showPicker && availability && <SlotPicker availability={availability} onPick={iso => chooseSlot(iso, 'Reservar el ' + slotLabel(iso, tz))} onSkip={() => setTyping(true)}/>}{!draft && !showPicker && <form className="chat-input" onSubmit={send}><input aria-label={questions[count]?.prompt ?? 'Respuesta'} placeholder="Escribe tu respuesta…" value={answer} onChange={e => setAnswer(e.target.value)} maxLength={2000} autoComplete="off"/><button className="button primary" aria-label="Enviar respuesta" disabled={!answer.trim()}><Send size={18}/></button></form>}<div className="chat-progress"><span>Paso {Math.min(count + 1, 8)} de 8</span><progress value={count} max={8}/></div></section><section>{draft && <form className="card review-card" onSubmit={e => { if (!consent) { e.preventDefault(); return; } confirm(e); }}><span className="eyebrow"><Check size={14}/> LISTO PARA ENVIAR</span><h2>Revisa tus datos<br/>antes de enviarlos.</h2><div className="form-grid">{questions.map(({ field }) => field === 'availability' && slotOptions.length > 0
    ? <Field key={field} label="Cita"><select value={slot ?? ''} onChange={e => { const iso = e.target.value || null; setSlot(iso); setDraft({ ...draft, availability: iso ? 'Reservar el ' + slotLabel(iso, tz) : '' }); }}><option value="">Sin reservar: prefiero que me llamen</option>{slotOptions.map(iso => <option key={iso} value={iso}>{slotLabel(iso, tz)}</option>)}</select>{!slot && <textarea rows={2} aria-label="Disponibilidad" placeholder="¿Qué días u horarios te vienen bien?" value={draft.availability ?? ''} onChange={e => setDraft({ ...draft, availability: e.target.value })}/>}</Field>
    : <Field key={field} label={labels[field]}>{['reason', 'notes', 'availability'].includes(field) ? <textarea rows={2} value={draft[field] ?? ''} onChange={e => setDraft({ ...draft, [field]: e.target.value })}/> : <input value={draft[field] ?? ''} onChange={e => setDraft({ ...draft, [field]: e.target.value })}/>}</Field>)}</div><label className="checkbox-field"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/><span>He leído y acepto el <a href={'/r/' + slug + '/aviso-legal'} target="_blank" rel="noopener noreferrer">aviso legal y la política de privacidad</a>.</span></label><button className="button primary full" disabled={busy || !consent}>{busy ? 'Enviando…' : slot ? 'Reservar la cita y enviar' : 'Enviar mi consulta'}<ArrowRight size={17}/></button></form>}{error && <p className="notice error" role="alert">{error}</p>}</section></div>;
}

export function PublicReceptionPage({ slug, workshop: initialWorkshop }: { slug: string; workshop?: PublicWorkshopInfo }) {
  const [workshop, setWorkshop] = useState<PublicWorkshopInfo | null>(initialWorkshop ?? null);
  const [checked, setChecked] = useState(isSupabaseMode);
  const startedAt = useRef(new Date().toISOString()).current;
  const hpRef = useRef<HTMLInputElement>(null);
  const [availability, setAvailability] = useState<PublicAvailability | null>(null);
  // Free slots are a convenience: any failure (no network, or a database
  // without public_availability yet) just leaves the free-text question,
  // and a slot is only ever sent when it came from this same lookup --
  // public_availability and the public_intake that books it ship in the
  // same migration (022).
  const loadAvailability = useCallback(async () => {
    if (!isSupabaseMode) { setAvailability(publicDemoAvailability(slug)); return; }
    try {
      const { data, error } = await getSupabase().rpc('public_availability', { p_slug: slug });
      setAvailability(error || !data ? null : data as PublicAvailability);
    } catch { setAvailability(null); }
  }, [slug]);
  useEffect(() => {
    let alive = true;
    (async () => { await Promise.resolve(); if (alive) await loadAvailability(); })();
    return () => { alive = false; };
  }, [loadAvailability]);
  useEffect(() => {
    if (isSupabaseMode) return;
    let alive = true;
    // localStorage is browser-only; reading it during render (even lazily)
    // would mismatch the server-rendered HTML. Deferring past a microtask,
    // like workspace.tsx's own session effect does past its awaits, keeps
    // the setState calls out of the effect's synchronous body.
    (async () => {
      await Promise.resolve();
      if (!alive) return;
      setWorkshop(publicDemoWorkshop(slug));
      setChecked(true);
    })();
    return () => { alive = false; };
  }, [slug]);
  async function onSubmit(s: IntakeSubmission, consent: boolean): Promise<boolean> {
    if (isSupabaseMode) {
      const { data, error } = await getSupabase().rpc('public_intake', { p_slug: slug, p_data: s.slot ? { ...s.data, slot_starts_at: s.slot } : s.data, p_messages: s.messages, p_client_id: s.id, p_hp: hpRef.current?.value ?? '', p_started_at: startedAt, p_consent: consent });
      if (error) throw new Error(databaseMessage(error));
      // A successful call that returns false means nothing was persisted
      // (honeypot or minimum-duration check): never show "gracias" for a
      // request that doesn't exist. The message stays generic so it reads
      // like any other transient failure, not "you were flagged as a bot".
      if (!data) throw new Error('No hemos podido procesar tu consulta. Espera unos segundos y vuelve a intentarlo.');
      // Best-effort staff notification: never awaited, and any failure is
      // swallowed here too, so it can never turn a request that already
      // succeeded into an error or a delay for this visitor. s.id is this
      // exact request's own id (it's what public_intake just inserted as
      // requests.id), not the workshop's public slug -- see
      // notifyNewRequest for why that's the part that keeps this endpoint
      // from being triggerable without a real request.
      fetch('/api/notify-new-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: s.id }) }).catch(() => {});
      return true;
    }
    return publicDemoIntake(slug, s, consent);
  }
  if (!checked) return null;
  return <main className="auth-layout public-reception">
    <section className="auth-story">
      <div className="brand"><span className="brand-mark"><Wrench size={22}/></span>{workshop?.name ?? 'TALLERIA'}<span className="brand-dot">.</span></div>
      <div>
        <span className="eyebrow">RECEPCIÓN DIGITAL</span>
        <h1>Cuéntanos qué<br/><em>necesita tu vehículo.</em></h1>
        <p>{availability?.slots.length ? 'Responde unas preguntas rápidas y reserva una de las horas libres del taller, o indícanos cuándo te viene bien.' : 'Responde unas preguntas rápidas y el taller revisará tu consulta antes de confirmar una cita.'}</p>
        {workshop && (workshop.address || workshop.hours) && <div className="auth-benefits">{workshop.address && <p><MapPin size={18}/>{workshop.address}</p>}{workshop.hours && <p><Clock size={18}/>{workshop.hours}</p>}</div>}
      </div>
      <div className="reception-footer"><small>Recepción digital de {workshop?.name ?? 'este taller'}.</small><a className="text-button" href={'/r/' + slug + '/aviso-legal'} target="_blank" rel="noopener noreferrer">Aviso legal y privacidad</a></div>
    </section>
    <section className="auth-form">
      {workshop ? <Wizard onSubmit={onSubmit} slug={slug} availability={availability} reloadAvailability={loadAvailability}/> : <div className="card settings-card"><h2>No encontramos este taller.</h2><p className="muted">Comprueba el enlace que te compartieron.</p></div>}
      <input ref={hpRef} type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="sr-only" defaultValue=""/>
    </section>
  </main>;
}
