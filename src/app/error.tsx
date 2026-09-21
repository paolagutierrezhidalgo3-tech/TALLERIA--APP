'use client';
import { useEffect } from 'react';
import { RotateCcw, Wrench } from 'lucide-react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <main className="onboarding">
    <div className="card">
      <span className="feature-icon"><Wrench/></span>
      <h1>Algo ha fallado</h1>
      <p className="muted">Ha ocurrido un error inesperado. Puedes intentarlo de nuevo; si sigue pasando, vuelve más tarde.</p>
      <button className="button primary full" onClick={() => reset()}><RotateCcw size={18}/>Intentar de nuevo</button>
    </div>
  </main>;
}
