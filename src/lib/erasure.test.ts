import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ANONYMIZED_MARKER, applyCommand, type Message, type State } from './domain';
import { upgradeDemo, DEMO_SCHEMA_VERSION } from './demo-migration';
import { ERASED_MESSAGE, conversationIdentifiers, eraseCustomerPersonalData, erasurePatterns, erasureRedact } from './erasure';
import { questions } from './reception/provider';

const now = new Date('2030-01-01T08:00:00Z');
function empty(): State { return { schema_version: DEMO_SCHEMA_VERSION, workshop: { version: 1, hours_version: 1, id: crypto.randomUUID(), name: 'Taller', phone: '', address: '', hours: '', timezone: 'Europe/Madrid', appointment_minutes: 60 }, customers: [], vehicles: [], conversations: [], requests: [], appointments: [], resources: [], audit: [], role: 'owner' }; }
const chat = (answers: string[]): Message[] => questions.flatMap((q, i) => [{ role: 'assistant' as const, content: q.prompt }, { role: 'user' as const, content: answers[i] }]);
function receive(s: State, name: string, phone: string, plate: string, reason: string, model = 'Ceed'): State {
  return applyCommand(s, { type: 'intake', id: crypto.randomUUID(), data: { name, phone, brand: 'Kia', model, plate, reason, availability: 'Lunes, preguntar por ' + name, notes: 'Móvil ' + phone }, messages: chat([name, phone, 'Kia', model, plate || 'omitir', reason, 'Lunes', 'omitir']) }, now);
}
// The customer's history as text, without ids (random UUIDs could contain
// any digit sequence).
const related = (s: State, customerId: string) => {
  const requests = s.requests.filter(r => r.customer_id === customerId);
  const vehicles = s.vehicles.filter(v => v.customer_id === customerId);
  return JSON.stringify({
    requests: requests.map(r => [r.reason, r.availability, r.notes]),
    conversations: s.conversations.filter(c => requests.some(r => r.conversation_id === c.id)).map(c => c.messages),
    appointments: s.appointments.filter(a => requests.some(r => r.id === a.request_id)).map(a => a.notes),
    vehicles: vehicles.map(v => [v.brand, v.model, v.plate]),
    audit: (s.audit ?? []).filter(a => a.entity_id === customerId || vehicles.some(v => v.id === a.entity_id)).map(a => a.metadata ?? null),
  });
};
const fullyErased = (messages: Message[]) => messages.length > 0 && messages.every(m => m.content === ERASED_MESSAGE && Object.keys(m).sort().join() === 'content,role');

describe('borrado del historial al anonimizar (demo)', () => {
  it('borra los datos personales de conversaciones, solicitudes, citas y vehículos y conserva lo útil, sin tocar a otros clientes', () => {
    let s = receive(empty(), 'Rocío Martín', '699 111 222', '2468 JKL', 'Rocío Martín: cambio de aceite del 2468JKL (tel. +34699111222)');
    s = receive(s, 'Raúl Martín', '699 333 444', '', 'Raúl Martín: revisión general');
    const rocio = s.customers.find(c => c.name === 'Rocío Martín')!;
    const request = s.requests.find(r => r.customer_id === rocio.id)!;
    s.appointments.push({ id: crypto.randomUUID(), workshop_id: s.workshop.id, request_id: request.id, starts_at: '2030-01-02T10:00:00Z', duration_minutes: 60, status: 'completed', notes: 'Rocío pagó en efectivo; tel 699111222', version: 1 });
    const raulBefore = related(s, s.customers.find(c => c.name === 'Raúl Martín')!.id);
    const next = applyCommand(s, { type: 'customer_anonymize', id: rocio.id, version: rocio.version }, now);
    const r = next.requests.find(x => x.id === request.id)!;
    expect(r.reason).toBe('[dato eliminado]: cambio de aceite del [dato eliminado] (tel. [dato eliminado])');
    expect(r.availability).toBe('Eliminada');
    expect(r.notes).toBe('');
    expect(r.version).toBe((request.version ?? 1) + 1);
    expect(r.status).toBe(request.status);
    expect(r.created_at).toBe(request.created_at);
    expect(fullyErased(next.conversations.find(c => c.id === r.conversation_id)!.messages)).toBe(true);
    expect(next.appointments[0].notes).toBe('[dato eliminado] pagó en efectivo; tel [dato eliminado]');
    expect(related(next, rocio.id)).not.toMatch(/Rocío|Martín|699|2468/);
    expect(next.vehicles.find(v => v.customer_id === rocio.id)).toMatchObject({ brand: 'Kia', model: 'Ceed', plate: '' });
    expect(related(next, s.customers.find(c => c.name === 'Raúl Martín')!.id)).toBe(raulBefore);
  });
  it('anonimiza también la marca, el modelo y la auditoría de corrección del vehículo cuando contienen datos conocidos', () => {
    let s = receive(empty(), 'Iker Sanz', '611 000 111', '1111 AAA', 'Revisión', 'Golf de Iker Sanz');
    s = receive(s, 'Iker Sanz', '611 000 111', '1111 AAA', 'Otra revisión', 'Golf');
    const c = s.customers[0];
    expect(s.vehicles[0].model).toBe('Golf');
    s.audit!.push({ id: crypto.randomUUID(), workshop_id: s.workshop.id, user_id: null, action: 'vehicle_corrected', entity_type: 'vehicle', entity_id: s.vehicles[0].id, created_at: now.toISOString(), metadata: { previous_brand: 'Kia', previous_model: 'Golf de Iker Sanz' } });
    s.vehicles[0].brand = 'Kia (de Iker)';
    const next = applyCommand(s, { type: 'customer_anonymize', id: c.id, version: c.version }, now);
    expect(next.vehicles[0]).toMatchObject({ brand: 'Kia (de [dato eliminado])', model: 'Golf', plate: '' });
    expect(next.audit!.find(a => a.action === 'vehicle_corrected')!.metadata).toEqual({ previous_brand: 'Kia', previous_model: 'Golf de [dato eliminado]' });
  });
  it('reconstruye los mensajes sin propiedades extra ni texto original, también los del asistente', () => {
    const s = applyCommand(empty(), { type: 'intake', id: crypto.randomUUID(), data: { name: 'Eva Ruiz', phone: '611 222 999', brand: 'Kia', model: 'Rio', plate: '', reason: 'Revisión', availability: 'Tardes', notes: '' }, messages: [{ role: 'assistant', content: 'Hola Eva Ruiz' }, { role: 'user', content: 'Eva', phone: '+34611222999' } as Message] }, now);
    const next = applyCommand(s, { type: 'customer_anonymize', id: s.customers[0].id, version: s.customers[0].version }, now);
    expect(next.conversations[0].messages).toEqual([{ role: 'assistant', content: ERASED_MESSAGE }, { role: 'user', content: ERASED_MESSAGE }]);
  });
  it('anonimizar o borrar otra vez no cambia nada más: ni el contenido ni las versiones', () => {
    let s = receive(empty(), 'Elena Soto', '688 222 333', '1357 MNP', 'Elena Soto pide revisión de cliente nuevo');
    s.appointments.push({ id: crypto.randomUUID(), workshop_id: s.workshop.id, request_id: s.requests[0].id, starts_at: '2030-01-02T10:00:00Z', duration_minutes: 60, status: 'completed', notes: 'Elena', version: 1 });
    s = applyCommand(s, { type: 'customer_anonymize', id: s.customers[0].id, version: s.customers[0].version }, now);
    expect(s.requests[0].reason).toBe('[dato eliminado] pide revisión de cliente nuevo');
    const snapshot = JSON.stringify({ r: s.requests, a: s.appointments, v: s.vehicles, c: s.conversations, au: s.audit!.filter(a => a.action !== 'customer_anonymize') });
    s = applyCommand(s, { type: 'customer_anonymize', id: s.customers[0].id, version: s.customers[0].version }, now);
    eraseCustomerPersonalData(s, s.customers[0].id);
    expect(JSON.stringify({ r: s.requests, a: s.appointments, v: s.vehicles, c: s.conversations, au: s.audit!.filter(a => a.action !== 'customer_anonymize') })).toBe(snapshot);
  });
  it('limpia la copia del cliente duplicado guardada en la auditoría de unificación', () => {
    const s = receive(empty(), 'Nuria Vidal', '677 444 555', '', 'Revisión de Nuria (antes Nuri Vidal)');
    const c = s.customers[0];
    s.audit!.push({ id: crypto.randomUUID(), workshop_id: s.workshop.id, user_id: null, action: 'customer_merged', entity_type: 'customer', entity_id: c.id, created_at: now.toISOString(), metadata: { original_customer: { id: 'dup-1', name: 'Nuri Vidal', phone: '+34677444555', notes: 'duplicado' } } });
    const next = applyCommand(s, { type: 'customer_anonymize', id: c.id, version: c.version }, now);
    expect(next.audit!.find(a => a.action === 'customer_merged')!.metadata).toEqual({ original_customer: { id: 'dup-1' }, personal_data_erased: true });
    expect(next.requests[0].reason).toBe('Revisión de [dato eliminado] (antes [dato eliminado])');
  });
  it('recorta al máximo permitido cuando la sustitución alarga el texto', () => {
    let s = receive(empty(), 'Ana Gil', '622 111 000', '', 'Ana '.repeat(499) + 'fin');
    s.appointments.push({ id: crypto.randomUUID(), workshop_id: s.workshop.id, request_id: s.requests[0].id, starts_at: '2030-01-02T10:00:00Z', duration_minutes: 60, status: 'completed', notes: 'Gil '.repeat(500), version: 1 });
    s = applyCommand(s, { type: 'customer_anonymize', id: s.customers[0].id, version: s.customers[0].version }, now);
    expect(Array.from(s.requests[0].reason)).toHaveLength(2000);
    expect(Array.from(s.appointments[0].notes)).toHaveLength(2000);
    expect(s.requests[0].reason.startsWith('[dato eliminado] [dato eliminado]')).toBe(true);
  });
});

describe('actualización v6 de la demo guardada', () => {
  it('limpia el historial de los clientes anonimizados antes de este cambio, y solo el suyo', () => {
    let s = receive(empty(), 'Marta Gil', '655 777 888', '8642 QRS', 'Marta Gil: neumáticos para el 8642QRS');
    s = receive(s, 'Pablo Gil', '655 999 000', '', 'Pablo Gil: ruido en el escape');
    const marta = s.customers.find(c => c.name === 'Marta Gil')!;
    // What 011's command (and the old demo) left behind: record and plates only.
    Object.assign(marta, { name: 'Cliente anonimizado', phone: '+00000000', phone_e164: null, notes: ANONYMIZED_MARKER + ' el 2026-09-30 a petición del cliente (derecho de supresión, RGPD/LOPDGDD).' });
    s.vehicles.filter(v => v.customer_id === marta.id).forEach(v => { v.plate = ''; });
    s.schema_version = 5;
    const pabloBefore = related(s, s.customers.find(c => c.name === 'Pablo Gil')!.id);
    const upgraded = upgradeDemo(s);
    expect(upgraded.schema_version).toBe(DEMO_SCHEMA_VERSION);
    expect(upgraded.requests.find(r => r.customer_id === marta.id)!.reason).toBe('[dato eliminado]: neumáticos para el [dato eliminado]');
    expect(related(upgraded, marta.id)).not.toMatch(/Marta|655|8642/);
    expect(related(upgraded, s.customers.find(c => c.name === 'Pablo Gil')!.id)).toBe(pabloBefore);
    expect(upgradeDemo(upgraded)).toBe(upgraded);
  });
});

describe('patrones de datos conocidos', () => {
  it('respeta los límites de palabra de cualquier alfabeto y las mayúsculas latinas con tilde', () => {
    const p = erasurePatterns(['Ana Núñez', 'Иван'], [], []);
    expect(erasureRedact('ANA y ana; NÚÑEZ; mañana Banana Anabel Anał «Ana» “Ana”, Ana… Ana—Núñez', p)).toBe('[dato eliminado] y [dato eliminado]; [dato eliminado]; mañana Banana Anabel Anał «[dato eliminado]» “[dato eliminado]”, [dato eliminado]… [dato eliminado]—[dato eliminado]');
    // Decomposed accents are compared in NFC; other scripts only in the case they were written.
    expect(erasureRedact('NÚÑEZ y Aná', p)).toBe('[dato eliminado] y Aná');
    expect(erasureRedact('Иван, ИВАН', p)).toBe('[dato eliminado], ИВАН');
  });
  it('borra el teléfono en cualquier formato, también pegado al prefijo, sin tocar otros números', () => {
    const p = erasurePatterns([], ['+34 600 111 222'], []);
    expect(erasureRedact('600-111-222 / (600) 111 222 / 600.111.222 / +34600111222 / 0034 600111222 / 34600111222 / (+34) 600 111 222', p))
      .toBe('[dato eliminado] / ([dato eliminado] / [dato eliminado] / [dato eliminado] / [dato eliminado] / [dato eliminado] / ([dato eliminado]');
    expect(erasureRedact('16001112220 y 1600111222', p)).toBe('16001112220 y 1600111222');
    expect(erasureRedact('+44 20 7946 0958', erasurePatterns([], ['+442079460958'], []))).toBe('[dato eliminado]');
  });
  it('borra matrículas como las acepta el alta, también cortas, con o sin separadores', () => {
    const p = erasurePatterns([], [], ['1234 bcd', 'AB1', 'ñu-12']);
    expect(erasureRedact('1234BCD, 1234 bcd, 1234-BCD, X1234BCD, ab1, AB 1, AB12, ÑU12', p)).toBe('[dato eliminado], [dato eliminado], [dato eliminado], X1234BCD, [dato eliminado], [dato eliminado], AB12, [dato eliminado]');
  });
  it('trata los espacios no separables (U+00A0, U+2007, U+202F) como espacios en nombres, matrículas y teléfonos', () => {
    const p = erasurePatterns(['Ana Mora'], ['611 222 333'], ['AB 1']);
    expect(erasureRedact('Avisar a Ana hoy; Ana Mora vino', p)).toBe('Avisar a [dato eliminado] hoy; [dato eliminado] vino');
    expect(erasureRedact('Revisar AB 1 y AB 1; tel. +34 611 222 333', p)).toBe('Revisar [dato eliminado] y [dato eliminado]; tel. [dato eliminado]');
    expect(erasurePatterns(['Ana Mora'], [], [])).toEqual(erasurePatterns(['Ana Mora'], [], []));
  });
  it('ignora identificadores vacíos, de relleno o demasiado cortos', () => {
    expect(erasurePatterns(['Cliente anonimizado', 'A', 'Del'], ['+00000000', '12345'], ['omitir', 'no', 'Ninguna', 'AB', ''])).toEqual([]);
  });
  it('solo confía en una conversación guiada completa y aún no borrada', () => {
    expect(conversationIdentifiers(chat(['Eva', '611', 'x', 'y', '1111AAA', 'r', 'a', 'n']))).toEqual({ name: 'Eva', phone: '611', plate: '1111AAA' });
    expect(conversationIdentifiers([{ role: 'user', content: 'Soy Eva' }])).toBeNull();
    expect(conversationIdentifiers(chat(['Eva', '611', 'x', 'y', '1111AAA', 'r', 'a', 'n']).map(m => ({ ...m, content: ERASED_MESSAGE })))).toBeNull();
  });
});

describe('texto del modal de anonimización', () => {
  it('describe lo que se borra y su límite, sin prometer un historial sin datos personales', () => {
    const text = readFileSync('src/components/editors.tsx', 'utf8').replace(/\s+/g, ' ');
    expect(text).toContain('se eliminarán sus datos personales del historial');
    expect(text).toContain('no se detectan automáticamente');
    expect(text).not.toContain('sin datos personales');
    expect(text).not.toContain('allí donde aparezcan');
  });
});
