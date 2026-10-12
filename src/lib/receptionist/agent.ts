import { z } from 'zod';
import { intakeSchema, localDateParts, localMinutesOfDay, type Intake, type Message } from '../domain';
import type { PublicAvailability } from '../reception/public-demo';

// Conversational receptionist: a provider (a simulated rule-based one, or a
// real language model) talks to the customer and may call two tools, both
// executed by this code, never by the provider:
// - check_availability: read-only, the workshop's free slots through the
//   same public_availability function the form uses;
// - propose_request: validates a complete request (and that its slot is
//   still listed) and hands it to the page as a proposal. It writes nothing.
// There is deliberately no tool that writes: the request is only stored when
// the customer reviews the proposal, ticks the legal notice and presses the
// button, through public_intake, which re-checks the slot under the
// workshop lock. A provider that invents a slot, a phone or a tool gets an
// error back, and the worst it can do is propose something the customer
// sees before sending.

export type ToolName = 'check_availability' | 'propose_request';
export const toolNames: readonly ToolName[] = ['check_availability', 'propose_request'];
export interface ToolCall { id: string; name: string; input: unknown }
export type AgentMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; name: string; content: string };
/** usage: tokens the provider reports for this call (real models only). */
export interface ProviderTurn { text: string; tool_calls: ToolCall[]; usage?: { input_tokens: number; output_tokens: number } }
/** failed_calls: provider calls that threw (their tokens, if any, are unknown). */
export interface TurnUsage { calls: number; failed_calls: number; input_tokens: number; output_tokens: number }
export const emptyUsage = (): TurnUsage => ({ calls: 0, failed_calls: 0, input_tokens: 0, output_tokens: 0 });
export interface AgentContext { workshopName: string; timezone: string; now: Date }
export interface ReceptionistProvider {
  readonly id: 'simulated' | 'anthropic';
  /** false for the simulated provider: the UI must never call it AI. */
  readonly isRealAI: boolean;
  respond(history: AgentMessage[], context: AgentContext): Promise<ProviderTurn>;
}
/** The only data access a provider's tools get: the public, read-only
 * availability of the one workshop this conversation belongs to. */
export interface ToolExecutor { availability(): Promise<PublicAvailability | null> }
/** timezone: the workshop's, from the same availability the slot came
 * from, so the review shows the hour exactly as it will be booked. */
export interface Proposal { data: Intake; slot?: string; timezone?: string }
export interface AgentResult { history: AgentMessage[]; reply: string; proposal?: Proposal; usage: TurnUsage }

export const LIMITS = { userTurns: 20, historyEntries: 80, userChars: 2000, assistantChars: 4000, toolChars: 20000, toolInputChars: 2000, historyChars: 64000, bodyBytes: 100000, steps: 4, slotsShown: 8 } as const;
export class AgentError extends Error {}

export const slotLabel = (iso: string, timeZone: string) => new Intl.DateTimeFormat('es-ES', { timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

const availabilityInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  part_of_day: z.enum(['mañana', 'tarde']).optional(),
}).strict();
const proposalInput = z.object({
  name: z.string(), phone: z.string(), brand: z.string(), model: z.string(),
  plate: z.string().optional(), reason: z.string(), notes: z.string().optional(),
  availability: z.string().optional(), slot_starts_at: z.string().optional(),
}).strict();

const ok = (value: unknown) => JSON.stringify(value);

async function checkAvailability(input: unknown, executor: ToolExecutor): Promise<string> {
  const parsed = availabilityInput.safeParse(input ?? {});
  if (!parsed.success) return ok({ error: 'invalid_input' });
  const availability = await executor.availability();
  if (!availability || availability.slots.length === 0) return ok({ slots: [], note: 'El taller no ofrece horas para reservar por su cuenta: pide al cliente qué días u horas le vienen bien.' });
  const { timezone } = availability;
  const matches = availability.slots.filter(iso => {
    const date = new Date(iso);
    if (parsed.data.date && localDateParts(date, timezone).date !== parsed.data.date) return false;
    if (parsed.data.part_of_day === 'mañana' && localMinutesOfDay(date, timezone) >= 14 * 60) return false;
    if (parsed.data.part_of_day === 'tarde' && localMinutesOfDay(date, timezone) < 14 * 60) return false;
    return true;
  });
  return ok({ duration_minutes: availability.duration_minutes, total: matches.length, slots: matches.slice(0, LIMITS.slotsShown).map(starts_at => ({ starts_at, label: slotLabel(starts_at, timezone) })) });
}

async function proposeRequest(input: unknown, executor: ToolExecutor, context: AgentContext): Promise<{ content: string; proposal?: Proposal }> {
  const parsed = proposalInput.safeParse(input);
  if (!parsed.success) return { content: ok({ error: 'invalid_input' }) };
  const { slot_starts_at, ...fields } = parsed.data;
  let slot: string | undefined;
  let availabilityText = fields.availability ?? '';
  let timezone: string | undefined;
  if (slot_starts_at) {
    // Only a slot the workshop lists right now: the provider can't invent
    // one (public_intake would refuse it anyway, but the customer must
    // never be shown an hour that was never on offer).
    const availability = await executor.availability();
    slot = availability?.slots.find(s => new Date(s).getTime() === new Date(slot_starts_at).getTime());
    if (!slot || !availability) return { content: ok({ error: 'slot_not_available', message: 'Esa hora no está libre. Vuelve a consultar la disponibilidad.' }) };
    timezone = availability.timezone;
    availabilityText = 'Reservar el ' + slotLabel(slot, timezone);
  }
  const data = intakeSchema.safeParse({ ...fields, plate: fields.plate ?? '', notes: fields.notes ?? '', availability: availabilityText });
  if (!data.success) return { content: ok({ error: 'invalid_fields', fields: [...new Set(data.error.issues.map(i => String(i.path[0])))], message: data.error.issues[0].message }) };
  return { content: ok({ ok: true, note: 'Propuesta mostrada al cliente para que la revise y la envíe. Todavía no se ha guardado ni reservado nada.', workshop: context.workshopName }), proposal: { data: data.data, ...(slot ? { slot, timezone } : {}) } };
}

/** One customer message in, the provider's reply out: runs the provider and
 * the tools it asks for, up to LIMITS.steps model calls. */
/** usage: optional accumulator owned by the caller, so the tokens already
 * spent are still known when the turn ends in an error. */
export async function runAgentTurn({ provider, executor, history, context, usage = emptyUsage() }: { provider: ReceptionistProvider; executor: ToolExecutor; history: AgentMessage[]; context: AgentContext; usage?: TurnUsage }): Promise<AgentResult> {
  const next = [...history];
  let proposal: Proposal | undefined;
  for (let step = 0; step < LIMITS.steps; step++) {
    let turn: ProviderTurn;
    try { turn = await provider.respond(next, context); } catch (error) { usage.failed_calls++; throw error; }
    usage.calls++; usage.input_tokens += turn.usage?.input_tokens ?? 0; usage.output_tokens += turn.usage?.output_tokens ?? 0;
    const calls = turn.tool_calls.slice(0, 3);
    next.push({ role: 'assistant', content: turn.text.slice(0, LIMITS.assistantChars), ...(calls.length ? { tool_calls: calls } : {}) });
    if (calls.length === 0) {
      if (!turn.text.trim()) throw new AgentError('El proveedor no ha respondido.');
      return { history: next, reply: turn.text, usage, ...(proposal ? { proposal } : {}) };
    }
    for (const call of calls) {
      let content: string;
      if (call.name === 'check_availability') content = await checkAvailability(call.input, executor);
      else if (call.name === 'propose_request') { const result = await proposeRequest(call.input, executor, context); content = result.content; proposal = result.proposal ?? proposal; }
      else content = ok({ error: 'unknown_tool' });
      next.push({ role: 'tool', tool_call_id: call.id, name: call.name, content });
    }
  }
  throw new AgentError('El proveedor no ha terminado su respuesta.');
}

// Tool inputs are bounded too: they are sent back to the model on every turn.
const boundedInput = z.unknown().refine(value => { try { return (JSON.stringify(value ?? {}) ?? '').length <= LIMITS.toolInputChars; } catch { return false; } });
const toolCallSchema = z.object({ id: z.string().min(1).max(100), name: z.string().max(50), input: boundedInput });
const historySchema = z.array(z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), content: z.string().trim().min(1).max(LIMITS.userChars) }),
  z.object({ role: z.literal('assistant'), content: z.string().max(LIMITS.assistantChars), tool_calls: z.array(toolCallSchema).max(3).optional() }),
  z.object({ role: z.literal('tool'), tool_call_id: z.string().min(1).max(100), name: z.string().max(50), content: z.string().max(LIMITS.toolChars) }),
])).min(1).max(LIMITS.historyEntries);
/** History sent by the browser: shape and size checked, nothing trusted. A
 * forged tool result can only mislead this same visitor's own proposal,
 * which is shown to them and re-checked by public_intake on sending. */
export function parseHistory(value: unknown): AgentMessage[] | null {
  const parsed = historySchema.safeParse(value);
  if (!parsed.success) return null;
  const history = parsed.data as AgentMessage[];
  if (JSON.stringify(history).length > LIMITS.historyChars) return null;
  if (history.at(-1)?.role !== 'user' || history.filter(m => m.role === 'user').length > LIMITS.userTurns) return null;
  return history;
}
/** What public_intake stores as the conversation: only what the customer
 * saw (user and assistant text), at most its 30 latest messages. */
export function visibleTranscript(history: AgentMessage[]): Message[] {
  return history.filter(m => (m.role === 'user' || m.role === 'assistant') && m.content.trim()).map(m => ({ role: m.role as Message['role'], content: m.content.trim().slice(0, 2000) })).slice(-30);
}
