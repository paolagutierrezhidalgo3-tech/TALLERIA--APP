'use client';
import { ArrowRight, CalendarCheck, CalendarDays, Check, ClipboardList, MessageSquare, PhoneOff, Smartphone, Wrench } from 'lucide-react';

// Landing page of the public demo (demo mode only; production keeps its
// login screen). Everything it claims exists today: no testimonials, no
// figures, no features that aren't built. The sample workshop's public link
// works on its own (it creates the same sample demo), so "Probar como
// cliente" can be a plain link.
const SAMPLE_RECEPTION = '/r/taller-motor-norte';
// Optional contact for workshops interested in a pilot; without it the
// call to action is simply not shown (never an invented address).
const contactEmail = process.env.NEXT_PUBLIC_DEMO_CONTACT_EMAIL?.trim() ?? '';

export function DemoLanding({ onDemo }: { onDemo: () => void }) {
  const ctas = <div className="landing-ctas">
    <button className="button primary" onClick={onDemo}>Ver el panel del taller<ArrowRight size={17}/></button>
    <a className="button" href={SAMPLE_RECEPTION} target="_blank" rel="noopener noreferrer"><Smartphone size={16}/>Probar como cliente</a>
  </div>;
  return <main className="landing">
    <header className="landing-header">
      <div className="brand"><span className="brand-mark"><Wrench size={20}/></span>TALLERIA<span className="brand-dot">.</span></div>
      <span className="mode-chip"><span/>Demo con datos ficticios</span>
    </header>

    <section className="landing-hero">
      <div>
        <span className="eyebrow">RECEPCIÓN DIGITAL PARA TALLERES MECÁNICOS</span>
        <h1>Tus clientes piden cita solos.<br/><em>Tú sigues con el coche.</em></h1>
        <p className="landing-lead">TALLERIA atiende a tus clientes por un enlace web: recoge sus datos, los del vehículo y lo que le pasa, les ofrece tus horas libres reales y te lo deja todo ordenado en un panel.</p>
        {ctas}
        <p className="landing-note">Dos minutos, sin registrarte. Los datos son ficticios y se guardan solo en tu navegador.</p>
      </div>
      <div className="landing-preview" aria-hidden="true">
        <div className="preview-chat">
          <small>CLIENTE</small><p>Hola, tengo un Seat Ibiza y chirrían los frenos. ¿Tenéis hueco el jueves?</p>
        </div>
        <div className="preview-chat assistant">
          <small>RECEPCIÓN DIGITAL</small><p>Tengo libre el jueves a las 16:00, 17:00 o 18:00. ¿Cuál te viene mejor?</p>
        </div>
        <div className="preview-booking"><CalendarCheck size={18}/><div><b>Jueves, 16:00 · Seat Ibiza</b><small>Reservada por el cliente · en tu agenda</small></div></div>
      </div>
    </section>

    <section className="landing-section">
      <h2>Pensado para el día a día de un taller pequeño</h2>
      <div className="landing-grid">
        <article><span className="feature-icon"><PhoneOff size={22}/></span><h3>Menos llamadas a mitad de una reparación</h3><p>El cliente cuenta qué necesita por tu enlace, a cualquier hora, sin que tengas que soltar la herramienta.</p></article>
        <article><span className="feature-icon"><CalendarDays size={22}/></span><h3>Citas sin solapes</h3><p>Solo se ofrecen horas libres de tu horario. Una hora ya ocupada en un puesto no se vuelve a ofrecer, y tampoco puedes poner otra cita encima en ese mismo puesto. Con varios puestos, cada uno lleva su propia agenda.</p></article>
        <article><span className="feature-icon"><ClipboardList size={22}/></span><h3>Todo en un mismo sitio</h3><p>Cliente, vehículo, avería, conversación y cita juntos, en un panel que también funciona en el móvil.</p></article>
      </div>
    </section>

    <section className="landing-section">
      <h2>Cómo funciona</h2>
      <ol className="landing-steps">
        <li><span>1</span><div><b>Compartes tu enlace</b><p>En tu web, en Google, en WhatsApp o en un cartel del taller.</p></div></li>
        <li><span>2</span><div><b>El cliente cuenta qué le pasa y elige hora</b><p>Le pedimos lo necesario y le ofrecemos tus huecos libres. Si ninguno le va bien, deja su disponibilidad.</p></div></li>
        <li><span>3</span><div><b>Te llega ordenado al panel</b><p>Con aviso en el panel de cada solicitud o cita nueva. Tú decides: mover, completar o cancelar la cita.</p></div></li>
      </ol>
    </section>

    <section className="landing-section landing-included">
      <h2>Qué incluye hoy</h2>
      <ul>
        {['Enlace de recepción para tus clientes, sin instalar nada', 'Reserva en tus horas libres reales, sin dobles citas en el mismo puesto', 'Panel con solicitudes, clientes, vehículos y conversaciones', 'Agenda en lista y en calendario, con horarios y días especiales', 'Acceso para tu equipo (propietario y personal)', 'Avisos en el panel de solicitudes y citas nuevas'].map(item => <li key={item}><Check size={16}/>{item}</li>)}
      </ul>
      <p className="landing-note"><MessageSquare size={14}/> En esta demo, la recepción es un asistente simulado (por reglas, sin inteligencia artificial) para que puedas probarla sin coste.</p>
    </section>

    <section className="landing-final">
      <h2>Pruébalo ahora como lo vivirían tú y tu cliente</h2>
      <p>Abre la recepción como cliente, reserva una hora y vuelve al panel: la verás llegar.</p>
      {ctas}
      {contactEmail && <p className="landing-contact">¿Quieres usarlo en tu taller? <a href={'mailto:' + contactEmail + '?subject=' + encodeURIComponent('Quiero probar TALLERIA en mi taller')}>Escríbenos</a></p>}
    </section>

    <footer className="landing-footer"><small>TALLERIA · Demo con datos ficticios. Los cambios se guardan únicamente en este navegador.</small><a className="text-button" href="/terminos">Términos</a></footer>
  </main>;
}
