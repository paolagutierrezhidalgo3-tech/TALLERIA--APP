'use client';
import { useEffect, useState } from 'react';
import type { LookupOption } from '@/lib/queries';
export type FindOptions = (kind:'customer'|'request',search:string)=>Promise<LookupOption[]>;
export function Lookup({kind,selected,label,disabled,onChange,find,initial}: {kind:'customer'|'request';selected:string;label:string;disabled?:boolean;onChange:(id:string,version?:number)=>void;find:FindOptions;initial:LookupOption[]}) {
  const [search,setSearch]=useState('');
  const [options,setOptions]=useState(initial);
  const [error,setError]=useState('');
  useEffect(()=>{
    if(disabled)return;
    let live=true;
    const timer=setTimeout(()=>{void find(kind,search).then(rows=>{if(live){setOptions(rows);setError('');}}).catch(err=>{if(live)setError(err instanceof Error?err.message:'No se pudo buscar.');});},200);
    return()=>{live=false;clearTimeout(timer);};
  },[kind,search,find,disabled]);
  const selectedOption=initial.find(o=>o.id===selected);
  const merged=selectedOption&&!options.some(o=>o.id===selected)?[selectedOption,...options]:options;
  return <div className="field"><span>{label}</span>{!disabled&&<input aria-label={'Buscar '+label.toLowerCase()} maxLength={120} value={search} placeholder="Buscar por nombre…" onChange={e=>setSearch(e.target.value)}/>}<select aria-label={label} required disabled={disabled} value={selected} onChange={e=>onChange(e.target.value,merged.find(o=>o.id===e.target.value)?.version)}><option value="">Selecciona una opción</option>{merged.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select>{!disabled&&<small>Hasta 20 resultados. Escribe para encontrar registros anteriores.</small>}{error&&<p role="alert">{error}</p>}</div>;
}
