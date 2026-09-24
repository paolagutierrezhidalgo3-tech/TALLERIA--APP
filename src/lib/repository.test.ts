import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DemoRepository } from './repository';
import { createDemo } from './demo';
import { SupabaseRepository } from './supabase/repository';
const { rpc } = vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('./supabase/client',()=>({getSupabase:()=>({rpc})}));
describe('Repositorios y carga acotada',()=>{
 beforeEach(()=>rpc.mockReset());
 afterEach(()=>vi.unstubAllGlobals());
 it('escribe sin precarga y refresca una sola vista',async()=>{rpc.mockResolvedValue({data:{},error:null});const repo=new SupabaseRepository('workshop');await repo.load({view:'customers',offset:25,search:'Prueba',status:'all'});rpc.mockClear();await repo.execute({type:'status',id:'request',status:'pendiente'});expect(rpc.mock.calls.map(c=>c[0])).toEqual(['execute_command','workspace_snapshot']);expect(rpc.mock.calls[1][1]).toMatchObject({p_view:'customers',p_offset:25,p_search:'Prueba'});});
 it('presenta errores controlados y no recarga tras fallo',async()=>{rpc.mockResolvedValue({data:null,error:{code:'23505',message:'internal_constraint'}});await expect(new SupabaseRepository('w').execute({type:'status',id:'r',status:'pendiente'})).rejects.toThrow('Ya existe');expect(rpc).toHaveBeenCalledTimes(1);});
 it('migra y persiste demo sin reescribirla en cada lectura',async()=>{const data=new Map<string,string>();const legacy=JSON.stringify(createDemo());data.set('talleria.demo.v1',legacy);const setItem=vi.fn((k:string,v:string)=>data.set(k,v));vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k)??null,setItem});const repo=new DemoRepository();const first=await repo.load();expect(first.schema_version).toBe(5);expect(data.get('talleria.demo.v1')).toBe(legacy);expect(setItem).toHaveBeenCalledTimes(1);await repo.load();await repo.lookup('customer','');expect(setItem).toHaveBeenCalledTimes(1);const customers=await repo.load({view:'customers',offset:0,search:'',status:'all'});await repo.execute({type:'customer',customer:{...customers.customers[0],notes:'Persistido'}});const reload=await new DemoRepository().load({view:'customers',offset:0,search:'',status:'all'});expect(reload.customers.some(c=>c.notes==='Persistido')).toBe(true);});
 it('demo staff no puede restablecer ni cambiar configuración',async()=>{const data=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v)});const repo=new DemoRepository('staff');const s=await repo.load();await expect(repo.reset()).rejects.toThrow('propietario');await expect(repo.execute({type:'settings',workshop:s.workshop})).rejects.toThrow('propietario');});
});
