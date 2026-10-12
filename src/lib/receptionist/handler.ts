import { AgentError, LIMITS, emptyUsage, parseHistory, runAgentTurn, type ReceptionistProvider, type ToolExecutor } from './agent';
import type { PublicAvailability } from '../reception/public-demo';
import type { RateLimiter } from './config';

// Conversational receptionist endpoint (Supabase mode), independent of
// Next so it can be tested. The provider only talks and asks for the two
// read-only tools; they run here through `rpc`, which the route binds to the
// ANONYMOUS client -- exactly what the visitor's own browser could call
// (public_workshop_info, public_availability) -- and always with this
// conversation's slug, so a provider can't reach another workshop or any
// write. Any failure answers { fallback: true } and the page switches to the
// guided form.

type Rpc = (fn: 'public_workshop_info' | 'public_availability', args: { p_slug: string }) => Promise<{ data: unknown; error: unknown }>;
export interface HandlerDeps { provider: ReceptionistProvider | null; rpc: Rpc; limiter: RateLimiter; now?: () => Date; log?: (message: string) => void; usageLog?: (message: string) => void }
export interface HandlerResponse { status: number; body: Record<string, unknown> }

export function clientKey(headers: Headers) {
  const forwarded = headers.get('x-forwarded-for')?.split(',').at(-1)?.trim();
  return headers.get('x-real-ip')?.trim() || forwarded || 'desconocido';
}

/** rawBody: the request text, size-checked before it is parsed. */
export async function handleReceptionist(rawBody: string, key: string, deps: HandlerDeps): Promise<HandlerResponse> {
  if (!deps.provider) return { status: 200, body: { fallback: true } };
  if (rawBody.length > LIMITS.bodyBytes) return { status: 413, body: { error: 'too_large' } };
  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return { status: 400, body: { error: 'invalid' } }; }
  const input = (body ?? {}) as { slug?: unknown; history?: unknown };
  const slug = typeof input.slug === 'string' ? input.slug.trim().toLowerCase() : '';
  const history = parseHistory(input.history);
  if (!slug || slug.length > 100 || !history) return { status: 400, body: { error: 'invalid' } };
  if (!deps.limiter.allow(key)) return { status: 429, body: { fallback: true } };
  const usage = emptyUsage();
  let outcome = 'fallback';
  try {
    const { data: workshop, error } = await deps.rpc('public_workshop_info', { p_slug: slug });
    if (error || !workshop) return { status: 404, body: { error: 'not_found' } };
    const executor: ToolExecutor = {
      async availability() {
        const { data, error: availabilityError } = await deps.rpc('public_availability', { p_slug: slug });
        return availabilityError || !data ? null : data as PublicAvailability;
      },
    };
    const info = workshop as { name: string; timezone: string };
    const result = await runAgentTurn({ provider: deps.provider, executor, history, usage, context: { workshopName: info.name, timezone: info.timezone, now: deps.now?.() ?? new Date() } });
    outcome = 'ok';
    return { status: 200, body: { history: result.history, reply: result.reply, proposal: result.proposal ?? null } };
  } catch (error) {
    // Provider down, budget used up, a loop that never ends: never an
    // internal detail to the visitor, just the guided form.
    if (!(error instanceof AgentError)) (deps.log ?? console.error)('[receptionist] ' + (error instanceof Error ? error.name + ': ' + error.message : 'error'));
    return { status: 200, body: { fallback: true } };
  } finally {
    // Only for a real model: calls and tokens of this turn, also when it
    // failed halfway, to measure the cost per conversation (worst cases
    // included). Never the conversation's content.
    if (deps.provider.isRealAI && usage.calls + usage.failed_calls > 0) (deps.usageLog ?? console.info)(`[receptionist] uso: resultado=${outcome} llamadas=${usage.calls} fallidas=${usage.failed_calls} tokens_entrada=${usage.input_tokens} tokens_salida=${usage.output_tokens} mensajes_cliente=${history.filter(m => m.role === 'user').length}`);
  }
}
