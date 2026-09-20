import type { Intake, Message } from '../domain';
export const questions: { field: keyof Intake; prompt: string; optional?: boolean }[] = [
  { field: 'name', prompt: '¡Hola! Soy el recepcionista digital del taller. ¿Cómo te llamas?' },
  { field: 'phone', prompt: '¿En qué teléfono podemos contactar contigo?' },
  { field: 'brand', prompt: '¿De qué marca es tu vehículo?' },
  { field: 'model', prompt: '¿Y qué modelo es?' },
  { field: 'plate', prompt: '¿Cuál es la matrícula? Si no la tienes, escribe «omitir».', optional: true },
  { field: 'reason', prompt: 'Cuéntame, ¿en qué podemos ayudarte con tu vehículo?' },
  { field: 'availability', prompt: '¿Qué días u horarios te vienen bien para traerlo?' },
  { field: 'notes', prompt: '¿Algo más que debamos saber? Puedes escribir «omitir».', optional: true },
];
export interface ReceptionProvider { readonly name: string; extract(messages: Message[]): Promise<Partial<Intake>> }
/** Deterministic guided intake, not an LLM. A real provider must run server-side. */
export class MockReceptionProvider implements ReceptionProvider {
  readonly name = 'Recepción simulada';
  async extract(messages: Message[]): Promise<Partial<Intake>> {
    const answers = messages.filter(m => m.role === 'user');
    return Object.fromEntries(questions.map((q, index) => [q.field, q.optional && /^(omitir|no|ninguna)$/i.test(answers[index]?.content.trim() ?? '') ? '' : answers[index]?.content.trim() ?? '']));
  }
}
