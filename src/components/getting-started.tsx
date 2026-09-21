'use client';
import { Sparkles, Settings2, UserPlus } from 'lucide-react';
import { isSupabaseMode } from '@/lib/supabase/client';

export function GettingStarted({ owner, onNavigate }: { owner: boolean; onNavigate: (page: 'reception' | 'settings' | 'team') => void }) {
  return <section className="card settings-card">
    <span className="feature-icon"><Sparkles size={24}/></span>
    <h2>Bienvenido a tu taller</h2>
    <p className="muted">Todavía no hay ninguna solicitud. Sigue estos pasos para dejarlo listo; puedes saltarte cualquiera y volver más tarde.</p>
    <div className="resource-row">
      <div><b>Prueba una recepción</b><small>Simula la primera consulta de un cliente y verás cómo se organiza sola.</small></div>
      <button className="button primary" onClick={() => onNavigate('reception')}><Sparkles size={16}/>Abrir simulador</button>
    </div>
    {owner && <div className="resource-row">
      <div><b>Revisa los datos de tu taller</b><small>Nombre, horario y zona horaria: lo que verán tu equipo y tus clientes.</small></div>
      <button className="button" onClick={() => onNavigate('settings')}><Settings2 size={16}/>Configuración</button>
    </div>}
    {owner && isSupabaseMode && <div className="resource-row">
      <div><b>Invita a tu equipo</b><small>Da acceso a quien gestione la recepción contigo.</small></div>
      <button className="button" onClick={() => onNavigate('team')}><UserPlus size={16}/>Invitar</button>
    </div>}
  </section>;
}
