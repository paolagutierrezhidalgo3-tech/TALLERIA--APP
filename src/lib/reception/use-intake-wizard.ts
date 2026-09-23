'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { intakeSchema, type Intake, type Message } from '@/lib/domain';
import { MockReceptionProvider, questions } from './provider';
const provider = new MockReceptionProvider();
export interface IntakeSubmission { id: string; data: Intake; messages: Message[] }
/** Shared question-flow state machine behind both the staff-facing manual
 * entry (Reception) and the public customer-facing form (PublicReception).
 * Each caller supplies its own onSubmit and owns its own surrounding
 * chrome/copy/thank-you screen. */
export function useIntakeWizard(onSubmit: (submission: IntakeSubmission) => Promise<boolean>) {
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
  async function confirm(e: FormEvent): Promise<boolean> {
    e.preventDefault(); setError('');
    const parsed = intakeSchema.safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return false; }
    setBusy(true); id.current ??= crypto.randomUUID();
    // onSubmit may throw (the public form does, on a rejected RPC call) as
    // well as resolve to false; either way the id/draft must survive so a
    // retry reuses the same idempotency key instead of losing the answers.
    try { return await onSubmit({ id: id.current, data: parsed.data, messages }); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se ha podido enviar. Inténtalo de nuevo.'); return false; }
    finally { setBusy(false); }
  }
  function reset() { setMessages([{ role: 'assistant', content: questions[0].prompt }]); setDraft(null); setAnswer(''); setError(''); id.current = null; }
  return { messages, answer, setAnswer, draft, setDraft, error, busy, count, chat, send, confirm, reset };
}
