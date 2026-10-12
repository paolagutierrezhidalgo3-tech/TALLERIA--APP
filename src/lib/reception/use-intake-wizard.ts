'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BOOKING_UNAVAILABLE_MESSAGE, SLOT_TAKEN_MESSAGE, intakeSchema, type Intake, type Message } from '@/lib/domain';
import { MockReceptionProvider, answerValue, questions } from './provider';
const provider = new MockReceptionProvider();
/** slot: the ISO start of a free slot the visitor picked (public form only),
 * booked together with the request or not at all. */
export interface IntakeSubmission { id: string; data: Intake; messages: Message[]; slot?: string }
/** Shared question-flow state machine behind both the staff-facing manual
 * entry (Reception) and the public customer-facing form (PublicReception).
 * Each caller supplies its own onSubmit and owns its own surrounding
 * chrome/copy/thank-you screen. */
export function useIntakeWizard(onSubmit: (submission: IntakeSubmission) => Promise<boolean>, onSlotTaken?: () => void) {
  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', content: questions[0].prompt }]);
  const [answer, setAnswer] = useState('');
  const [draft, setDraft] = useState<Partial<Intake> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [slot, setSlot] = useState<string | null>(null);
  const id = useRef<string | null>(null);
  const chat = useRef<HTMLDivElement>(null);
  useEffect(() => { if (chat.current) chat.current.scrollTop = chat.current.scrollHeight; }, [messages]);
  const count = messages.filter(m => m.role === 'user').length;
  async function answerWith(raw: string, chosenSlot: string | null) {
    if (!raw.trim() || busy) return; setError('');
    const q = questions[count];
    if (!q) return;
    const value = answerValue(q, raw);
    const validation = intakeSchema.shape[q.field].safeParse(value);
    if (!validation.success) { setError(validation.error.issues[0].message); return; }
    const next: Message[] = [...messages, { role: 'user', content: raw.trim() }];
    setAnswer('');
    // Only the availability question can carry a slot; any other answer
    // keeps whatever was chosen there.
    const bookedSlot = q.field === 'availability' ? chosenSlot : slot;
    if (q.field === 'availability') setSlot(chosenSlot);
    if (count + 1 < questions.length) next.push({ role: 'assistant', content: questions[count + 1].prompt });
    else { next.push({ role: 'assistant', content: bookedSlot ? 'Gracias. He recogido tus datos. Revisa el resumen y confirma: al enviarlo, la hora que has elegido quedará reservada.' : 'Gracias. He recogido tus datos. Revisa el resumen y confirma la solicitud; el taller se pondrá en contacto contigo. La cita aún no está reservada.' }); setDraft(await provider.extract(next)); }
    setMessages(next);
  }
  async function send(e: FormEvent) { e.preventDefault(); await answerWith(answer, null); }
  /** Answers the availability question by picking a free slot; label is
   * what the visitor sees (and what stays in the transcript). */
  async function chooseSlot(iso: string, label: string) { await answerWith(label, iso); }
  async function confirm(e: FormEvent): Promise<boolean> {
    e.preventDefault(); setError('');
    const parsed = intakeSchema.safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return false; }
    setBusy(true); id.current ??= crypto.randomUUID();
    // onSubmit may throw (the public form does, on a rejected RPC call) as
    // well as resolve to false; either way the id/draft must survive so a
    // retry reuses the same idempotency key instead of losing the answers.
    try { return await onSubmit({ id: id.current, data: parsed.data, messages, ...(slot ? { slot } : {}) }); }
    catch (err) {
      setError(err instanceof Error ? err.message : 'No se ha podido enviar. Inténtalo de nuevo.');
      // The chosen slot can't be booked (someone else took it, or a
      // booking limit applies; nothing was written): drop it and keep every
      // other answer, so the visitor picks another hour or writes their
      // availability.
      if (err instanceof Error && (err.message === SLOT_TAKEN_MESSAGE || err.message === BOOKING_UNAVAILABLE_MESSAGE)) { setSlot(null); setDraft(d => d && { ...d, availability: '' }); onSlotTaken?.(); }
      return false;
    }
    finally { setBusy(false); }
  }
  function reset() { setMessages([{ role: 'assistant', content: questions[0].prompt }]); setDraft(null); setAnswer(''); setError(''); setSlot(null); id.current = null; }
  return { messages, answer, setAnswer, draft, setDraft, error, setError, busy, count, chat, send, chooseSlot, slot, setSlot, confirm, reset };
}
