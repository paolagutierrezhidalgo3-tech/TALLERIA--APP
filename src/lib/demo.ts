import { applyCommand, type State } from './domain';

export function createDemo(): State {
  let state: State = { workshop: { id: 'b87fa1b8-c8c5-4612-8e89-a35c1b258621', name: 'Taller Motor Norte', phone: '910 000 000', address: 'Calle del Motor, 24 · Madrid', hours: 'L–V 09:00–14:00 y 16:00–19:00', timezone: 'Europe/Madrid', appointment_minutes: 60 }, customers: [], vehicles: [], conversations: [], requests: [], appointments: [] };
  const examples = [
    ['Lucía Martín', '600 000 101', 'Volkswagen', 'Golf', '1234BCD', 'Ruido al frenar en la rueda delantera', 'Mañanas, a partir de las 10', 'El ruido comenzó hace dos días.'],
    ['Carlos Ruiz', '600 000 102', 'SEAT', 'León', '5678FGH', 'Revisión anual y cambio de aceite', 'Esta semana por la tarde', 'Prefiere dejar el coche y recogerlo después.'],
    ['Ana Torres', '600 000 103', 'Toyota', 'Yaris', '9012JKL', 'El aire acondicionado no enfría', 'Cualquier día por la mañana', ''],
    ['Miguel López', '600 000 104', 'Renault', 'Clio', '3456MNP', 'Solicitar cita para revisión antes de un viaje', 'Mañana o pasado', 'Sale de viaje el fin de semana.'],
  ];
  examples.forEach(([name, phone, brand, model, plate, reason, availability, notes], i) => {
    state = applyCommand(state, { type: 'intake', id: crypto.randomUUID(), data: { name, phone, brand, model, plate, reason, availability, notes }, messages: [{ role: 'assistant', content: '¡Hola! Soy el recepcionista digital del taller. ¿En qué puedo ayudarte?' }, { role: 'user', content: `Soy ${name}. ${reason}. Mi vehículo es un ${brand} ${model}, matrícula ${plate}. Mi teléfono es ${phone}. Disponibilidad: ${availability}.` }] }, new Date(Date.now() - (examples.length - 1 - i) * 45 * 60000));
  });
  state.requests[1].status = 'pendiente';
  state.requests[2].status = 'en_proceso';
  const start = new Date(); start.setDate(start.getDate() + 1); start.setHours(10, 0, 0, 0);
  state = applyCommand(state, { type: 'appointment', request_version: state.requests[3].version, id: crypto.randomUUID(), request_id: state.requests[3].id, starts_at: start.toISOString(), duration_minutes: 60, notes: 'Primera revisión del vehículo.' });
  return state;
}
