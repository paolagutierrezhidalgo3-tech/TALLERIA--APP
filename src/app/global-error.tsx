'use client';
import { useEffect } from 'react';
import { RotateCcw, Wrench } from 'lucide-react';
import './globals.css';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <html lang="es"><body>
    <main className="onboarding">
      <div className="card">
        <span className="feature-icon"><Wrench/></span>
        <h1>Algo ha fallado</h1>
        <p className="muted">Ha ocurrido un error inesperado al cargar TALLERIA. Puedes intentarlo de nuevo.</p>
        <button className="button primary full" onClick={() => reset()}><RotateCcw size={18}/>Intentar de nuevo</button>
      </div>
    </main>
  </body></html>;
}
