import type { WorkshopRepository } from '../repository';
import { applyCommand, type Command, type State, type Workshop } from '../domain';
import { getSupabase } from './client';

export class SupabaseRepository implements WorkshopRepository {
  constructor(private workshopId: string) {}
  async load(): Promise<State> {
    const db = getSupabase();
    const workshop = await db.from('workshops').select('*').eq('id', this.workshopId).single();
    if (workshop.error) throw new Error(workshop.error.message);
    const tables = ['customers', 'vehicles', 'conversations', 'requests', 'appointments'] as const;
    const rows = await Promise.all(tables.map(table => db.from(table).select('*').eq('workshop_id', this.workshopId)));
    for (const row of rows) if (row.error) throw new Error(row.error.message);
    const state = { workshop: workshop.data as Workshop, ...Object.fromEntries(tables.map((table, i) => [table, rows[i].data])) } as State;
    state.requests.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return state;
  }
  async execute(command: Command): Promise<State> {
    // Early friendly validation; PostgreSQL validates again inside a transaction.
    applyCommand(await this.load(), command);
    const { error } = await getSupabase().rpc('execute_command', { p_workshop_id: this.workshopId, p_command: command });
    if (error) throw new Error(error.message);
    return this.load();
  }
}
