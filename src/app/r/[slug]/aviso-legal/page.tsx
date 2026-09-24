import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getSupabase, isSupabaseMode } from '@/lib/supabase/client';
import type { PublicWorkshopInfo } from '@/lib/reception/public-demo';

// Server component, deliberately not reading demo localStorage (unlike
// PublicReceptionPage): demo mode is documented as never holding real data,
// so this generic version ("este taller") is an acceptable trade-off for
// keeping this a plain server page instead of adding client-side state
// just for a name substitution in placeholder legal text.
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let workshop: PublicWorkshopInfo | undefined;
  if (isSupabaseMode) {
    const { data } = await getSupabase().rpc('public_workshop_info', { p_slug: slug });
    workshop = (data ?? undefined) as PublicWorkshopInfo | undefined;
  }
  const name = workshop?.name ?? 'este taller';
  const address = workshop?.address;
  return <main className="legal-page">
    <div className="card legal-card">
      <Link className="text-button" href={'/r/' + slug}><ArrowLeft size={16}/>Volver al formulario</Link>
      <h1>Aviso legal y protección de datos</h1>
      <p className="muted">
        Esta página es una plantilla orientativa, no un texto legal revisado por un profesional.
        Antes de publicarla para clientes reales, {name} debe adaptarla a su situación concreta.
      </p>
      <h2>1. Responsable del tratamiento</h2>
      <p>{name}{address ? ', con domicilio en ' + address : ''} es responsable del tratamiento de los datos personales que facilitas en este formulario de recepción digital.</p>
      <h2>2. Finalidad</h2>
      <p>Gestionar tu solicitud: contactar contigo, valorar la intervención sobre tu vehículo y, en su caso, programar una cita.</p>
      <h2>3. Legitimación</h2>
      <p>El consentimiento que prestas al marcar la casilla de aceptación antes de enviar el formulario, y la ejecución de las medidas precontractuales que solicitas.</p>
      <h2>4. Destinatarios</h2>
      <p>Tus datos no se ceden a terceros salvo obligación legal. Se almacenan mediante Supabase, encargado del tratamiento que aloja la infraestructura técnica.</p>
      <h2>5. Conservación</h2>
      <p>Se conservan mientras exista una relación con el taller y, después, durante los plazos legalmente exigibles.</p>
      <h2>6. Tus derechos</h2>
      <p>Puedes ejercer tus derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad contactando directamente con el taller.</p>
    </div>
  </main>;
}
