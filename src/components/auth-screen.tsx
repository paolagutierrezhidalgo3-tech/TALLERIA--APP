'use client';
import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, Wrench } from 'lucide-react';
import { getSupabase, isSupabaseMode } from '@/lib/supabase/client';
import { Field } from './ui';
export function AuthScreen({ onDemo }: { onDemo: () => void }) {
  const [register, setRegister] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [unconfirmedEmail, setUnconfirmedEmail] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setMessage(''); setUnconfirmedEmail('');
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email'));
    try {
      const auth = getSupabase().auth;
      const credentials = { email, password: String(form.get('password')) };
      const { error } = register ? await auth.signUp({ ...credentials, options: { emailRedirectTo: window.location.origin } }) : await auth.signInWithPassword(credentials);
      if (error) throw error;
      if (register) setMessage('Cuenta creada. Si está activada la confirmación, revisa tu correo antes de iniciar sesión.');
    } catch (err) {
      if (!register && (err as { code?: string } | null)?.code === 'email_not_confirmed') { setUnconfirmedEmail(email); setMessage('Tu correo todavía no está confirmado.'); }
      else setMessage(err instanceof Error ? err.message : 'No se ha podido iniciar sesión.');
    }
    finally { setBusy(false); }
  }
  async function resendConfirmation() {
    setBusy(true); setMessage('');
    try {
      const { error } = await getSupabase().auth.resend({ type: 'signup', email: unconfirmedEmail, options: { emailRedirectTo: window.location.origin } });
      if (error) throw error;
      setMessage('Te hemos enviado un nuevo correo de confirmación. Revisa tu bandeja de entrada.');
    } catch (err) { setMessage(err instanceof Error ? err.message : 'No se ha podido reenviar el correo.'); }
    finally { setBusy(false); }
  }
  async function submitForgot(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setMessage('');
    try {
      const email = String(new FormData(e.currentTarget).get('email'));
      const { error } = await getSupabase().auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
      if (error) throw error;
      setForgotSent(true);
    } catch (err) { setMessage(err instanceof Error ? err.message : 'No se ha podido enviar el correo de recuperación.'); }
    finally { setBusy(false); }
  }
  function backToLogin() { setForgot(false); setForgotSent(false); setMessage(''); setUnconfirmedEmail(''); }
  return <main className="auth-layout"><section className="auth-story"><div className="brand"><span className="brand-mark"><Wrench size={22}/></span>TALLERIA<span className="brand-dot">.</span></div><div><span className="eyebrow">MÁS TIEMPO PARA TU TALLER</span><h1>Ocúpate del motor.<br/><em>Nosotros, del resto.</em></h1><p>De la primera consulta a la próxima cita. Toda la recepción de tu taller, en un mismo lugar.</p><div className="auth-benefits">{['Cada consulta, bien organizada', 'Clientes y vehículos conectados', 'Una agenda que trabaja contigo'].map(t => <p key={t}><Check size={18}/>{t}</p>)}</div></div><small>Hecho para talleres que no paran.</small></section><section className="auth-form">{isSupabaseMode && forgot ? <>
    <span className="eyebrow">RECUPERAR ACCESO</span><h2>Restablece tu contraseña</h2>
    {forgotSent
      ? <><p className="muted">Si existe una cuenta con ese correo, hemos enviado un enlace para restablecer la contraseña. Revisa tu bandeja de entrada.</p><button type="button" className="text-button" onClick={backToLogin}>Volver a iniciar sesión</button></>
      : <form onSubmit={submitForgot}><p className="muted">Escribe tu correo y te enviaremos un enlace para elegir una nueva contraseña.</p><Field label="Correo electrónico"><input name="email" type="email" required autoComplete="email"/></Field><button className="button primary full" disabled={busy}>{busy ? 'Enviando…' : 'Enviar enlace'}<ArrowRight size={18}/></button><button type="button" className="text-button" onClick={backToLogin}>Volver a iniciar sesión</button></form>}
  </> : <><span className="eyebrow">BIENVENIDO A TALLERIA</span><h2>{isSupabaseMode ? register ? 'Crea tu cuenta' : 'Tu taller empieza aquí' : 'Conoce tu nuevo recepcionista'}</h2><p className="muted">{isSupabaseMode ? 'Accede para gestionar tu taller.' : 'Explora el panel con un taller y clientes ficticios. No necesitas una cuenta ni configurar servicios.'}</p>{isSupabaseMode ? <form onSubmit={submit}><Field label="Correo electrónico"><input name="email" type="email" required autoComplete="email"/></Field><Field label="Contraseña"><input name="password" type="password" minLength={8} maxLength={128} required autoComplete={register ? 'new-password' : 'current-password'}/></Field><button className="button primary full" disabled={busy}>{busy ? 'Un momento…' : register ? 'Crear cuenta' : 'Entrar al taller'}<ArrowRight size={18}/></button>{!register && <button type="button" className="text-button" onClick={() => { setForgot(true); setMessage(''); setUnconfirmedEmail(''); }}>¿Olvidaste tu contraseña?</button>}<button type="button" className="text-button" onClick={() => { setRegister(!register); setMessage(''); setUnconfirmedEmail(''); }}>{register ? 'Ya tengo una cuenta' : 'Crear una cuenta de taller'}</button></form> : <><button className="button primary full" onClick={onDemo}>Explorar demo<ArrowRight size={18}/></button><div className="demo-notice">Entorno de demostración · Los cambios se guardan únicamente en este navegador. Usa datos ficticios.</div></>}{!register && unconfirmedEmail && <button type="button" className="text-button" disabled={busy} onClick={() => void resendConfirmation()}>Reenviar correo de confirmación</button>}</>}{message && <p role="status" className="notice">{message}</p>}</section></main>;
}
