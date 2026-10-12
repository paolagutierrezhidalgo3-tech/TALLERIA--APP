'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Bot, Check, Send } from 'lucide-react';
import { BOOKING_UNAVAILABLE_MESSAGE, SLOT_TAKEN_MESSAGE, intakeSchema, type Intake } from '@/lib/domain';
import { LIMITS, runAgentTurn, slotLabel, visibleTranscript, type AgentMessage, type Proposal } from '@/lib/receptionist/agent';
import { SimulatedProvider } from '@/lib/receptionist/simulated';
import { publicDemoAvailability, publicDemoWorkshop } from '@/lib/reception/public-demo';
import type { IntakeSubmission } from '@/lib/reception/use-intake-wizard';
import { Field } from './ui';

export type AssistantMode = 'simulated' | 'anthropic';
const labels: Record<keyof Intake, string> = { name: 'Tu nombre', phone: 'Teléfono', brand: 'Marca', model: 'Modelo', plate: 'Matrícula (opcional)', reason: 'Motivo de la consulta', availability: 'Disponibilidad', notes: 'Observaciones (opcional)' };
const fields: (keyof Intake)[] = ['name', 'phone', 'brand', 'model', 'plate', 'reason', 'notes'];
type TurnResult = { history: AgentMessage[]; reply: string; proposal?: Proposal | null };

/** Conversational front of the public reception. The assistant (simulated
 * rules or a real model, always labelled as what it is) only talks and
 * proposes; the customer reviews the proposal, accepts the legal notice and
 * sends it through the same onSubmit as the guided form (public_intake). Any
 * failure of the assistant calls onFallback and the page shows that form. */
export function AssistantReception({ slug, mode, demo, workshopName, workshopTimezone, onSubmit, onFallback }: { slug: string; mode: AssistantMode; demo: boolean; workshopName: string; workshopTimezone: string; onSubmit: (s: IntakeSubmission, consent: boolean) => Promise<boolean>; onFallback: (failed: boolean) => void }) {
  const greeting = `¡Hola! Soy ${mode === 'simulated' ? 'el asistente de prueba' : 'la recepcionista digital'} de ${workshopName}. Cuéntame qué necesita tu vehículo y te ayudo a pedir cita.`;
  const [history, setHistory] = useState<AgentMessage[]>([{ role: 'assistant', content: greeting }]);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [draft, setDraft] = useState<Intake | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ slot?: string; timezone?: string } | null>(null);
  const id = useRef<string | null>(null);
  const chat = useRef<HTMLDivElement>(null);
  useEffect(() => { if (chat.current) chat.current.scrollTop = chat.current.scrollHeight; }, [history]);
  const visible = history.filter(m => m.role !== 'tool' && m.content.trim());
  const userTurns = history.filter(m => m.role === 'user').length;
  const timezone = workshopTimezone;

  async function turn(next: AgentMessage[]): Promise<TurnResult | null> {
    if (demo) {
      // Demo mode has no server: the simulated rules run here, with the
      // demo's own read-only availability. Never a real model in the browser.
      const workshop = publicDemoWorkshop(slug);
      if (!workshop) return null;
      const executor = { async availability() { const a = publicDemoAvailability(slug); return a; } };
      return runAgentTurn({ provider: new SimulatedProvider(), executor, history: next, context: { workshopName: workshop.name, timezone, now: new Date() } });
    }
    const response = await fetch('/api/receptionist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, history: next }) });
    const body = await response.json().catch(() => null) as (TurnResult & { fallback?: boolean }) | null;
    if (!response.ok || !body || body.fallback || !Array.isArray(body.history)) return null;
    return body;
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = answer.trim();
    if (!text || busy) return;
    setError(''); setBusy(true); setAnswer('');
    // A new message may change what the customer wants (another day, other
    // data): the previous proposal and consent stop being sendable until the
    // assistant proposes again in this same turn.
    setProposal(null); setDraft(null); setConsent(false);
    const next: AgentMessage[] = [...history, { role: 'user', content: text.slice(0, LIMITS.userChars) }];
    setHistory(next);
    try {
      const result = await turn(next);
      if (!result) { onFallback(true); return; }
      setHistory(result.history);
      if (result.proposal) {
        setProposal(result.proposal);
        setDraft(result.proposal.data);
        // A new or changed proposal must be reviewed (and accepted) again.
        setConsent(false);
      }
    } catch {
      onFallback(true);
    } finally { setBusy(false); }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (!draft || !proposal || !consent || busy) return;
    const parsed = intakeSchema.safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setError(''); setBusy(true); id.current ??= crypto.randomUUID();
    try {
      const ok = await onSubmit({ id: id.current, data: parsed.data, messages: visibleTranscript(history), ...(proposal.slot ? { slot: proposal.slot } : {}) }, consent);
      if (ok) setDone({ slot: proposal.slot, timezone: proposal.timezone });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se ha podido enviar. Inténtalo de nuevo.';
      setError(message);
      // Nothing was stored: drop the hour and let the customer write their
      // availability or ask the assistant for another one.
      if (message === SLOT_TAKEN_MESSAGE || message === BOOKING_UNAVAILABLE_MESSAGE) { setProposal({ data: { ...parsed.data, availability: '' } }); setDraft({ ...parsed.data, availability: '' }); }
    } finally { setBusy(false); }
  }

  if (done) return <div className="card settings-card"><span className="feature-icon"><Check size={24}/></span><h2>{done.slot ? 'Tu cita está reservada.' : 'Gracias, ya lo tenemos.'}</h2><p className="muted">{done.slot ? `Te esperamos el ${slotLabel(done.slot, done.timezone ?? timezone)}. Si el taller necesita cambiarla, te llamará al teléfono que has indicado.` : 'El taller revisará tu consulta y se pondrá en contacto contigo para confirmar la cita.'}</p></div>;
  return <div className="reception-grid">
    <section className="card chat-card">
      <div className="chat-head"><span className="bot-icon"><Bot size={22}/></span><div><h3>{mode === 'simulated' ? 'Asistente de prueba' : 'Recepcionista con IA'} <span className={'assistant-badge ' + mode}>{mode === 'simulated' ? 'Simulado · sin IA' : 'IA'}</span></h3><span className="online"><i/>Cuéntanos qué necesitas</span></div></div>
      <p className="assistant-notice">{mode === 'simulated' ? 'Modo de prueba: respuestas automáticas por reglas, no generadas por inteligencia artificial.' : 'Las respuestas las genera un modelo de inteligencia artificial y pueden contener errores. Revisa el resumen antes de enviarlo.'}</p>
      <div ref={chat} className="chat-messages" aria-live="polite">{visible.map((m, i) => <div className={'message ' + m.role} key={i}>{m.role === 'assistant' && <small>{mode === 'simulated' ? 'ASISTENTE (SIMULADO)' : 'RECEPCIONISTA (IA)'}</small>}<p>{m.content}</p></div>)}{busy && <div className="message assistant"><p>…</p></div>}</div>
      {userTurns < LIMITS.userTurns ? <form className="chat-input" onSubmit={send}><input aria-label="Tu mensaje" placeholder="Escribe tu mensaje…" value={answer} onChange={e => setAnswer(e.target.value)} maxLength={LIMITS.userChars} autoComplete="off" disabled={busy}/><button className="button primary" aria-label="Enviar mensaje" disabled={!answer.trim() || busy}><Send size={18}/></button></form> : <p className="assistant-notice">Has llegado al máximo de mensajes de esta conversación. Revisa la solicitud o usa el formulario guiado.</p>}
      <div className="chat-progress"><button type="button" className="text-button" onClick={() => onFallback(false)}>Prefiero el formulario guiado</button></div>
    </section>
    <section>
      {proposal && draft && <form className="card review-card" onSubmit={confirm}>
        <span className="eyebrow"><Check size={14}/> LISTO PARA ENVIAR</span>
        <h2>Revisa tus datos<br/>antes de enviarlos.</h2>
        <div className="form-grid">
          {fields.map(field => <Field key={field} label={labels[field]}>{['reason', 'notes'].includes(field) ? <textarea rows={2} value={draft[field] ?? ''} onChange={e => setDraft({ ...draft, [field]: e.target.value })}/> : <input value={draft[field] ?? ''} onChange={e => setDraft({ ...draft, [field]: e.target.value })}/>}</Field>)}
          <Field label={proposal.slot ? 'Cita' : labels.availability}>{proposal.slot
            ? <><input value={slotLabel(proposal.slot, proposal.timezone ?? timezone)} readOnly/><button type="button" className="text-button" onClick={() => { setProposal({ data: draft }); setDraft({ ...draft, availability: '' }); }}>Sin reservar: prefiero que me llamen</button></>
            : <textarea rows={2} placeholder="¿Qué días u horarios te vienen bien?" value={draft.availability} onChange={e => setDraft({ ...draft, availability: e.target.value })}/>}</Field>
        </div>
        <label className="checkbox-field"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/><span>He leído y acepto el <a href={'/r/' + slug + '/aviso-legal'} target="_blank" rel="noopener noreferrer">aviso legal y la política de privacidad</a>.</span></label>
        <button className="button primary full" disabled={busy || !consent}>{busy ? 'Enviando…' : proposal.slot ? 'Reservar la cita y enviar' : 'Enviar mi consulta'}<ArrowRight size={17}/></button>
      </form>}
      {error && <p className="notice error" role="alert">{error}</p>}
    </section>
  </div>;
}
