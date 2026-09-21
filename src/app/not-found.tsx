import Link from 'next/link';
import { ArrowRight, Wrench } from 'lucide-react';

export default function NotFound() {
  return <main className="onboarding">
    <div className="card">
      <span className="feature-icon"><Wrench/></span>
      <h1>No encontramos esta página</h1>
      <p className="muted">Puede que el enlace haya caducado o esté escrito mal. Vuelve al panel de tu taller.</p>
      <Link className="button primary full" href="/">Volver al inicio<ArrowRight size={18}/></Link>
    </div>
  </main>;
}
