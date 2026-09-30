'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus, Pencil, Wrench } from 'lucide-react';
import type { Command, Resource, State } from '@/lib/domain';
import { describeActivity, emptyMemberLookup, memberLoadKey, parsePendingMembersKey, pendingMembers, pendingMembersKey, runMemberLoad, type MemberLookup } from '@/lib/activity';
import { isSupabaseMode } from '@/lib/supabase/client';
import { loadTeam } from '@/lib/supabase/team';
import { dateLabel, Field, Modal } from './ui';
const names = { bay: 'Puesto', mechanic: 'Mecánico', lift: 'Elevador' };
export function Resources({ state, execute }: { state: State; execute: (c:Command)=>Promise<boolean> }) {
  const [editing,setEditing] = useState<Resource|null>(null);
  const [busy,setBusy] = useState(false);
  if(state.role==='staff') return null;
  async function save(e:FormEvent) { e.preventDefault(); if(!editing)return; setBusy(true); try { if(await execute({type:'resource',resource:editing}))setEditing(null); } finally {setBusy(false);} }
  return <><section className="card settings-card resource-settings"><div className="resource-heading"><div><h2>Recursos y capacidad</h2><p className="muted">Cada recurso puede atender una cita a la vez.</p></div><button className="button primary" onClick={()=>setEditing({id:crypto.randomUUID(),workshop_id:state.workshop.id,name:'',kind:'bay',active:true})}><Plus size={16}/>Añadir recurso</button></div>{state.resources?.map(r=><div className="resource-row" key={r.id}><Wrench size={18}/><div><b>{r.name}</b><small>{names[r.kind]} · {r.active?'Disponible':'Inactivo'}</small></div><button className="button small" aria-label={'Editar recurso '+r.name} onClick={()=>setEditing(r)}><Pencil size={14}/>Editar</button></div>)}<p className="muted">Para retirar un recurso, reasigna o cierra sus citas y desactívalo. Su historial se conserva.</p></section>
  <Activity key={state.workshop.id} state={state}/>
  {editing&&<Modal title="Recurso del taller" onClose={()=>!busy&&setEditing(null)}><form onSubmit={save}><Field label="Nombre del recurso"><input required minLength={2} maxLength={100} value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})}/></Field><Field label="Tipo de recurso"><select value={editing.kind} onChange={e=>setEditing({...editing,kind:e.target.value as Resource['kind']})}>{Object.entries(names).map(([k,n])=><option key={k} value={k}>{n}</option>)}</select></Field><label className="checkbox-field"><input type="checkbox" checked={editing.active} onChange={e=>setEditing({...editing,active:e.target.checked})}/>Disponible para nuevas citas</label><button className="button primary full" disabled={busy}>Guardar recurso</button></form></Modal>}</>;
}
// Owner-only: Resources already returns null for staff, and audit_events RLS
// only lets owners read it. Teammate emails come from the existing
// list_members RPC, called only while some author in the list is still
// unresolved; if it fails, those rows read "Otro miembro del equipo" and the
// call is retried once the audit list has moved on (see memberLoadKey).
// Requests are numbered; a response is not dropped just because the pending
// set changed meanwhile, but the cache only takes it if it is newer than the
// last one applied (runMemberLoad / applyMemberSnapshot).
function Activity({ state }: { state: State }) {
  const [members,setMembers] = useState<MemberLookup>(emptyMemberLookup);
  const [failedHead,setFailedHead] = useState<string|null>(null);
  const workshopId = state.workshop.id;
  const auditHead = state.audit?.[0]?.id;
  const auditHeadRef = useRef(auditHead);
  const mountedRef = useRef(true);
  const latestRequestRef = useRef(0);
  useEffect(()=>{ auditHeadRef.current=auditHead; },[auditHead]);
  useEffect(()=>{ mountedRef.current=true; return ()=>{ mountedRef.current=false; }; },[]);
  const pendingKey = isSupabaseMode ? pendingMembersKey(pendingMembers(state,members)) : '';
  const loadKey = memberLoadKey(pendingKey,failedHead,auditHead);
  useEffect(()=>{
    if(!loadKey)return;
    const seq=++latestRequestRef.current;
    const startedHead=auditHeadRef.current??'';
    void runMemberLoad({
      isMounted:()=>mountedRef.current,
      isLatest:s=>s===latestRequestRef.current,
      apply:setMembers,
      settle:failed=>setFailedHead(failed?startedHead:null),
    },()=>loadTeam(workshopId),seq,parsePendingMembersKey(loadKey.split('#')[0]));
  },[workshopId,loadKey]);
  return <section className="card settings-card resource-settings"><h2>Actividad del taller</h2><p className="muted">Últimas 20 operaciones. El historial completo permanece en la base de datos.</p>{state.audit?.map(a=>{const line=describeActivity(a,state,members.emails);return <div className="audit-row" key={a.id}><div><b>{line.action}</b>{line.subject&&<small>{line.subject}</small>}</div><div><small>{line.actor}</small><small>{dateLabel(a.created_at,state.workshop.timezone)}</small></div></div>;})}</section>;
}
