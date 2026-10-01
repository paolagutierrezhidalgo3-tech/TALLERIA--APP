import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DemoRepository } from './repository';
import { createDemo } from './demo';
import { SupabaseRepository } from './supabase/repository';
const { rpc } = vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('./supabase/client',()=>({getSupabase:()=>({rpc})}));
describe('Repositorios y carga acotada',()=>{
 beforeEach(()=>rpc.mockReset());
 afterEach(()=>vi.unstubAllGlobals());
 it('escribe sin precarga y refresca una sola vista',async()=>{rpc.mockResolvedValue({data:{},error:null});const repo=new SupabaseRepository('workshop');await repo.load({view:'customers',offset:25,search:'Prueba',status:'all'});rpc.mockClear();await repo.execute({type:'status',id:'request',status:'pendiente'});expect(rpc.mock.calls.map(c=>c[0])).toEqual(['execute_command','workspace_snapshot']);expect(rpc.mock.calls[1][1]).toMatchObject({p_view:'customers',p_offset:25,p_search:'Prueba',p_range_start:null,p_range_end:null});});
 it('reenvía el rango de fechas al pedir la vista de calendario',async()=>{rpc.mockResolvedValue({data:{},error:null});const repo=new SupabaseRepository('workshop');await repo.load({view:'calendar',offset:0,search:'',status:'all',range_start:'2030-01-02T00:00:00.000Z',range_end:'2030-01-03T00:00:00.000Z'});expect(rpc.mock.calls[0][1]).toMatchObject({p_view:'calendar',p_range_start:'2030-01-02T00:00:00.000Z',p_range_end:'2030-01-03T00:00:00.000Z'});});
 it('presenta errores controlados y no recarga tras fallo',async()=>{rpc.mockResolvedValue({data:null,error:{code:'23505',message:'internal_constraint'}});await expect(new SupabaseRepository('w').execute({type:'status',id:'r',status:'pendiente'})).rejects.toThrow('Ya existe');expect(rpc).toHaveBeenCalledTimes(1);});
 it('migra y persiste demo sin reescribirla en cada lectura',async()=>{const data=new Map<string,string>();const legacy=JSON.stringify(createDemo());data.set('talleria.demo.v1',legacy);const setItem=vi.fn((k:string,v:string)=>data.set(k,v));vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k)??null,setItem,removeItem:(k:string)=>data.delete(k)});const repo=new DemoRepository();const first=await repo.load();expect(first.schema_version).toBe(6);expect(data.has('talleria.demo.v1')).toBe(false);expect(JSON.parse(data.get('talleria.demo.v2')!).schema_version).toBe(6);expect(setItem).toHaveBeenCalledTimes(1);await repo.load();await repo.lookup('customer','');expect(setItem).toHaveBeenCalledTimes(1);const customers=await repo.load({view:'customers',offset:0,search:'',status:'all'});await repo.execute({type:'customer',customer:{...customers.customers[0],notes:'Persistido'}});const reload=await new DemoRepository().load({view:'customers',offset:0,search:'',status:'all'});expect(reload.customers.some(c=>c.notes==='Persistido')).toBe(true);});
 it('demo staff no puede restablecer ni cambiar configuración',async()=>{const data=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k)});const repo=new DemoRepository('staff');const s=await repo.load();await expect(repo.reset()).rejects.toThrow('propietario');await expect(repo.execute({type:'settings',workshop:s.workshop})).rejects.toThrow('propietario');});
 it('SupabaseRepository.peekMetrics pide la vista más barata y NUNCA cambia la vista que execute() recarga después (el poll de avisos no puede robarle la página al usuario)',async()=>{
  rpc.mockResolvedValue({data:{metrics:{new_requests:2,upcoming:0,pending_customers:0,completed:0}},error:null});
  const repo=new SupabaseRepository('workshop');
  await repo.load({view:'customers',offset:25,search:'Prueba',status:'all'}); // el usuario está en Clientes, con una búsqueda activa
  rpc.mockClear();
  const metrics=await repo.peekMetrics();
  expect(metrics).toEqual({new_requests:2,upcoming:0,pending_customers:0,completed:0});
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc.mock.calls[0]).toEqual(['workspace_snapshot',{p_workshop_id:'workshop',p_view:'settings',p_offset:0,p_search:'',p_status:'all',p_range_start:null,p_range_end:null,p_entity_id:null}]);
  rpc.mockClear();
  rpc.mockResolvedValue({data:{},error:null});
  await repo.execute({type:'status',id:'r',status:'pendiente'}); // una mutación normal, mientras el usuario sigue en Clientes
  expect(rpc.mock.calls[1][1]).toMatchObject({p_view:'customers',p_offset:25,p_search:'Prueba'}); // sigue recargando Clientes, no 'settings'
 });
 it('DemoRepository.peekMetrics devuelve métricas frescas sin cambiar la vista que execute() recarga después',async()=>{
  const data=new Map<string,string>();
  vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k)});
  const repo=new DemoRepository();
  const first=await repo.load({view:'customers',offset:0,search:'',status:'all'}); // el usuario está en Clientes
  const metrics=await repo.peekMetrics();
  expect(metrics).toEqual(first.metrics);
  const afterMutation=await repo.execute({type:'customer',customer:{...first.customers[0],notes:'Tras el poll'}});
  expect(afterMutation.page_info?.view).toBe('customers'); // sigue recargando Clientes, no 'settings'
 });
 it('SupabaseRepository.peek reenvía p_entity_id y NUNCA cambia la vista que execute() recarga después (abrir la ficha de un cliente no puede robarle la página al usuario)',async()=>{
  rpc.mockResolvedValue({data:{customers:[{id:'c1',name:'Ana'}]},error:null});
  const repo=new SupabaseRepository('workshop');
  await repo.load({view:'customers',offset:25,search:'Prueba',status:'all'}); // el usuario está en Clientes, con una búsqueda activa
  rpc.mockClear();
  const detail=await repo.peek({view:'customer_detail',offset:0,search:'',status:'all',entity_id:'c1'});
  expect(detail.customers[0]).toMatchObject({id:'c1'});
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc.mock.calls[0]).toEqual(['workspace_snapshot',{p_workshop_id:'workshop',p_view:'customer_detail',p_offset:0,p_search:'',p_status:'all',p_range_start:null,p_range_end:null,p_entity_id:'c1'}]);
  rpc.mockClear();
  rpc.mockResolvedValue({data:{},error:null});
  await repo.execute({type:'status',id:'r',status:'pendiente'}); // una mutación normal, mientras el usuario sigue en Clientes
  expect(rpc.mock.calls[1][1]).toMatchObject({p_view:'customers',p_offset:25,p_search:'Prueba'}); // sigue recargando Clientes, no la ficha
 });
 it('DemoRepository.peek devuelve el historial de un cliente/vehículo sin cambiar la vista que execute() recarga después',async()=>{
  const data=new Map<string,string>();
  vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k)});
  const repo=new DemoRepository();
  const first=await repo.load({view:'customers',offset:0,search:'',status:'all'}); // el usuario está en Clientes
  const customerId=first.customers[0].id;
  const detail=await repo.peek({view:'customer_detail',offset:0,search:'',status:'all',entity_id:customerId});
  expect(detail.customers.map(c=>c.id)).toEqual([customerId]);
  expect(detail.page_info?.view).toBe('customer_detail');
  const afterMutation=await repo.execute({type:'customer',customer:{...first.customers[0],notes:'Tras abrir la ficha'}});
  expect(afterMutation.page_info?.view).toBe('customers'); // sigue recargando Clientes, no la ficha
 });
});
