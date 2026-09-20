'use client';
import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, Wrench } from 'lucide-react';
import { getSupabase, isSupabaseMode } from '@/lib/supabase/client';
import { Field } from './ui';
export function AuthScreen({ onDemo }: { onDemo: () => void }) {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setMessage('');
    const form = new FormData(e.currentTarget);
    try {
      const auth = getSupabase().auth;
      const credentials = { email: String(form.get('email')), password: String(form.get('password')) };
      const { error } = register ? await auth.signUp(credentials) : await auth.signInWithPassword(credentials);
      if (error) throw error;
      if (register) setMessage('Cuenta creada. Si está activada la confirmación, revisa tu correo antes de iniciar sesión.');
    } catch (err) { setMessage(err instanceof Error ? err.message : 'No se ha podido iniciar sesión.'); }
    finally { setBusy(false); }
  }
  return <main className="auth-layout"><section className="auth-story"><div className="brand"><span className="brand-mark"><Wrench size={22}/></span>TALLERIA<span className="brand-dot">.</span></div><div><span className="eyebrow">MÁS TIEMPO PARA TU TALLER</span><h1>Ocúpate del motor.<br/><em>Nosotros, del resto.</em></h1><p>De la primera consulta a la próxima cita. Toda la recepción de tu taller, en un mismo lugar.</p><div className="auth-benefits">{['Cada consulta, bien organizada', 'Clientes y vehículos conectados', 'Una agenda que trabaja contigo'].map(t => <p key={t}><Check size={18}/>{t}</p>)}</div></div><small>Hecho para talleres que no paran.</small></section><section className="auth-form"><span className="eyebrow">BIENVENIDO A TALLERIA</span><h2>{isSupabaseMode ? register ? 'Crea tu cuenta' : 'Tu taller empieza aquí' : 'Conoce tu nuevo recepcionista'}</h2><p className="muted">{isSupabaseMode ? 'Accede para gestionar tu taller.' : 'Explora el panel con un taller y clientes ficticios. No necesitas una cuenta ni configurar servicios.'}</p>{isSupabaseMode ? <form onSubmit={submit}><Field label="Correo electrónico"><input name="email" type="email" required autoComplete="email"/></Field><Field label="Contraseña"><input name="password" type="password" minLength={8} maxLength={128} required autoComplete={register ? 'new-password' : 'current-password'}/></Field><button className="button primary full" disabled={busy}>{busy ? 'Un momento…' : register ? 'Crear cuenta' : 'Entrar al taller'}<ArrowRight size={18}/></button><button type="button" className="text-button" onClick={() => { setRegister(!register); setMessage(''); }}>{register ? 'Ya tengo una cuenta' : 'Crear una cuenta de taller'}</button></form> : <><button className="button primary full" onClick={onDemo}>Explorar demo<ArrowRight size={18}/></button><div className="demo-notice">Entorno de demostración · Los cambios se guardan únicamente en este navegador. Usa datos ficticios.</div></>}{message && <p role="status" className="notice">{message}</p>}</section></main>;
}
