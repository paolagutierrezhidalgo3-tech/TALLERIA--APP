import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { TERMS_VERSION } from '@/lib/terms';

export const metadata: Metadata = { title: 'Términos de servicio · TALLERIA' };

// Terms between whoever operates TALLERIA and the workshops that sign up,
// including the data processing agreement (RGPD art. 28) for the workshop's
// own customers' data. Same pattern as the public reception's legal notice:
// the operator's identity comes from server-only env vars, and while any of
// them is missing the page says so instead of naming anyone. Every
// processor and measure listed here must match what the code really does --
// don't add promises (self-service deletion, retention jobs, locations)
// that the app or its providers don't actually back.
export default function Page() {
  const name = process.env.OPERATOR_NAME?.trim() || undefined;
  const taxId = process.env.OPERATOR_TAX_ID?.trim() || undefined;
  const contactEmail = process.env.OPERATOR_CONTACT_EMAIL?.trim() || undefined;
  const missing = [!name && 'OPERATOR_NAME', !taxId && 'OPERATOR_TAX_ID', !contactEmail && 'OPERATOR_CONTACT_EMAIL'].filter(Boolean).join(' / ');
  const contact = contactEmail ? <a href={'mailto:' + contactEmail}>{contactEmail}</a> : 'el email de contacto del operador, pendiente de indicar aquí';
  return <main className="legal-page">
    <div className="card legal-card">
      <Link className="text-button" href="/"><ArrowLeft size={16}/>Volver a TALLERIA</Link>
      <h1>Términos de servicio</h1>
      <p>Versión {TERMS_VERSION}. Incluyen el encargo del tratamiento de los datos de los clientes de tu taller.</p>
      {missing && <p className="notice error" role="alert">
        Términos pendientes de completar: todavía no se ha identificado a quien opera TALLERIA ({missing}).
        Este texto es provisional y no debe usarse con talleres ni clientes reales hasta completarlo y revisarlo.
      </p>}
      <h2>1. Quién presta el servicio</h2>
      <p>
        TALLERIA es un servicio prestado por {name ?? 'su operador, pendiente de identificar'}
        {taxId ? ', con NIF/CIF ' + taxId : ''}. Puedes contactar con el operador en {contact}.
      </p>
      <h2>2. Qué es TALLERIA</h2>
      <p>
        Una herramienta para que tu taller reciba y organice consultas de sus clientes (registro manual y
        recepción digital pública), y gestione clientes, vehículos, solicitudes, citas, horarios y su equipo.
        No incluye pagos, facturación, presupuestos, mensajería por WhatsApp ni asistentes de inteligencia
        artificial: la recepción digital es un formulario guiado.
      </p>
      <p>
        Durante la fase piloto el servicio se ofrece de forma gratuita y tal como está, sin garantía de
        disponibilidad continua.
      </p>
      <h2>3. Tu cuenta y tu equipo</h2>
      <p>
        Quien crea el taller es su responsable dentro de TALLERIA y decide a quién invita a su equipo. Cada
        persona es responsable de mantener seguras sus credenciales de acceso.
      </p>
      <h2>4. Uso aceptable</h2>
      <p>
        Usa TALLERIA solo para gestionar la relación de tu taller con sus clientes. No introduzcas datos de
        salud u otras categorías especiales de datos, y no compartas el enlace de recepción digital con
        clientes reales hasta que el aviso legal de tu taller esté completo.
      </p>
      <h2>5. Datos de los clientes de tu taller (encargo del tratamiento)</h2>
      <p>
        Tu taller es el responsable del tratamiento de los datos de sus clientes: nombre, teléfono,
        observaciones, datos de sus vehículos (marca, modelo y matrícula), solicitudes, conversaciones de la
        recepción y citas. El operador de TALLERIA los trata como encargado del tratamiento, únicamente para
        prestarte este servicio y siguiendo tus instrucciones, que son las que das al usar la aplicación.
      </p>
      <p>
        Lo mismo se aplica a los datos de tu equipo que se gestionan en la aplicación: las direcciones de
        email, roles y fechas de alta de sus miembros, las invitaciones que envíes (incluidas las que nadie
        llegue a aceptar) y el registro de actividad del taller, que identifica a cada persona por su email.
        Tu taller es el responsable de esos datos y el operador los trata como encargado.
      </p>
      <p>El operador se compromete a:</p>
      <ul>
        <li>No usar esos datos para ninguna finalidad propia ni cederlos a terceros salvo obligación legal.</li>
        <li>Garantizar la confidencialidad de las personas autorizadas a tratarlos.</li>
        <li>
          Mantener las medidas de seguridad del servicio: separación de los datos de cada taller, acceso
          solo para las personas de tu equipo según su rol, registro de las operaciones relevantes y
          conexiones cifradas.
        </li>
        <li>
          Ayudarte a atender los derechos de tus clientes. La aplicación permite anonimizar el nombre, el
          teléfono y las observaciones de la ficha de un cliente y borrar las matrículas de sus vehículos,
          pero el texto de sus conversaciones y solicitudes puede conservarse; si hace falta suprimirlo, el
          operador te ayudará a hacerlo.
        </li>
        <li>Informarte sin dilación indebida si se produce una brecha de seguridad que afecte a esos datos.</li>
        <li>
          Al terminar el servicio, devolverte o suprimir esos datos, según elijas, salvo que la ley obligue a
          conservarlos.
        </li>
      </ul>
      <h2>6. Subencargados</h2>
      <p>Para prestar el servicio, el operador recurre a estos proveedores:</p>
      <ul>
        <li>Supabase: base de datos y autenticación, con los datos alojados en la Unión Europea (Irlanda).</li>
        <li>Vercel: alojamiento y ejecución de la aplicación web.</li>
        <li>
          Resend: envío del aviso por email de solicitudes nuevas al equipo del taller. Solo recibe las
          direcciones de correo del equipo y el nombre del taller, nunca los datos de tus clientes.
        </li>
        <li>
          Sentry: monitorización de errores de la aplicación. Recibe información técnica de los errores que
          se producen, sin grabación de sesiones ni trazas de rendimiento.
        </li>
      </ul>
      <p>
        La ubicación de los servidores de Vercel y Sentry, y las garantías aplicables a una posible
        transferencia internacional de datos, están pendientes de confirmar por el operador antes de usar el
        servicio con talleres reales. El operador te informará de cualquier cambio de subencargados.
      </p>
      <h2>7. Responsabilidad</h2>
      <p>
        El operador responde del servicio en los términos que establezca la ley. Tu taller es responsable de
        los datos que introduce y de informar a sus clientes a través de su aviso legal.
      </p>
      <h2>8. Baja</h2>
      <p>
        Puedes dejar de usar TALLERIA en cualquier momento. Para dar de baja tu cuenta y tu taller, escribe a
        {' '}{contact}; la aplicación todavía no permite hacerlo por tu cuenta.
      </p>
      <h2>9. Cambios en estos términos</h2>
      <p>
        Si estos términos cambian, se publicará una nueva versión con su fecha y podrá pedirse que la aceptes
        de nuevo para seguir usando el servicio.
      </p>
      <h2>10. Ley aplicable</h2>
      <p>Estos términos se rigen por la legislación española.</p>
    </div>
  </main>;
}
