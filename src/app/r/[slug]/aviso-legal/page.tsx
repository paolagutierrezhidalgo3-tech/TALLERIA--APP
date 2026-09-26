import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getSupabase, isSupabaseMode } from '@/lib/supabase/client';
import type { PublicWorkshopInfo } from '@/lib/reception/public-demo';

// Server component, deliberately not reading demo localStorage (unlike
// PublicReceptionPage): demo mode is documented as never holding real data,
// so this generic version ("este taller") is an acceptable trade-off for
// keeping this a plain server page instead of adding client-side state
// just for a name substitution in placeholder legal text.
//
// LEGAL_TAX_ID / LEGAL_CONTACT_EMAIL are server-only (no NEXT_PUBLIC_
// prefix, matching NOTIFICATIONS_FROM_EMAIL's convention) even though their
// values end up in this public page's HTML: nothing here is a secret, they
// just aren't read from any client component. Per-workshop, not stored in
// Supabase -- this app is deployed one Vercel project per pilot workshop,
// so environment variables are an adequate place for identifying data that
// has no other field in the schema yet.
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let workshop: PublicWorkshopInfo | undefined;
  if (isSupabaseMode) {
    const { data } = await getSupabase().rpc('public_workshop_info', { p_slug: slug });
    workshop = (data ?? undefined) as PublicWorkshopInfo | undefined;
  }
  const name = workshop?.name ?? 'este taller';
  const address = workshop?.address;
  const taxId = process.env.LEGAL_TAX_ID?.trim() || undefined;
  const contactEmail = process.env.LEGAL_CONTACT_EMAIL?.trim() || undefined;
  const missing = !taxId && !contactEmail ? 'su NIF/CIF ni un email de contacto'
    : !taxId ? 'su NIF/CIF'
    : !contactEmail ? 'un email de contacto'
    : null;
  return <main className="legal-page">
    <div className="card legal-card">
      <Link className="text-button" href={'/r/' + slug}><ArrowLeft size={16}/>Volver al formulario</Link>
      <h1>Aviso legal y política de privacidad</h1>
      {missing && <p className="notice error" role="alert">
        Este taller todavía no ha configurado {missing} para protección de datos ({!taxId && 'LEGAL_TAX_ID'}{!taxId && !contactEmail && ' / '}{!contactEmail && 'LEGAL_CONTACT_EMAIL'}).
        No debe compartirse este enlace con clientes reales hasta completarlo.
      </p>}
      <h2>1. Responsable del tratamiento</h2>
      <p>
        {name}{taxId ? ', con NIF/CIF ' + taxId : ''}{address ? ', con domicilio en ' + address : ''}, es responsable
        del tratamiento de los datos personales que facilitas en este formulario de recepción digital.
      </p>
      <p>
        Puedes contactar con el taller para cualquier cuestión relacionada con tus datos
        {contactEmail ? <> en <a href={'mailto:' + contactEmail}>{contactEmail}</a></> : ' en el email de contacto que el taller debe indicar aquí'}.
      </p>
      <h2>2. Qué datos recogemos</h2>
      <p>
        A través de este formulario recogemos tu nombre, tu teléfono, los datos del vehículo (marca, modelo y,
        si lo indicas, matrícula), el motivo de tu consulta, tu disponibilidad y cualquier observación que
        añadas, incluida la conversación completa con el asistente digital.
      </p>
      <p>
        No incluyas en los campos de texto libre datos de salud, origen étnico, opiniones políticas o
        religiosas u otras categorías especiales de datos: no son necesarios para gestionar tu consulta.
      </p>
      <h2>3. Finalidad</h2>
      <p>Gestionar tu solicitud: contactar contigo, valorar la intervención sobre tu vehículo y, en su caso, programar una cita.</p>
      <h2>4. Legitimación</h2>
      <p>
        El consentimiento que prestas al marcar la casilla de aceptación antes de enviar el formulario, y la
        ejecución de las medidas precontractuales que solicitas.
      </p>
      <p>
        Este formulario está dirigido a personas mayores de 14 años. Si eres menor de esa edad, pide a tu
        madre, padre o tutor legal que lo envíe por ti.
      </p>
      <h2>5. Destinatarios y encargados del tratamiento</h2>
      <p>
        Tus datos no se ceden a terceros salvo obligación legal. Se almacenan mediante Supabase, encargado del
        tratamiento que aloja la infraestructura técnica en servidores ubicados en la Unión Europea (Irlanda).
      </p>
      <p>
        El personal del taller recibe un aviso por email cuando llega una solicitud nueva; ese aviso se envía a
        través de Resend, un proveedor con sede en Estados Unidos que solo trata las direcciones de correo del
        personal del taller —nunca tus datos como cliente— amparado en cláusulas contractuales tipo aprobadas
        por la Comisión Europea.
      </p>
      <h2>6. Conservación</h2>
      <p>
        Conservamos tus datos mientras exista una relación con el taller y, tras finalizar esta, durante el
        plazo en que puedan derivarse responsabilidades legales de ella (con carácter orientativo, hasta 5-6
        años desde el último contacto), salvo que una norma exija un plazo distinto. El taller debe confirmar
        este plazo con su propia asesoría.
      </p>
      <h2>7. Tus derechos</h2>
      <p>
        Puedes ejercer tus derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad
        {contactEmail ? <> escribiendo a <a href={'mailto:' + contactEmail}>{contactEmail}</a></> : ' contactando directamente con el taller'}.
      </p>
      <p>
        También tienes derecho a presentar una reclamación ante la Agencia Española de Protección de Datos
        (<a href="https://www.aepd.es" target="_blank" rel="noopener noreferrer">www.aepd.es</a>) si consideras
        que el tratamiento no se ajusta a la normativa.
      </p>
      <h2>8. Decisiones automatizadas</h2>
      <p>No se toman decisiones automatizadas ni se elaboran perfiles a partir de tus datos.</p>
    </div>
  </main>;
}
