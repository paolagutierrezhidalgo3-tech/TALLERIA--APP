import { searchText } from './search';
import { applyCommand, type Command, type State } from './domain';
import { createDemo } from './demo';
import { upgradeDemo } from './demo-migration';
import { defaultQuery, projectState, type LookupOption, type ViewQuery } from './queries';
export interface WorkshopRepository {
  load(query?: ViewQuery): Promise<State>;
  execute(command: Command): Promise<State>;
  lookup(kind: 'customer' | 'request', search: string): Promise<LookupOption[]>;
}
export const KEY = 'talleria.demo.v2';
export const LEGACY = 'talleria.demo.v1';
export class DemoRepository implements WorkshopRepository {
  private query: ViewQuery = defaultQuery;
  constructor(private role: 'owner' | 'staff' = 'owner') {}
  private read(): State {
    const saved = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY);
    let state: State;
    let upgraded = !saved;
    if (saved) {
      try {
        state = JSON.parse(saved) as State;
        if (!state.workshop?.id || !Array.isArray(state.customers) || !Array.isArray(state.requests) || !Array.isArray(state.vehicles) || !Array.isArray(state.conversations) || !Array.isArray(state.appointments)) throw new Error();
        upgraded = state.schema_version !== 4;
        state = upgradeDemo(state);
      } catch { throw new Error('Los datos demo guardados no se pueden leer. Usa «Restablecer demo» para recuperarlos.'); }
    } else state = upgradeDemo(createDemo());
    state.role = this.role; state.user_id = 'demo-' + this.role;
    if (upgraded) localStorage.setItem(KEY, JSON.stringify(state));
    return state;
  }
  async load(query = this.query): Promise<State> {
    this.query = query;
    return projectState(this.read(),query);
  }
  async execute(command: Command): Promise<State> {
    const save = async () => {
      const state = applyCommand(this.read(), command);
      localStorage.setItem(KEY, JSON.stringify(state));
      return projectState(state,this.query);
    };
    // Cross-tab read/modify/write serialization where Web Locks are supported.
    if (typeof navigator!=='undefined' && navigator.locks) return navigator.locks.request(KEY,save);
    return save();
  }
  async lookup(kind: 'customer' | 'request', search: string): Promise<LookupOption[]> {
    const s = this.read(); const q=searchText(search.slice(0,120));
    if(kind==='customer') return s.customers.filter(c=>searchText(c.name+' '+c.phone).includes(q)).slice(0,20).map(c=>({id:c.id,label:c.name+' · '+c.phone}));
    return s.requests.filter(r=>!['completada','cancelada'].includes(r.status)&&!s.appointments.some(a=>a.request_id===r.id&&a.status==='scheduled')).map(r=>({id:r.id,version:r.version,label:(s.customers.find(c=>c.id===r.customer_id)?.name??'')+' · '+r.reason})).filter(r=>searchText(r.label).includes(q)).slice(0,20);
  }
  async reset(): Promise<State> {
    if(this.role!=='owner') throw new Error('Solo el propietario puede realizar esta operación.');
    const state=upgradeDemo(createDemo()); localStorage.setItem(KEY,JSON.stringify(state)); return this.load();
  }
}
