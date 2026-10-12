import { AnthropicProvider } from './anthropic';
import type { ReceptionistProvider } from './agent';
import { SimulatedProvider } from './simulated';

// Server-side switch for the conversational receptionist. Off unless
// configured: with RECEPTIONIST_PROVIDER unset (production today) the public
// page keeps the guided form exactly as before.
//   RECEPTIONIST_PROVIDER=simulated   rule-based, free, for DEMO/TEST only
//   RECEPTIONIST_PROVIDER=anthropic   a real model; needs ALL of:
//     RECEPTIONIST_ANTHROPIC_API_KEY  the provider key (server-only)
//     RECEPTIONIST_SPEND_LIMIT_SET    "true": the operator confirms a spend
//                                     limit is set in the provider's console,
//                                     the only ceiling shared by every server
//                                     instance (the daily cap below is per
//                                     instance and resets on restart)
//     RECEPTIONIST_DAILY_CALL_LIMIT   > 0, model calls per day and server
//                                     instance (0 or unset: no calls)
//   optional: RECEPTIONIST_MODEL (default claude-haiku-5-5),
//     RECEPTIONIST_MAX_OUTPUT_TOKENS (default 400, at most 1024),
//     RECEPTIONIST_TIMEOUT_MS (default 15000).
// Anything missing or invalid for "anthropic" turns it off (guided form),
// never into the simulated provider: a simulation must never stand in for
// what the workshop configured as real AI.

export type ReceptionistMode = 'off' | 'simulated' | 'anthropic';
export interface ReceptionistConfig { mode: ReceptionistMode; model?: string; maxOutputTokens?: number; timeoutMs?: number; dailyCallLimit?: number; apiKey?: string }
type Env = Record<string, string | undefined>;
const int = (value: string | undefined, fallback: number) => { const n = Number(value); return Number.isInteger(n) && n >= 0 ? n : fallback; };

export function readReceptionistConfig(env: Env = process.env): ReceptionistConfig {
  const mode = (env.RECEPTIONIST_PROVIDER ?? '').trim().toLowerCase();
  if (mode === 'simulated') return { mode: 'simulated' };
  if (mode !== 'anthropic') return { mode: 'off' };
  const apiKey = env.RECEPTIONIST_ANTHROPIC_API_KEY?.trim();
  const dailyCallLimit = int(env.RECEPTIONIST_DAILY_CALL_LIMIT, 0);
  if (!apiKey || dailyCallLimit <= 0 || env.RECEPTIONIST_SPEND_LIMIT_SET?.trim().toLowerCase() !== 'true') return { mode: 'off' };
  return { mode: 'anthropic', apiKey, dailyCallLimit, model: env.RECEPTIONIST_MODEL?.trim() || 'claude-haiku-5-5', maxOutputTokens: Math.min(int(env.RECEPTIONIST_MAX_OUTPUT_TOKENS, 400) || 400, 1024), timeoutMs: Math.min(int(env.RECEPTIONIST_TIMEOUT_MS, 15000) || 15000, 30000) };
}

/** What the browser may know: whether there is an assistant and whether it
 * is real AI (for honest labelling). Never the key, model or limits. */
export function publicReceptionistInfo(config: ReceptionistConfig): { mode: 'simulated' | 'anthropic' } | null {
  return config.mode === 'off' ? null : { mode: config.mode };
}

/** Daily cap on model calls. In memory, per server instance: a hard stop
 * against runaway loops and bursts, not an exact budget (each serverless
 * instance counts on its own, and a restart resets it). The real ceiling
 * must also be set as a spend limit in the provider's console. */
export class CallBudget {
  private day = '';
  private used = 0;
  constructor(private readonly limit: number, private readonly clock: () => Date = () => new Date()) {}
  take(): boolean {
    const day = this.clock().toISOString().slice(0, 10);
    if (day !== this.day) { this.day = day; this.used = 0; }
    if (this.used >= this.limit) return false;
    this.used++;
    return true;
  }
}
export class BudgetExceeded extends Error {}

/** Wraps a provider so every model call spends one unit of the budget. */
export function withBudget(provider: ReceptionistProvider, budget: CallBudget): ReceptionistProvider {
  return { id: provider.id, isRealAI: provider.isRealAI, respond: async (history, context) => { if (!budget.take()) throw new BudgetExceeded('Límite diario de la recepcionista alcanzado.'); return provider.respond(history, context); } };
}

let sharedBudget: { limit: number; budget: CallBudget } | null = null;
export function providerFor(config: ReceptionistConfig, fetcher: typeof fetch = fetch): ReceptionistProvider | null {
  if (config.mode === 'simulated') return new SimulatedProvider();
  if (config.mode !== 'anthropic' || !config.apiKey || !config.dailyCallLimit) return null;
  if (!sharedBudget || sharedBudget.limit !== config.dailyCallLimit) sharedBudget = { limit: config.dailyCallLimit, budget: new CallBudget(config.dailyCallLimit) };
  return withBudget(new AnthropicProvider({ apiKey: config.apiKey, model: config.model!, maxOutputTokens: config.maxOutputTokens!, timeoutMs: config.timeoutMs! }, fetcher), sharedBudget.budget);
}

/** Best-effort per-address limit for the public endpoint (in memory, per
 * instance), on top of the per-conversation turn cap. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly max: number, private readonly windowMs: number, private readonly clock: () => number = Date.now) {}
  allow(key: string): boolean {
    const now = this.clock();
    const recent = (this.hits.get(key) ?? []).filter(t => t > now - this.windowMs);
    if (recent.length >= this.max) { this.hits.set(key, recent); return false; }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v.every(t => t <= now - this.windowMs)) this.hits.delete(k);
    return true;
  }
}
