import type { Message, State } from './domain';

// Right of erasure (RGPD/LOPDGDD) for a customer's history: everything here
// has an exact SQL twin in supabase/migrations/202610010015_customer_erasure_complete.sql
// (erasure_term_pattern, erasure_patterns, erasure_redact,
// erase_customer_personal_data), and src/lib/supabase/erasure.test.ts runs
// both on the same inputs and requires identical output. Keep them in step.
//
// The customer record itself (name/phone/notes) and their plates are
// overwritten by the customer_anonymize command; this module scrubs what
// that record leaves behind, keeping only operational information that
// doesn't identify the customer:
// - every message of their reception conversations (customer answers and
//   assistant messages alike) is rebuilt as { role, content: ERASED_MESSAGE };
// - request availability and notes are replaced/emptied;
// - request reasons, appointment notes and their vehicles' brand/model keep
//   their content minus every DETECTED occurrence of the customer's known
//   identifiers (names, phones, plates). Other personal data typed there,
//   or a known identifier written differently, can't be detected -- a
//   documented limit;
// - customer_merged audit events lose the merged duplicate's personal data,
//   and vehicle_corrected events lose known identifiers in previous values.
// Rows are only rewritten (and their version bumped) when their content
// actually changes, so running the erasure again is a no-op.
//
// Regexes are built without the engines' case-insensitive flag or \s/\w
// classes, whose behaviour outside ASCII depends on locale in PostgreSQL:
// case-insensitivity comes from the explicit Latin table below (other
// scripts match only in the exact case they were written -- a documented
// limit), and a name/plate only matches between separators (start/end,
// whitespace, punctuation), so it never cuts another word of any script.

export const ANONYMIZED_NAME = 'Cliente anonimizado';
export const ANONYMIZED_PHONE = '+00000000';
export const ERASED_MESSAGE = '[Eliminado por derecho de supresión]';
export const REDACTED = '[dato eliminado]';
export const ERASED_AVAILABILITY = 'Eliminada';
export const ERASED_REASON = 'Motivo eliminado';
const LOWER = 'abcdefghijklmnopqrstuvwxyzáéíóúüñàèìòùâêîôûäëïöç';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛÄËÏÖÇ';
// Separators a name or plate may touch, as the inside of a bracket
// expression valid in both engines (only \ [ ] ^ - need escaping there).
// Unicode spaces that mobile keyboards and pasted text use instead of a
// plain space: no-break, figure and narrow no-break space.
const UNICODE_SPACES = '   ';
const SEPARATORS = ' \\t\\n\\r' + UNICODE_SPACES + '!"#$%&\'()*+,./:;<=>?@_`{|}~\\\\\\[\\]\\^\\-¡¿«»“”‘’…–—·';
const SPACE_RUN = /[ \t\n\r   ]+/g;
const PLATE_STRIP = /[ \t\n\r   -]/g;
const BEFORE = '(?<![^' + SEPARATORS + '])';
const AFTER = '(?![^' + SEPARATORS + '])';
// Name tokens that are also everyday words in a workshop's notes, or part
// of this module's own placeholders: never redacted on their own (the full
// name containing them still is).
const STOP_WORDS = ['del', 'los', 'las', 'por', 'para', 'con', 'cliente', 'anonimizado', 'dato', 'datos', 'eliminado', 'eliminada', 'motivo'];
const SKIPPED_PLATES = ['OMITIR', 'NINGUNA'];

const chars = (value: string) => Array.from(value);
const toLower = (value: string) => chars(value).map(c => { const i = UPPER.indexOf(c); return i < 0 ? c : LOWER[i]; }).join('');
const toUpper = (value: string) => chars(value).map(c => { const i = LOWER.indexOf(c); return i < 0 ? c : UPPER[i]; }).join('');
// PostgreSQL's trim()/left() semantics: spaces only, code points.
const trimSpaces = (value: string) => value.replace(/^ +| +$/g, '');
const leftChars = (value: string, n: number) => chars(value).slice(0, n).join('');
// PostgreSQL's COLLATE "C": UTF-8 byte order, i.e. code point order.
function compareCodePoints(a: string, b: string): number {
  const x = chars(a), y = chars(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i].codePointAt(0)! - y[i].codePointAt(0)!;
  return x.length - y.length;
}

export function erasureTermPattern(term: string, kind: 'name' | 'phone' | 'plate'): string {
  const list = chars(term);
  if (kind === 'phone') {
    const digits = list.join('[ ' + UNICODE_SPACES + '().-]*');
    // A 9-digit (Spanish national) number may be written after its country
    // prefix: +34, 0034 or 34, with or without separators; a longer
    // (international) one may start with + or 00.
    const space = '[ ' + UNICODE_SPACES + ']*';
    return '(?<![0-9])' + (list.length === 9 ? '(?:(?:\\+|00)?' + space + '34[ ' + UNICODE_SPACES + '().-]*)?' : '(?:(?:\\+|00)' + space + ')?') + digits + '(?![0-9])';
  }
  const body = list.map((c, i) => {
    const sep = kind === 'plate' && i > 0 ? '[ ' + UNICODE_SPACES + '-]*' : '';
    if (c === ' ') return sep + '[ \\t\\n\\r' + UNICODE_SPACES + ']+';
    if (LOWER.includes(c) || UPPER.includes(c)) return sep + '[' + toLower(c) + toUpper(c) + ']';
    if (/^[0-9]$/.test(c)) return sep + c;
    if (c.codePointAt(0)! < 128) return sep + '\\' + c;
    return sep + c;
  }).join('');
  return BEFORE + body + AFTER;
}

/** Patterns for a customer's known identifiers, longest term first. */
export function erasurePatterns(names: string[], phones: string[], plates: string[]): string[] {
  const terms = new Map<string, number>();
  const add = (term: string, kind: 'name' | 'phone' | 'plate') => {
    const pattern = erasureTermPattern(term, kind);
    terms.set(pattern, Math.max(terms.get(pattern) ?? 0, chars(term).length));
  };
  for (const raw of names) {
    if (typeof raw !== 'string') continue;
    const full = trimSpaces(raw.normalize('NFC').replace(SPACE_RUN, ' '));
    const length = chars(full).length;
    if (length < 2 || length > 100 || full === ANONYMIZED_NAME) continue;
    if (!STOP_WORDS.includes(toLower(full))) add(full, 'name');
    for (const token of full.split(/[ -]/)) if (chars(token).length >= 3 && !STOP_WORDS.includes(toLower(token))) add(token, 'name');
  }
  for (const raw of phones) {
    if (typeof raw !== 'string') continue;
    const digits = raw.replace(/[^0-9]/g, '');
    if (digits.length < 7 || /^0+$/.test(digits)) continue;
    if (digits.length > 9) add(digits.slice(-9), 'phone');
    add(digits, 'phone');
  }
  for (const raw of plates) {
    if (typeof raw !== 'string') continue;
    const plate = toUpper(raw.normalize('NFC').replace(PLATE_STRIP, ''));
    const length = chars(plate).length;
    if (length < 3 || length > 20 || SKIPPED_PLATES.includes(plate)) continue;
    add(plate, 'plate');
  }
  return [...terms].sort((a, b) => b[1] - a[1] || compareCodePoints(a[0], b[0])).map(([pattern]) => pattern);
}

export function erasureRedact(text: string, patterns: string[]): string {
  return patterns.reduce((value, pattern) => value.replace(new RegExp(pattern, 'g'), REDACTED), text.normalize('NFC'));
}

const redactLimited = (text: string, patterns: string[], max: number) => leftChars(erasureRedact(text, patterns), max);

/** Name, phone and plate answers of a full guided-intake conversation.
 * The question order (name, phone, brand, model, plate, ...) has never
 * changed since the first commit; anything other than exactly 8 answers,
 * or an already scrubbed conversation, yields nothing. */
export function conversationIdentifiers(messages: Message[]): { name: string; phone: string; plate: string } | null {
  const answers = messages.filter(m => m.role === 'user').map(m => m.content);
  if (answers.length !== 8 || answers.includes(ERASED_MESSAGE)) return null;
  return { name: answers[0], phone: answers[1], plate: answers[4] };
}

export function redactReason(reason: string, patterns: string[]): string {
  const value = redactLimited(reason, patterns, 2000);
  return chars(trimSpaces(value)).length < 5 ? ERASED_REASON : value;
}

/** Scrubs a customer's history in place (on the caller's own copy of the
 * state). Must run BEFORE the customer record and plates are overwritten,
 * so their current values can still be used as known identifiers. */
export function eraseCustomerPersonalData(s: State, customerId: string): void {
  const customer = s.customers.find(c => c.id === customerId);
  if (!customer) return;
  const names: string[] = [], phones: string[] = [], plates: string[] = [];
  if (customer.name !== ANONYMIZED_NAME) names.push(customer.name);
  if (customer.phone !== ANONYMIZED_PHONE) phones.push(customer.phone);
  if (customer.phone_e164) phones.push(customer.phone_e164);
  const vehicles = s.vehicles.filter(v => v.customer_id === customerId);
  for (const v of vehicles) if (v.plate) plates.push(v.plate);
  const requests = s.requests.filter(r => r.customer_id === customerId);
  const conversationIds = new Set(requests.map(r => r.conversation_id));
  const conversations = s.conversations.filter(c => conversationIds.has(c.id));
  for (const c of conversations) {
    const found = conversationIdentifiers(c.messages);
    if (found) { names.push(found.name); phones.push(found.phone); plates.push(found.plate); }
  }
  const audit = s.audit ?? [];
  const merged = audit.filter(a => a.action === 'customer_merged' && a.entity_id === customerId);
  for (const a of merged) {
    const original = a.metadata?.original_customer as Record<string, unknown> | undefined;
    if (typeof original?.name === 'string') names.push(original.name);
    if (typeof original?.phone === 'string') phones.push(original.phone);
    if (typeof original?.phone_e164 === 'string') phones.push(original.phone_e164);
  }
  const patterns = erasurePatterns(names, phones, plates);

  for (const c of conversations) {
    const messages = c.messages.map(m => ({ role: m.role, content: ERASED_MESSAGE }));
    if (JSON.stringify(messages) !== JSON.stringify(c.messages)) c.messages = messages;
  }
  for (const r of requests) {
    const next = { reason: redactReason(r.reason, patterns), availability: ERASED_AVAILABILITY, notes: '' };
    if (next.reason !== r.reason || next.availability !== r.availability || next.notes !== r.notes) Object.assign(r, next, { version: (r.version ?? 1) + 1 });
  }
  const requestIds = new Set(requests.map(r => r.id));
  for (const a of s.appointments) if (requestIds.has(a.request_id)) {
    const notes = redactLimited(a.notes, patterns, 2000);
    if (notes !== a.notes) Object.assign(a, { notes, version: (a.version ?? 1) + 1 });
  }
  for (const v of vehicles) {
    const next = { brand: redactLimited(v.brand, patterns, 60), model: redactLimited(v.model, patterns, 80) };
    if (next.brand !== v.brand || next.model !== v.model) Object.assign(v, next, { version: (v.version ?? 1) + 1 });
  }
  for (const a of merged) {
    const original = a.metadata?.original_customer as Record<string, unknown> | undefined;
    const metadata = { original_customer: { id: original?.id ?? null }, personal_data_erased: true };
    if (JSON.stringify(metadata) !== JSON.stringify(a.metadata)) a.metadata = metadata;
  }
  const vehicleIds = new Set(vehicles.map(v => v.id));
  for (const a of audit) if (a.action === 'vehicle_corrected' && vehicleIds.has(a.entity_id) && a.metadata) {
    const metadata = { ...a.metadata };
    for (const key of ['previous_brand', 'previous_model']) if (typeof metadata[key] === 'string') metadata[key] = erasureRedact(metadata[key] as string, patterns);
    if (JSON.stringify(metadata) !== JSON.stringify(a.metadata)) a.metadata = metadata;
  }
}

/** A customer already anonymized by an earlier version of the command. */
export function isAnonymizedCustomer(c: { name: string; phone_e164?: string | null; notes: string }, marker: string): boolean {
  return c.name === ANONYMIZED_NAME && (c.phone_e164 ?? null) === null && c.notes.startsWith(marker + ' el ');
}
