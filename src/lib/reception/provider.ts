import type { Intake, Message } from '../domain';
export const UNKNOWN_MODEL = 'Modelo no indicado';
type Question = { field: keyof Intake; prompt: string; optional?: boolean };
export const questions: Question[] = [
  { field: 'name', prompt: '¡Hola! Soy el recepcionista digital del taller. ¿Cómo te llamas?' },
  { field: 'phone', prompt: '¿En qué teléfono podemos contactar contigo?' },
  { field: 'brand', prompt: '¿De qué marca es tu vehículo?' },
  { field: 'model', prompt: '¿Y qué modelo es? Si no lo sabes, escribe «no lo sé».' },
  { field: 'plate', prompt: '¿Cuál es la matrícula? Si no la tienes, escribe «omitir».', optional: true },
  { field: 'reason', prompt: 'Cuéntame, ¿en qué podemos ayudarte con tu vehículo?' },
  { field: 'availability', prompt: '¿Qué días u horarios te vienen bien para traerlo?' },
  { field: 'notes', prompt: '¿Algo más que debamos saber? Puedes escribir «omitir».', optional: true },
];
/** The value a chat answer is stored as: optional questions accept a skip
 * word (empty), and the model accepts "no lo sé" (a fixed, non-empty value,
 * since the model is required everywhere down to the database). */
export function answerValue(q: Question, raw: string): string {
  const value = raw.trim();
  if (q.optional && /^(omitir|no|ninguna)$/i.test(value)) return '';
  // NFC so a decomposed "é" (e + combining accent, as some keyboards and
  // pasted text send it) still matches.
  if (q.field === 'model' && /^(no\s+lo\s+s[eé]|no\s+s[eé]|ns|desconocido)\.?$/i.test(value.normalize('NFC'))) return UNKNOWN_MODEL;
  return value;
}
export interface ReceptionProvider { readonly name: string; extract(messages: Message[]): Promise<Partial<Intake>> }
/** Deterministic guided intake, not an LLM. A real provider must run server-side. */
export class MockReceptionProvider implements ReceptionProvider {
  readonly name = 'Recepción simulada';
  async extract(messages: Message[]): Promise<Partial<Intake>> {
    const answers = messages.filter(m => m.role === 'user');
    return Object.fromEntries(questions.map((q, index) => [q.field, answerValue(q, answers[index]?.content ?? '')]));
  }
}
