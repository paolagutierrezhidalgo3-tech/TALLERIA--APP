import { applyCommand, type Command, type State } from './domain';
import { createDemo } from './demo';
export interface WorkshopRepository { load(): Promise<State>; execute(command: Command): Promise<State> }
const KEY = 'talleria.demo.v1';
export class DemoRepository implements WorkshopRepository {
  async load(): Promise<State> {
    const saved = localStorage.getItem(KEY);
    if (saved) {
      try { const parsed: State = JSON.parse(saved); if (parsed.workshop?.id && Array.isArray(parsed.requests) && Array.isArray(parsed.customers) && Array.isArray(parsed.vehicles) && Array.isArray(parsed.conversations) && Array.isArray(parsed.appointments)) return parsed; } catch { /* Show recovery, never silently discard data. */ }
      throw new Error('Los datos demo guardados no se pueden leer. Usa «Restablecer demo» para recuperarlos.');
    }
    const state = createDemo(); localStorage.setItem(KEY, JSON.stringify(state)); return state;
  }
  async execute(command: Command): Promise<State> {
    const state = applyCommand(await this.load(), command);
    localStorage.setItem(KEY, JSON.stringify(state)); return state;
  }
  async reset(): Promise<State> { const state = createDemo(); localStorage.setItem(KEY, JSON.stringify(state)); return state; }
}
