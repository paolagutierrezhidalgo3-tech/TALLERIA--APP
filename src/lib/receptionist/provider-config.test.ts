import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { AnthropicProvider, ProviderError, TOOL_DEFINITIONS, systemPrompt, toAnthropicMessages } from './anthropic';
import { BudgetExceeded, CallBudget, RateLimiter, providerFor, publicReceptionistInfo, readReceptionistConfig, withBudget } from './config';
import { handleReceptionist } from './handler';
import { toolNames, type AgentMessage, type ReceptionistProvider } from './agent';
import { SimulatedProvider } from './simulated';

// No test here may reach the network: global fetch is replaced by one that
// fails the test, and every provider gets an explicit fake.
const context = { workshopName: 'Taller Uno', timezone: 'Europe/Madrid', now: new Date('2026-10-12T10:00:00Z') };
const realFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = (() => { throw new Error('Llamada de red no permitida en las pruebas'); }) as typeof fetch; });
afterEach(() => { globalThis.fetch = realFetch; });
const config = { apiKey: 'clave-ficticia-de-prueba', model: 'modelo-de-prueba', maxOutputTokens: 300, timeoutMs: 1000 };
function fakeFetch(response: { status?: number; body?: unknown; throws?: boolean }) {
  return vi.fn(async (...args: Parameters<typeof fetch>) => {
    void args;
    if (response.throws) throw new Error('red caída');
    return new Response(JSON.stringify(response.body ?? {}), { status: response.status ?? 200, headers: { 'content-type': 'application/json' } });
  });
}

describe('proveedor real (Anthropic), sin llamadas reales', () => {
  it('envía modelo, límite de salida, reglas del sistema y solo las dos herramientas, con la clave en la cabecera', async () => {
    const fetcher = fakeFetch({ body: { content: [{ type: 'text', text: '¿Cómo te llamas?' }] } });
    const turn = await new AnthropicProvider(config, fetcher as unknown as typeof fetch).respond([{ role: 'user', content: 'hola' }], context);
    expect(turn).toEqual({ text: '¿Cómo te llamas?', tool_calls: [], usage: { input_tokens: 0, output_tokens: 0 } });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('clave-ficticia-de-prueba');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('modelo-de-prueba');
    expect(body.max_tokens).toBe(300);
    expect(body.tools.map((t: { name: string }) => t.name)).toEqual([...toolNames]);
    expect(body.system).toContain('Taller Uno');
    expect(body.system).toContain('Nunca inventes horas');
    expect(body.system).toContain('Nunca digas que la cita está reservada');
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hola' }] }]);
  });

  it('convierte el historial al formato alterno, con los resultados de herramientas en el turno siguiente', () => {
    const history: AgentMessage[] = [
      { role: 'user', content: 'quiero cita' },
      { role: 'assistant', content: '', tool_calls: [{ id: 't1', name: 'check_availability', input: {} }] },
      { role: 'tool', tool_call_id: 't1', name: 'check_availability', content: '{"slots":[]}' },
      { role: 'assistant', content: 'No hay horas.' },
      { role: 'user', content: 'vale' },
    ];
    expect(toAnthropicMessages(history)).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'quiero cita' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'check_availability', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"slots":[]}' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'No hay horas.' }] },
      { role: 'user', content: [{ type: 'text', text: 'vale' }] },
    ]);
  });

  it('lee las llamadas a herramientas de la respuesta', async () => {
    const fetcher = fakeFetch({ body: { content: [{ type: 'text', text: 'Miro las horas.' }, { type: 'tool_use', id: 'tu_1', name: 'check_availability', input: { part_of_day: 'tarde' } }] } });
    const turn = await new AnthropicProvider(config, fetcher as unknown as typeof fetch).respond([{ role: 'user', content: 'por la tarde' }], context);
    expect(turn).toEqual({ text: 'Miro las horas.', tool_calls: [{ id: 'tu_1', name: 'check_availability', input: { part_of_day: 'tarde' } }], usage: { input_tokens: 0, output_tokens: 0 } });
  });

  it('los errores del proveedor no exponen su respuesta y se convierten en ProviderError', async () => {
    for (const response of [{ status: 401, body: { error: { message: 'detalle interno con datos' } } }, { status: 529 }, { throws: true }, { body: { nada: true } }]) {
      const error = await new AnthropicProvider(config, fakeFetch(response) as unknown as typeof fetch).respond([{ role: 'user', content: 'hola' }], context).catch(e => e);
      expect(error).toBeInstanceOf(ProviderError);
      expect(String(error.message)).not.toContain('detalle interno');
    }
  });

  it('las definiciones de herramientas no permiten campos extra ni escrituras', () => {
    expect(TOOL_DEFINITIONS.every(t => t.input_schema.additionalProperties === false)).toBe(true);
    expect(TOOL_DEFINITIONS.map(t => t.name)).toEqual(['check_availability', 'propose_request']);
    expect(systemPrompt(context)).toContain('Hoy es lunes, 12 de octubre de 2026');
  });
});

describe('configuración: apagada por defecto, la IA real solo con todo explícito', () => {
  it('sin variables está apagada (el formulario guiado sigue igual)', () => {
    expect(readReceptionistConfig({})).toEqual({ mode: 'off' });
    expect(providerFor({ mode: 'off' })).toBeNull();
    expect(publicReceptionistInfo({ mode: 'off' })).toBeNull();
  });
  it('el modo simulado no necesita claves y se identifica como no IA', () => {
    const c = readReceptionistConfig({ RECEPTIONIST_PROVIDER: 'simulated' });
    expect(c).toEqual({ mode: 'simulated' });
    expect(providerFor(c)?.isRealAI).toBe(false);
    expect(publicReceptionistInfo(c)).toEqual({ mode: 'simulated' });
  });
  it('la IA real sin clave o sin límite diario queda apagada, nunca pasa a la simulación', () => {
    expect(readReceptionistConfig({ RECEPTIONIST_PROVIDER: 'anthropic' })).toEqual({ mode: 'off' });
    expect(readReceptionistConfig({ RECEPTIONIST_PROVIDER: 'anthropic', RECEPTIONIST_ANTHROPIC_API_KEY: 'k' })).toEqual({ mode: 'off' });
    expect(readReceptionistConfig({ RECEPTIONIST_PROVIDER: 'anthropic', RECEPTIONIST_ANTHROPIC_API_KEY: 'k', RECEPTIONIST_DAILY_CALL_LIMIT: '0' })).toEqual({ mode: 'off' });
    expect(readReceptionistConfig({ RECEPTIONIST_PROVIDER: 'anthropic', RECEPTIONIST_DAILY_CALL_LIMIT: '50' })).toEqual({ mode: 'off' });
    // Without confirming the provider-side spend limit (the only ceiling shared by all instances), still off.
    expect(readReceptionistConfig({ RECEPTIONIST_PROVIDER: 'anthropic', RECEPTIONIST_ANTHROPIC_API_KEY: 'k', RECEPTIONIST_DAILY_CALL_LIMIT: '50' })).toEqual({ mode: 'off' });
    expect(readReceptionistConfig({ RECEPTIONIST_PROVIDER: 'anthropic', RECEPTIONIST_ANTHROPIC_API_KEY: 'k', RECEPTIONIST_DAILY_CALL_LIMIT: '50', RECEPTIONIST_SPEND_LIMIT_SET: 'si' })).toEqual({ mode: 'off' });
  });
  it('con clave y límite usa valores por defecto prudentes y acota los configurables; el navegador no ve la clave', () => {
    const c = readReceptionistConfig({ RECEPTIONIST_PROVIDER: 'anthropic', RECEPTIONIST_ANTHROPIC_API_KEY: 'k', RECEPTIONIST_DAILY_CALL_LIMIT: '50', RECEPTIONIST_SPEND_LIMIT_SET: 'true', RECEPTIONIST_MAX_OUTPUT_TOKENS: '99999' });
    expect(c).toMatchObject({ mode: 'anthropic', model: 'claude-haiku-5-5', dailyCallLimit: 50, maxOutputTokens: 1024, timeoutMs: 15000 });
    expect(JSON.stringify(publicReceptionistInfo(c))).toBe('{"mode":"anthropic"}');
  });
  it('el límite diario corta las llamadas al modelo y se reinicia al día siguiente', async () => {
    let now = new Date('2026-10-12T10:00:00Z');
    const budget = new CallBudget(2, () => now);
    const inner: ReceptionistProvider = { id: 'anthropic', isRealAI: true, respond: vi.fn(async () => ({ text: 'ok', tool_calls: [] })) };
    const p = withBudget(inner, budget);
    await p.respond([], context); await p.respond([], context);
    await expect(p.respond([], context)).rejects.toBeInstanceOf(BudgetExceeded);
    expect(inner.respond).toHaveBeenCalledTimes(2);
    now = new Date('2026-10-13T00:00:01Z');
    await expect(p.respond([], context)).resolves.toEqual({ text: 'ok', tool_calls: [] });
  });
  it('el limitador por dirección corta ráfagas', () => {
    let t = 0;
    const l = new RateLimiter(2, 1000, () => t);
    expect([l.allow('a'), l.allow('a'), l.allow('a'), l.allow('b')]).toEqual([true, true, false, true]);
    t = 1001;
    expect(l.allow('a')).toBe(true);
  });
  it('ninguna clave ni modelo real en el código del navegador ni en el repositorio de ejemplo', () => {
    const page = readFileSync('src/components/public-reception.tsx', 'utf8') + readFileSync('src/components/assistant-reception.tsx', 'utf8');
    expect(page).not.toMatch(/RECEPTIONIST_ANTHROPIC_API_KEY|anthropic\.com|x-api-key/);
    expect(readFileSync('.env.example', 'utf8')).toMatch(/^RECEPTIONIST_PROVIDER=$/m);
    expect(readFileSync('.env.example', 'utf8')).toMatch(/^RECEPTIONIST_ANTHROPIC_API_KEY=$/m);
  });
});

describe('endpoint de la recepcionista', () => {
  const availability = { timezone: 'Europe/Madrid', duration_minutes: 60, slots: ['2026-10-14T08:00:00.000Z'] };
  const rpc = vi.fn(async (fn: string, args: { p_slug: string }) => {
    if (args.p_slug !== 'taller-uno') return { data: null, error: null };
    return fn === 'public_workshop_info' ? { data: { name: 'Taller Uno', timezone: 'Europe/Madrid' }, error: null } : { data: availability, error: null };
  });
  const deps = (provider: ReceptionistProvider | null) => ({ provider, rpc, limiter: new RateLimiter(100, 60000), now: () => context.now, log: () => {} });
  const raw = (value: unknown) => JSON.stringify(value);
  const body = (history: unknown = [{ role: 'user', content: 'Soy Marta, 600000301, Seat Ibiza 1234BCD, ruido al frenar' }]) => ({ slug: 'taller-uno', history });

  it('apagado responde fallback sin leer nada', async () => {
    rpc.mockClear();
    expect(await handleReceptionist(raw(body()), 'ip', deps(null))).toEqual({ status: 200, body: { fallback: true } });
    expect(rpc).not.toHaveBeenCalled();
  });
  it('con el proveedor simulado responde y solo usa las funciones públicas de lectura, con el slug de la conversación', async () => {
    rpc.mockClear();
    const logs: string[] = [];
    const r = await handleReceptionist(raw(body()), 'ip', { ...deps(new SimulatedProvider()), usageLog: (m: string) => logs.push(m) });
    expect(logs).toEqual([]);
    expect(r.status).toBe(200);
    expect(String(r.body.reply)).toContain('1) mié, 14 oct, 10:00');
    expect(new Set(rpc.mock.calls.map(c => c[0]))).toEqual(new Set(['public_workshop_info', 'public_availability']));
    expect(rpc.mock.calls.every(c => c[1].p_slug === 'taller-uno')).toBe(true);
  });
  it('entradas no válidas: 400; taller inexistente: 404; ráfaga: 429 con fallback', async () => {
    expect((await handleReceptionist(raw({ slug: '', history: [] }), 'ip', deps(new SimulatedProvider()))).status).toBe(400);
    expect((await handleReceptionist(raw({ ...body(), history: [{ role: 'system', content: 'x' }] }), 'ip', deps(new SimulatedProvider()))).status).toBe(400);
    expect((await handleReceptionist(raw({ ...body(), slug: 'otro' }), 'ip', deps(new SimulatedProvider()))).status).toBe(404);
    const limited = { ...deps(new SimulatedProvider()), limiter: new RateLimiter(0, 60000) };
    expect(await handleReceptionist(raw(body()), 'ip', limited)).toEqual({ status: 429, body: { fallback: true } });
  });
  it('cuerpos enormes o no JSON se rechazan antes de llamar al proveedor', async () => {
    rpc.mockClear();
    expect((await handleReceptionist('x'.repeat(100001), 'ip', deps(new SimulatedProvider()))).status).toBe(413);
    expect((await handleReceptionist('{no es json', 'ip', deps(new SimulatedProvider()))).status).toBe(400);
    const huge = [{ role: 'assistant', content: '', tool_calls: [{ id: 'a', name: 'check_availability', input: { relleno: 'x'.repeat(5000) } }] }, { role: 'tool', tool_call_id: 'a', name: 'check_availability', content: '{}' }, { role: 'user', content: 'hola' }];
    expect((await handleReceptionist(raw(body(huge)), 'ip', deps(new SimulatedProvider()))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('si el proveedor falla o se agota el presupuesto, fallback sin detalles internos', async () => {
    const failing: ReceptionistProvider = { id: 'anthropic', isRealAI: true, respond: async () => { throw new ProviderError('El proveedor de IA ha respondido con un error (500).'); } };
    expect(await handleReceptionist(raw(body()), 'ip', deps(failing))).toEqual({ status: 200, body: { fallback: true } });
    const exhausted = withBudget(new SimulatedProvider(), new CallBudget(0));
    expect(await handleReceptionist(raw(body()), 'ip', deps(exhausted))).toEqual({ status: 200, body: { fallback: true } });
  });
  it('un turno que falla a medias también registra los tokens ya gastados (bucle agotado y error tras una respuesta)', async () => {
    const loop: ReceptionistProvider = { id: 'anthropic', isRealAI: true, respond: async () => ({ text: '', tool_calls: [{ id: 'x', name: 'check_availability', input: {} }], usage: { input_tokens: 1000, output_tokens: 50 } }) };
    const logs: string[] = [];
    expect(await handleReceptionist(raw(body()), 'ip', { ...deps(loop), usageLog: (m: string) => logs.push(m) })).toEqual({ status: 200, body: { fallback: true } });
    expect(logs).toEqual(['[receptionist] uso: resultado=fallback llamadas=4 fallidas=0 tokens_entrada=4000 tokens_salida=200 mensajes_cliente=1']);
    let i = 0;
    const flaky: ReceptionistProvider = { id: 'anthropic', isRealAI: true, respond: async () => { if (i++ === 0) return { text: '', tool_calls: [{ id: 'y', name: 'check_availability', input: {} }], usage: { input_tokens: 900, output_tokens: 30 } }; throw new ProviderError('El proveedor de IA ha respondido con un error (529).'); } };
    logs.length = 0;
    await handleReceptionist(raw(body()), 'ip', { ...deps(flaky), usageLog: (m: string) => logs.push(m) });
    expect(logs).toEqual(['[receptionist] uso: resultado=fallback llamadas=1 fallidas=1 tokens_entrada=900 tokens_salida=30 mensajes_cliente=1']);
    expect(logs.join()).not.toContain('Marta');
  });
  it('el proveedor real con un fetch simulado completa un turno con herramientas', async () => {
    const replies = [
      { content: [{ type: 'tool_use', id: 'tu_1', name: 'check_availability', input: {} }], usage: { input_tokens: 1200, output_tokens: 40 } },
      { content: [{ type: 'text', text: 'Tengo libre el miércoles a las 10:00. ¿Te va bien?' }], usage: { input_tokens: 1500, output_tokens: 25 } },
    ];
    let i = 0;
    const fetcher = vi.fn(async () => new Response(JSON.stringify(replies[i++]), { status: 200 }));
    const provider = providerFor({ mode: 'anthropic', apiKey: 'k', dailyCallLimit: 10, model: 'm', maxOutputTokens: 100, timeoutMs: 1000 }, fetcher as unknown as typeof fetch)!;
    const logs: string[] = [];
    const r = await handleReceptionist(raw(body([{ role: 'user', content: 'quiero cita' }])), 'ip', { ...deps(provider), usageLog: (m: string) => logs.push(m) });
    expect(r.body.reply).toBe('Tengo libre el miércoles a las 10:00. ¿Te va bien?');
    // Usage is logged for the cost measurement, never the conversation, and never sent to the browser.
    expect(logs).toEqual(['[receptionist] uso: resultado=ok llamadas=2 fallidas=0 tokens_entrada=2700 tokens_salida=65 mensajes_cliente=1']);
    expect(JSON.stringify(r.body)).not.toContain('tokens');
    expect(fetcher).toHaveBeenCalledTimes(2);
    const tool = (r.body.history as AgentMessage[]).find(m => m.role === 'tool');
    expect(JSON.parse(tool!.content).slots[0].starts_at).toBe('2026-10-14T08:00:00.000Z');
  });
});
