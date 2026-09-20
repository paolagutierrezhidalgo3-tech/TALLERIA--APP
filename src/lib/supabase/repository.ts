import type { WorkshopRepository } from '../repository';
import type { Command, State } from '../domain';
import { defaultQuery, type LookupOption, type ViewQuery } from '../queries';
import { databaseMessage } from '../security';
import { getSupabase } from './client';
export class SupabaseRepository implements WorkshopRepository {
  private query: ViewQuery = defaultQuery;
  constructor(private workshopId: string) {}
  async load(query = this.query): Promise<State> {
    this.query = query;
    const {data,error}=await getSupabase().rpc('workspace_snapshot',{p_workshop_id:this.workshopId,p_view:query.view,p_offset:query.offset,p_search:query.search.slice(0,120),p_status:query.status});
    if(error) throw new Error(databaseMessage(error));
    return data as State;
  }
  async execute(command: Command): Promise<State> {
    // A paginated snapshot is not authoritative for uniqueness or scheduling.
    // PostgreSQL validates and commits; refresh exactly one current view afterward.
    const {error}=await getSupabase().rpc('execute_command',{p_workshop_id:this.workshopId,p_command:command});
    if(error) throw new Error(databaseMessage(error));
    return this.load();
  }
  async lookup(kind:'customer'|'request',search:string):Promise<LookupOption[]> {
    const {data,error}=await getSupabase().rpc('lookup_options',{p_workshop_id:this.workshopId,p_kind:kind,p_search:search.slice(0,120)});
    if(error) throw new Error(databaseMessage(error));
    return data as LookupOption[];
  }
}
