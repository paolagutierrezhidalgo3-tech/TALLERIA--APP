'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Mail, UserMinus } from 'lucide-react';
import type { State } from '@/lib/domain';
import { dateLabel, Field } from './ui';
import { inviteMember, loadTeam, removeMember, revokeInvitation, type TeamSnapshot } from '@/lib/supabase/team';

export function Team({ state }: { state: State }) {
  const owner = state.role !== 'staff';
  const [snapshot, setSnapshot] = useState<TeamSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reloadSeq, setReloadSeq] = useState(0);
  useEffect(() => {
    let alive = true;
    loadTeam(state.workshop.id).then(result => {
      if (!alive) return;
      if (result.status === 'ready') setSnapshot(result.snapshot); else setError(result.message);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [state.workshop.id, reloadSeq]);
  function reload() { setReloadSeq(n => n + 1); }
  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget; setBusy(true); setError('');
    try { await inviteMember(state.workshop.id, String(new FormData(form).get('email')).trim()); form.reset(); reload(); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se ha podido enviar la invitación.'); }
    finally { setBusy(false); }
  }
  async function cancelInvitation(id: string) {
    setBusy(true); setError('');
    try { await revokeInvitation(id); reload(); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se ha podido cancelar la invitación.'); }
    finally { setBusy(false); }
  }
  async function remove(userId: string) {
    setBusy(true); setError('');
    try { await removeMember(state.workshop.id, userId); reload(); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se ha podido retirar el acceso.'); }
    finally { setBusy(false); }
  }
  if (!snapshot) {
    if (loading) return <section className="card settings-card"><p className="muted">Cargando equipo…</p></section>;
    return <section className="card settings-card">
      <p role="alert" className="notice error">{error || 'No se ha podido cargar el equipo.'}</p>
      <button className="button primary" onClick={reload}>Reintentar</button>
    </section>;
  }
  return <>
    <section className="card settings-card">
      <div className="resource-heading"><div><h2>Miembros del taller</h2><p className="muted">Personas con acceso a este espacio de trabajo.</p></div></div>
      {snapshot.members.map(m => <div className="resource-row" key={m.user_id}>
        <div><b>{m.email}</b><small>{m.role === 'owner' ? 'Propietario' : 'Staff'} · desde {dateLabel(m.created_at, state.workshop.timezone)}</small></div>
        {owner && m.role !== 'owner' && <button className="button small" disabled={busy} aria-label={'Retirar a ' + m.email} onClick={() => void remove(m.user_id)}><UserMinus size={14}/>Retirar</button>}
      </div>)}
    </section>
    {owner && <section className="card settings-card resource-settings">
      <div className="resource-heading"><div><h2>Invitar a un miembro</h2><p className="muted">Se une con permisos de staff a este taller. No se envía correo automáticamente: comparte tú el acceso con esa persona.</p></div></div>
      <form onSubmit={invite}>
        <Field label="Correo electrónico"><input required type="email" name="email" maxLength={255} placeholder="persona@ejemplo.com" autoComplete="off"/></Field>
        <button className="button primary" disabled={busy}><Mail size={16}/>Crear invitación</button>
      </form>
      {snapshot.invitations.length > 0 && <>
        <p className="muted">Invitaciones pendientes</p>
        {snapshot.invitations.map(i => <div className="resource-row" key={i.id}>
          <div><b>{i.email}</b><small>Expira {dateLabel(i.expires_at, state.workshop.timezone)}</small></div>
          <button className="button small" disabled={busy} onClick={() => void cancelInvitation(i.id)}>Cancelar</button>
        </div>)}
      </>}
    </section>}
    {error && <p role="alert" className="notice error">{error}</p>}
  </>;
}
