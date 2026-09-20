'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Bot, Check, RotateCcw, Send, Sparkles } from 'lucide-react';
import { intakeSchema, type Command, type Intake, type Message } from '@/lib/domain';
import { MockReceptionProvider, questions } from '@/lib/reception/provider';
import { Field } from './ui';
const provider = new MockReceptionProvider();
const labels: Record<keyof Intake, string> = { name: 'Nombre del cliente', phone: 'Teléfono', brand: 'Marca', model: 'Modelo', plate: 'Matrícula (opcional)', reason: 'Motivo de la consulta', availability: 'Disponibilidad', notes: 'Observaciones (opcional)' };
export function Reception({ execute, onCreated }: { execute: (c: Command) => Promise<boolean>; onCreated: () => void }) {
  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', content: questions[0].prompt }]);
  const [answer, setAnswer] = useState('');
  const [draft, setDraft] = useState<Partial<Intake> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const id = useRef<string | null>(null);
  const chat = useRef<HTMLDivElement>(null);
  useEffect(() => { if (chat.current) chat.current.scrollTop = chat.current.scrollHeight; }, [messages]);
  const count = messages.filter(m => m.role === 'user').length;
  async function send(e: FormEvent) {
    e.preventDefault(); if (!answer.trim() || busy) return; setError('');
    const q = questions[count];
    if (!q) return;
    const value = q.optional && /^(omitir|no|ninguna)$/i.test(answer.trim()) ? '' : answer.trim();
    const validation = intakeSchema.shape[q.field].safeParse(value);
    if (!validation.success) { setError(validation.error.issues[0].message); return; }
    const next: Message[] = [...messages, { role: 'user', content: answer.trim() }];
    setAnswer('');
    if (count + 1 < questions.length) next.push({ role: 'assistant', content: questions[count + 1].prompt });
    else { next.push({ role: 'assistant', content: 'Gracias. He recogido tus datos. Revisa el resumen y confirma la solicitud; el taller se pondrá en contacto contigo. La cita aún no está reservada.' }); setDraft(await provider.extract(next)); }
    setMessages(next);
  }
  async function confirm(e: FormEvent) {
    e.preventDefault(); setError('');
    const parsed = intakeSchema.safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setBusy(true); id.current ??= crypto.randomUUID();
    const ok = await execute({ type: 'intake', id: id.current, data: parsed.data, messages });
    setBusy(false); if (ok) onCreated();
  }
  function reset() { setMessages([{ role: 'assistant', content: questions[0].prompt }]); setDraft(null); setAnswer(''); setError(''); id.current = null; }
  return <div className="reception-grid"><section className="card chat-card"><div className="chat-head"><span className="bot-icon"><Bot size={22}/></span><div><h3>Recepcionista TALLERIA</h3><span className="online"><i/>Simulador guiado</span></div><button className="icon-button push-right" title="Reiniciar conversación" aria-label="Reiniciar conversación" onClick={reset} disabled={busy}><RotateCcw size={18}/></button></div><div ref={chat} className="chat-messages" aria-live="polite">{messages.map((m, i) => <div className={'message ' + m.role} key={i}>{m.role === 'assistant' && <small>TALLERIA</small>}<p>{m.content}</p></div>)}</div>{!draft && <form className="chat-input" onSubmit={send}><input aria-label={questions[count]?.prompt ?? 'Respuesta'} placeholder="Escribe tu respuesta…" value={answer} onChange={e => setAnswer(e.target.value)} maxLength={2000} autoComplete="off"/><button className="button primary" aria-label="Enviar respuesta" disabled={!answer.trim()}><Send size={18}/></button></form>}<div className="chat-progress"><span>Paso {Math.min(count + 1, 8)} de 8</span><progress value={count} max={8}/></div></section><section>{draft ? <form className="card review-card" onSubmit={confirm}><span className="eyebrow"><Check size={14}/> LISTO PARA REVISAR</span><h2>Una conversación.<br/>Todo en orden.</h2><p className="muted">Puedes corregir los datos antes de crear la solicitud.</p><div className="form-grid">{questions.map(({ field }) => <Field key={field} label={labels[field]}>{['reason', 'notes', 'availability'].includes(field) ? <textarea rows={2} value={draft[field] ?? ''} onChange={e => setDraft({ ...draft, [field]: e.target.value })}/> : <input value={draft[field] ?? ''} onChange={e => setDraft({ ...draft, [field]: e.target.value })}/>}</Field>)}</div><button className="button primary full" disabled={busy}>{busy ? 'Creando solicitud…' : 'Confirmar y crear solicitud'}<ArrowRight size={17}/></button></form> : <div className="card reception-explainer"><span className="feature-icon"><Sparkles size={24}/></span><h2>Prueba una recepción<br/>de principio a fin.</h2><p className="muted">Responde como si fueras un cliente del taller. Al terminar, tendrás una solicitud lista para gestionar.</p><ol><li><b>Conversa</b><span>Nombre, vehículo, consulta y disponibilidad.</span></li><li><b>Revisa los datos</b><span>Confirma el resumen antes de guardarlo.</span></li><li><b>Gestiona la solicitud</b><span>Cliente y vehículo vinculados, listos para una cita.</span></li></ol><div className="demo-notice">Recepción simulada, sin IA generativa ni conexión con WhatsApp o llamadas. No realiza diagnósticos ni confirma citas automáticamente.</div></div>}{error && <p className="notice error" role="alert">{error}</p>}</section></div>;
}
