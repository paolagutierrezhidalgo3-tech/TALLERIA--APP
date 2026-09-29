import { describe, expect, it } from 'vitest';
import { normalizePhone } from './phone';
import { assertPublicSupabaseKey, databaseMessage } from './security';
import { applyCommand, type State } from './domain';
import { upgradeDemo } from './demo-migration';
import { projectState } from './queries';
const now=new Date('2030-01-01T08:00:00Z');
function base():State { return upgradeDemo({workshop:{id:crypto.randomUUID(),name:'Taller Prueba',phone:'',address:'',hours:'',timezone:'Europe/Madrid',appointment_minutes:60},customers:[],vehicles:[],requests:[],conversations:[],appointments:[]}); }
function receive(s:State,phone='600123456',model='León') {return applyCommand(s,{type:'intake',id:crypto.randomUUID(),data:{name:'Cliente Uno',phone,brand:'SEAT',model,plate:'1234BCD',reason:'Revisión anual',availability:'Mañanas',notes:''},messages:[{role:'user',content:'Revisión'}]},now);}
describe('Normalización y configuración segura',()=>{
 it.each(['600 123 456','+34 600 123 456','0034 600123456','(600) 123-456'])('normaliza %s',value=>expect(normalizePhone(value)).toBe('+34600123456'));
 it.each(['123','+3460012345','600123456 ext 2','34600123456','++34600123456','+1234567890123456'])('rechaza %s',value=>expect(()=>normalizePhone(value)).toThrow());
 it('acepta prefijos explícitos de otros países y exige prefijo para países sin reglas nacionales',()=>{expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');expect(()=>normalizePhone('2079460958','GB')).toThrow('prefijo');});
 it('rechaza claves privilegiadas antes de crear el cliente',()=>{const jwt=(role:string)=>'header.'+btoa(JSON.stringify({role,iss:'supabase'}))+'.signature';expect(()=>assertPublicSupabaseKey(jwt('anon'))).not.toThrow();expect(()=>assertPublicSupabaseKey('sb_publishable_example')).not.toThrow();for(const value of [jwt('service_role'),'sb_secret_example','invalid'])expect(()=>assertPublicSupabaseKey(value)).toThrow();});
 it('oculta detalles internos de errores SQL',()=>{expect(databaseMessage({code:'23505',message:'customers_secret_constraint'})).not.toContain('constraint');expect(databaseMessage({code:'P0001',message:'Ya existe el cliente.'})).toBe('Ya existe el cliente.');});
});
describe('Reglas de la segunda iteración en demo',()=>{
 it('deduplica prefijos y corrige marca/modelo conservando vehículo',()=>{const first=receive(base());const next=receive(first,'+34 600123456','Ibiza');expect(next.customers).toHaveLength(1);expect(next.vehicles).toHaveLength(1);expect(next.vehicles[0].id).toBe(first.vehicles[0].id);expect(next.vehicles[0].model).toBe('Ibiza');expect(next.vehicles[0].version).toBe(2);});
 it('permite citas simultáneas en recursos diferentes y rechaza el mismo recurso',()=>{let s=receive(receive(base()));const first=s.resources![0];const second={...first,id:crypto.randomUUID(),name:'Elevador 2',kind:'lift' as const};s=applyCommand(s,{type:'resource',resource:second},now);const cmd={type:'appointment' as const,request_version:s.requests[0].version,id:crypto.randomUUID(),request_id:s.requests[0].id,resource_id:first.id,starts_at:'2030-01-02T10:00:00Z',duration_minutes:60,notes:''};s=applyCommand(s,cmd,now);const another={...cmd,id:crypto.randomUUID(),request_id:s.requests[1].id};expect(()=>applyCommand(s,another,now)).toThrow('coincide');s=applyCommand(s,{...another,resource_id:second.id},now);expect(s.appointments).toHaveLength(2);expect(()=>applyCommand(s,{type:'resource',resource:{...first,active:false}},now)).toThrow('citas');});
 it('staff puede operar clientes pero no configuración ni recursos',()=>{const s={...base(),role:'staff' as const};expect(()=>receive(s)).not.toThrow();expect(()=>applyCommand(s,{type:'settings',workshop:s.workshop},now)).toThrow('propietario');expect(()=>applyCommand(s,{type:'resource',resource:s.resources![0]},now)).toThrow('propietario');expect(projectState({...s,audit:[{id:'a',user_id:'u',workshop_id:s.workshop.id,action:'settings',entity_type:'workshop',entity_id:s.workshop.id,created_at:now.toISOString()}]}).audit).toEqual([]);});
 it('rechaza ediciones obsoletas y registra actor y entidad al guardar',()=>{const s=receive(base());const c=s.customers[0];const next=applyCommand(s,{type:'customer',customer:{...c,name:'Nuevo nombre'}},now);expect(()=>applyCommand(next,{type:'customer',customer:c},now)).toThrow('ha cambiado');expect(next.audit?.[0]).toMatchObject({workshop_id:s.workshop.id,action:'customer',entity_id:c.id,user_id:'demo-owner'});});
 it('limita operaciones e idempotencia no consume otra operación',()=>{const s=receive(base());s.audit=Array.from({length:100},()=>({...s.audit![0],created_at:now.toISOString()}));expect(()=>applyCommand(s,{type:'status',id:s.requests[0].id,status:'pendiente'},now)).toThrow('demasiadas');expect(applyCommand(s,{type:'intake',id:s.requests[0].id,data:{} as never,messages:[]},now).requests).toHaveLength(1);});
 it('migra duplicados heredados preservando referencias y teléfonos dudosos',()=>{const s=receive(base());delete s.schema_version;const c=s.customers[0];s.customers.push({...c,id:crypto.randomUUID(),phone:'+34 600123456'});s.customers.push({...c,id:crypto.randomUUID(),phone:'123'});s.vehicles[0].customer_id=s.customers[1].id;s.requests[0].customer_id=s.customers[1].id;const next=upgradeDemo(s);expect(next.customers).toHaveLength(2);expect(next.requests[0].customer_id).toBe(next.vehicles[0].customer_id);expect(next.customers.some(c=>c.phone_e164===null)).toBe(true);expect(next.audit?.some(a=>a.action==='customer_merged')).toBe(true);});
 it('pagina raíces, conserva métricas globales y busca fuera de la primera página',()=>{const s=base();s.customers=Array.from({length:61},(_,i)=>({id:crypto.randomUUID(),workshop_id:s.workshop.id,name:'Cliente '+String(i).padStart(3,'0'),phone:'+34600123456',notes:''}));const q={view:'customers' as const,offset:0,search:'',status:'all'};const first=projectState(s,q),next=projectState(s,{...q,offset:25});expect(first.customers).toHaveLength(25);expect(first.page_info?.total).toBe(61);expect(next.customers.some(c=>first.customers.some(f=>f.id===c.id))).toBe(false);expect(projectState(s,{...q,search:'060'}).customers).toHaveLength(1);});
 it('calendario: selecciona citas que solapan el rango (no solo las que empiezan dentro) y nunca pagina',()=>{
  let s=receive(receive(base()));
  const resource=s.resources![0].id;
  const cmd=(id:string,requestIndex:number,starts_at:string,duration_minutes:number)=>({type:'appointment' as const,id,request_id:s.requests[requestIndex].id,request_version:s.requests[requestIndex].version,resource_id:resource,starts_at,duration_minutes,notes:''});
  const overlapsStart=crypto.randomUUID(), fullyInside=crypto.randomUUID();
  s=applyCommand(s,cmd(overlapsStart,0,'2030-01-02T08:30:00Z',60),now); // termina 09:30Z: solapa el inicio del rango
  s=applyCommand(s,cmd(fullyInside,1,'2030-01-02T09:30:00Z',15),now); // consecutiva, íntegramente dentro
  const q={view:'calendar' as const,offset:0,search:'',status:'all',range_start:'2030-01-02T09:00:00Z',range_end:'2030-01-02T10:00:00Z'};
  const result=projectState(s,q);
  expect(result.appointments.map(a=>a.id).sort()).toEqual([overlapsStart,fullyInside].sort());
  expect(result.page_info).toMatchObject({view:'calendar',total:2});
  expect(result.requests.map(r=>r.id).sort()).toEqual([s.requests[0].id,s.requests[1].id].sort()); // arrastra las solicitudes de cada cita, como el resto de vistas
 });
 it('calendario: sin un rango bien formado, no devuelve ninguna cita en vez de lanzar o devolverlas todas',()=>{
  const s=receive(base());
  expect(projectState(s,{view:'calendar',offset:0,search:'',status:'all'}).appointments).toHaveLength(0);
  expect(projectState(s,{view:'calendar',offset:0,search:'',status:'all',range_start:'no-es-una-fecha',range_end:'2030-01-02T10:00:00Z'}).appointments).toHaveLength(0);
 });
 it('lista de citas: filtra por búsqueda (motivo/cliente/matrícula) y por estado, igual que la lista de solicitudes',()=>{
  let s=applyCommand(base(),{type:'intake',id:crypto.randomUUID(),data:{name:'Ana García',phone:'600222333',brand:'SEAT',model:'Ibiza',plate:'1111AAA',reason:'Revisión anual',availability:'Mañanas',notes:''},messages:[{role:'user',content:'Revisión'}]},now);
  s=applyCommand(s,{type:'intake',id:crypto.randomUUID(),data:{name:'Bruno Ruiz',phone:'600444555',brand:'OPEL',model:'Astra',plate:'2222BBB',reason:'Cambio de frenos',availability:'Tardes',notes:''},messages:[{role:'user',content:'Frenos'}]},now);
  const resource=s.resources![0].id;
  const anaCustomer=s.customers.find(c=>c.name==='Ana García')!, brunoCustomer=s.customers.find(c=>c.name==='Bruno Ruiz')!;
  const anaReq=s.requests.find(r=>r.customer_id===anaCustomer.id)!, brunoReq=s.requests.find(r=>r.customer_id===brunoCustomer.id)!;
  const cmd=(id:string,request:typeof anaReq,starts_at:string)=>({type:'appointment' as const,id,request_id:request.id,request_version:request.version,resource_id:resource,starts_at,duration_minutes:30,notes:''});
  const aptAna=crypto.randomUUID(), aptBruno=crypto.randomUUID();
  s=applyCommand(s,cmd(aptAna,anaReq,'2030-01-02T09:00:00Z'),now);
  s=applyCommand(s,cmd(aptBruno,brunoReq,'2030-01-02T10:00:00Z'),now);
  const q={view:'appointments' as const,offset:0,search:'',status:'all'};
  expect(projectState(s,{...q,search:'Ana'}).appointments.map(a=>a.id)).toEqual([aptAna]);
  expect(projectState(s,{...q,search:'1111aaa'}).appointments.map(a=>a.id)).toEqual([aptAna]);
  const bruno=s.appointments.find(a=>a.id===aptBruno)!;
  expect(projectState(s,{...q,search:'frenos'}).appointments.map(a=>a.id)).toEqual([aptBruno]); // término que solo aparece en el motivo, no en nombre/matrícula
  s=applyCommand(s,{type:'appointment_status',id:aptBruno,status:'completed',version:bruno.version,request_version:s.requests.find(r=>r.id===bruno.request_id)!.version},now);
  expect(projectState(s,{...q,status:'completed'}).appointments.map(a=>a.id)).toEqual([aptBruno]);
  expect(projectState(s,{...q,status:'scheduled'}).appointments.map(a=>a.id)).toEqual([aptAna]);
  expect(projectState(s,{...q,search:'bruno',status:'completed'}).appointments.map(a=>a.id)).toEqual([aptBruno]); // búsqueda + estado combinados
  expect(projectState(s,{...q,search:'ana',status:'completed'}).appointments).toHaveLength(0); // el nombre coincide pero el estado no
 });
});
