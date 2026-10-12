import { phoneSchema, localDateParts } from '../domain';
import { UNKNOWN_MODEL } from '../reception/provider';
import type { AgentContext, AgentMessage, ProviderTurn, ReceptionistProvider } from './agent';

// Simulated receptionist for DEMO and TEST: fixed rules and regular
// expressions, NOT a language model. It follows the same contract a real
// model does (text plus calls to the same two tools), so the whole flow --
// tools, proposal, review, sending -- can be exercised end to end without
// any paid service. It understands simple Spanish phrasing ("soy Marta",
// "tengo un Seat Ibiza", "mi teléfono es...", "el jueves por la tarde")
// and otherwise asks one thing at a time, like the guided form.

const BRANDS = ['Alfa Romeo', 'Audi', 'BMW', 'Citroën', 'Cupra', 'Dacia', 'DS', 'Fiat', 'Ford', 'Honda', 'Hyundai', 'Jaguar', 'Jeep', 'Kia', 'Land Rover', 'Lexus', 'Mazda', 'Mercedes', 'MG', 'Mini', 'Mitsubishi', 'Nissan', 'Opel', 'Peugeot', 'Porsche', 'Renault', 'SEAT', 'Skoda', 'Smart', 'Subaru', 'Suzuki', 'Tesla', 'Toyota', 'Volkswagen', 'VW', 'Volvo'];
const PROBLEMS: [RegExp, string][] = [
  [/fuga|gotea|pierde (agua|aceite|l[ií]quido)/i, 'fugas'],
  [/fren/i, 'frenos'], [/aceite|revisi[oó]n|mantenimiento|itv|filtro/i, 'revisión o mantenimiento'],
  [/neum[aá]tic|rueda|pinchaz/i, 'ruedas o neumáticos'], [/bater[ií]a|no arranca|arranque|el[eé]ctric|luces?\b|testigo/i, 'arranque o sistema eléctrico'],
  [/aire acondicionado|climatizador|no enfr[ií]a|calefacci[oó]n/i, 'climatización'], [/embrague|cambio de marchas|caja de cambios/i, 'embrague o cambio'],
  [/motor|humo|pierde potencia|tirones|calienta|temperatura/i, 'motor'], [/ruido|vibra|golpe|chirr/i, 'ruidos o vibraciones'],
  [/carrocer[ií]a|chapa|abolladura|ara[nñ]azo|parachoques/i, 'carrocería'],
];
const STOP = new Set(['de', 'del', 'que', 'y', 'con', 'en', 'el', 'la', 'un', 'una', 'mi', 'es', 'del', 'año', 'color']);
const WEEKDAYS: Record<string, number> = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 7 };
const SKIP = /^(omitir|no|ninguna|no tengo|no la s[eé]|paso)\.?$/i;
const stripAccents = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '');
const fold = (s: string) => stripAccents(s).toLowerCase();
const capitalize = (s: string) => s.trim().split(/\s+/).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');

type Step = 'name' | 'phone' | 'brand' | 'model' | 'plate' | 'reason' | 'pick' | 'availability_text' | 'check' | 'propose' | 'done';
interface Offered { starts_at: string; label: string }
interface State {
  name?: string; phone?: string; brand?: string; model?: string; plate?: string; reason?: string; problem?: string;
  slot?: string; slotLabel?: string; availabilityText?: string; wantsText: boolean;
  preference: { date?: string; part_of_day?: 'mañana' | 'tarde' }; preferenceChanged: boolean;
  offered: Offered[] | null; noSlots: boolean; proposed: boolean; error?: string;
}

function preferenceFrom(text: string, now: Date, timeZone: string): State['preference'] | null {
  const t = fold(text);
  const pref: State['preference'] = {};
  if (/por la manana|mananas|a primera hora/.test(t)) pref.part_of_day = 'mañana';
  if (/por la tarde|tardes|despues de comer/.test(t)) pref.part_of_day = 'tarde';
  const today = localDateParts(now, timeZone);
  const addDays = (n: number) => { const [y, m, d] = today.date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  if (/\bpasado manana\b/.test(t)) pref.date = addDays(2);
  else if (/(^|[^a-z])manana\b/.test(t.replace(/por la manana|mananas/g, ''))) pref.date = addDays(1);
  else if (/\bhoy\b/.test(t)) pref.date = addDays(0);
  for (const [day, iso] of Object.entries(WEEKDAYS)) if (new RegExp('\\b' + day + '\\b').test(t)) pref.date = addDays(((iso - today.day_of_week + 7) % 7) || 7);
  return pref.date || pref.part_of_day ? pref : null;
}

function findVehicle(text: string): { brand?: string; model?: string } {
  for (const brand of BRANDS) {
    const match = new RegExp('(^|[^\\p{L}])' + fold(brand).replace(/ /g, '\\s+') + '(?![\\p{L}])\\s*([\\p{L}\\d][\\p{L}\\d-]*)?', 'u').exec(fold(text));
    if (!match) continue;
    const original = stripAccents(text);
    // "Peugeot 308" is a model; "Seat 1234BCD" is a plate, not a model.
    const model = match[2] && !STOP.has(match[2]) && !/^\d{4}/.test(match[2]) ? original.substr(match.index + match[0].length - match[2].length, match[2].length) : undefined;
    return { brand: brand === 'VW' ? 'Volkswagen' : brand, ...(model ? { model: capitalize(model) } : {}) };
  }
  return {};
}

function problemOf(text: string) {
  const found = PROBLEMS.find(([re]) => re.test(text));
  if (!found) return null;
  // The clauses that mention the problem, not the whole message (which may
  // also carry the phone or the plate).
  const mentions = (c: string) => PROBLEMS.some(([re]) => re.test(c));
  const clauses = text.split(/[.;,\n]/).map(c => c.trim()).filter(mentions).map(c => {
    // "tengo un Seat Ibiza y chirrían los frenos" -> "chirrían los frenos",
    // but "cambio de aceite y filtros" stays whole.
    const [head, ...tail] = c.split(/\s+y\s+/);
    return tail.length && !mentions(head) ? tail.join(' y ') : c;
  });
  const reason = (clauses.join('. ') || text).trim();
  return { reason: reason[0].toUpperCase() + reason.slice(1), label: found[1] };
}

function readUser(state: State, text: string, asked: Step, context: AgentContext) {
  const value = text.trim();
  // Seven digits or more, so a 4-digit plate number is never read as one.
  const phone = /(\+?\d[\d\s.-]{5,16}\d)/.exec(value.replace(/\b\d{4}\s?[BCDFGHJKLMNPRSTVWXYZ]{3}\b/gi, ''))?.[1];
  if (phone) { const parsed = phoneSchema.safeParse(phone); if (parsed.success) state.phone = parsed.data; else if (asked === 'phone') state.error = 'Ese teléfono no parece válido. ¿Puedes escribirlo de nuevo?'; }
  else if (asked === 'phone') state.error = 'No he encontrado un teléfono. Escríbelo con todos sus números, por favor.';
  const plate = /\b(\d{4}\s?[BCDFGHJKLMNPRSTVWXYZ]{3})\b/i.exec(value)?.[1];
  if (plate) state.plate = plate.toUpperCase().replace(/\s/g, '');
  const name = /(?:[Mm]e llamo|[Mm]i nombre es|[Ss]oy)\s+([\p{Lu}][\p{L}]+(?:\s+[\p{Lu}][\p{L}]+)?)/u.exec(value)?.[1];
  if (name) state.name = name;
  const vehicle = findVehicle(value);
  if (vehicle.brand) { state.brand = vehicle.brand; if (vehicle.model) state.model = vehicle.model; }
  const problem = problemOf(value);
  if (problem && !state.reason) { state.reason = problem.reason; state.problem = problem.label; }
  const preference = preferenceFrom(value, context.now, context.timezone);
  // Direct answers to the question just asked, like the guided form.
  if (asked === 'name' && !state.name && !/\d/.test(value) && value.split(/\s+/).length <= 5 && value.length >= 2) { const bare = value.replace(/^(hola|buenas( tardes| d[ií]as)?)[,!.\s]*/i, '').trim(); if (bare.length >= 2) state.name = capitalize(bare); }
  if (asked === 'brand' && !state.brand && value.length >= 1) { const [brand, ...rest] = value.split(/\s+/); state.brand = capitalize(brand); if (rest.length) state.model = capitalize(rest.join(' ')); }
  if (asked === 'model' && !state.model && !preference && !phone) state.model = /^(no\s+lo\s+s[eé]|no\s+s[eé]|ni idea)\.?$/i.test(value) ? UNKNOWN_MODEL : capitalize(value);
  if (asked === 'plate' && state.plate === undefined) state.plate = SKIP.test(value) ? '' : value.toUpperCase().replace(/\s/g, '').slice(0, 20);
  if (asked === 'reason' && !state.reason) { if (value.length >= 5) { state.reason = value; state.problem = problem?.label; } else state.error = 'Cuéntame un poco más sobre lo que le pasa al vehículo.'; }
  if (asked === 'availability_text') { if (value.length >= 2) state.availabilityText = value; }
  if (asked === 'pick' || asked === 'done') {
    const offered = state.offered ?? [];
    const number = /^\s*(?:la\s+)?(\d{1,2})\s*$/.exec(value)?.[1];
    const time = /(\d{1,2})(?::(\d{2}))?\s*(?:h|horas)?\b/.exec(value);
    // A new day or part of day always wins over picking from the previous
    // offer ("mejor el jueves a las 11" must never pick Wednesday at 11),
    // and it replaces both the chosen hour and any written availability: the
    // new options are looked up first.
    const changing = preference || /\b(cambia|cambiar|otra hora|otro d[ií]a)\b/i.test(value);
    let chosen = !changing && number && Number(number) >= 1 && Number(number) <= offered.length ? offered[Number(number) - 1] : undefined;
    if (!changing && !chosen && time && !number) {
      const hhmm = `${time[1].padStart(2, '0')}:${time[2] ?? '00'}`;
      const candidates = offered.filter(o => o.label.endsWith(hhmm));
      chosen = candidates.length === 1 ? candidates[0] : undefined;
    }
    if (chosen) { state.slot = chosen.starts_at; state.slotLabel = chosen.label; state.wantsText = false; state.availabilityText = undefined; }
    else if (changing) { state.slot = undefined; state.slotLabel = undefined; state.availabilityText = undefined; state.wantsText = false; if (!preference) state.preferenceChanged = true; }
    else if (/^(ninguna|no|ninguno|ninguna me va bien|prefiero que me llam(e|en))\b/i.test(fold(value)) && asked === 'pick') state.wantsText = true;
    else if (/\b(cualquiera|lo antes posible|la primera)\b/i.test(fold(value))) { state.preference = {}; state.preferenceChanged = true; state.slot = undefined; state.availabilityText = undefined; }
  }
  if (preference) { state.preference = preference; state.preferenceChanged = true; state.wantsText = false; }
}

function nextStep(state: State): Step {
  if (!state.name) return 'name';
  if (!state.phone) return 'phone';
  if (!state.brand) return 'brand';
  if (!state.model) return 'model';
  if (state.plate === undefined) return 'plate';
  if (!state.reason) return 'reason';
  if (!state.slot && !state.availabilityText) {
    if (state.wantsText || state.noSlots) return 'availability_text';
    if (state.offered === null || state.preferenceChanged) return 'check';
    return 'pick';
  }
  return state.proposed ? 'done' : 'propose';
}

const QUESTIONS: Record<'name' | 'phone' | 'brand' | 'model' | 'plate' | 'reason' | 'availability_text', string> = {
  name: '¿Cómo te llamas?',
  phone: '¿En qué teléfono podemos contactar contigo?',
  brand: '¿Qué coche tienes? Dime la marca y el modelo.',
  model: '¿Y qué modelo es? Si no lo sabes, escribe «no lo sé».',
  plate: '¿Cuál es la matrícula? Si no la tienes a mano, escribe «omitir».',
  reason: '¿Qué le pasa al vehículo o qué necesitas que le hagamos?',
  availability_text: '¿Qué días u horas te vienen bien para traerlo? El taller te llamará para confirmarlo.',
};

export class SimulatedProvider implements ReceptionistProvider {
  readonly id = 'simulated' as const;
  readonly isRealAI = false;
  async respond(history: AgentMessage[], context: AgentContext): Promise<ProviderTurn> {
    const state: State = { wantsText: false, preference: {}, preferenceChanged: false, offered: null, noSlots: false, proposed: false };
    let asked: Step = 'name';
    let acknowledged = '';
    for (const message of history) {
      if (message.role === 'user') {
        const before = { ...state };
        state.error = undefined;
        readUser(state, message.content, asked, context);
        // The page drops the proposal on every new message, so whatever the
        // customer says next, a request that is still complete is proposed
        // again (and one that is not, e.g. a new day asked, is not).
        state.proposed = false;
        acknowledged = state.problem && !before.reason && state.reason ? `Entendido: parece un tema de ${state.problem}. ` : '';
      } else if (message.role === 'tool') {
        let result: { slots?: Offered[]; ok?: boolean; error?: string; message?: string } = {};
        try { result = JSON.parse(message.content); } catch { /* treated as empty */ }
        if (message.name === 'check_availability') { state.offered = result.slots ?? []; state.preferenceChanged = false; if (state.offered.length === 0 && !state.preference.date && !state.preference.part_of_day) state.noSlots = true; }
        if (message.name === 'propose_request') {
          if (result.ok) state.proposed = true;
          else if (result.error === 'slot_not_available') { state.slot = undefined; state.offered = null; state.error = 'Esa hora acaba de ocuparse. Te busco otras.'; }
          else state.error = result.message ? `Hay un dato que no cuadra: ${result.message}.` : 'Hay un dato que no cuadra.';
        }
      } else if (!message.tool_calls?.length) asked = nextStep(state);
    }
    const step = nextStep(state);
    const id = `sim-${history.length}`;
    const prefix = (state.error ? state.error + ' ' : '') + acknowledged;
    if (step === 'check') return { text: '', tool_calls: [{ id, name: 'check_availability', input: { ...(state.preference.date ? { date: state.preference.date } : {}), ...(state.preference.part_of_day ? { part_of_day: state.preference.part_of_day } : {}) } }] };
    if (step === 'propose') return { text: '', tool_calls: [{ id, name: 'propose_request', input: { name: state.name, phone: state.phone, brand: state.brand, model: state.model, plate: state.plate ?? '', reason: state.reason, notes: '', ...(state.slot ? { slot_starts_at: state.slot } : { availability: state.availabilityText }) } }] };
    if (step === 'pick') {
      const offered = state.offered ?? [];
      if (offered.length === 0) return { text: prefix + 'No tengo horas libres con esa preferencia. Dime otro día o franja, «cualquiera» para ver las primeras libres, o «ninguna» si prefieres que el taller te llame.', tool_calls: [] };
      return { text: prefix + 'Tengo estas horas libres:\n' + offered.map((o, i) => `${i + 1}) ${o.label}`).join('\n') + '\nResponde con el número, dime otro día o franja, o escribe «ninguna» si prefieres que el taller te llame.', tool_calls: [] };
    }
    if (step === 'done') return { text: prefix + (state.slot ? `Listo: he preparado tu solicitud con la cita del ${state.slotLabel}. ` : 'Listo: he preparado tu solicitud sin cita; el taller te llamará. ') + 'Revisa los datos, acepta el aviso legal y pulsa el botón para enviarla. Hasta entonces no se guarda ni se reserva nada.', tool_calls: [] };
    const greeting = !history.some(m => m.role === 'assistant') && step === 'name' ? `¡Hola! Soy el asistente de ${context.workshopName}. ` : '';
    return { text: greeting + prefix + QUESTIONS[step], tool_calls: [] };
  }
}
