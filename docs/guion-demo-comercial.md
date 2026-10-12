# Guion de la demo comercial (sin coste)

Duración: 10–12 minutos. Todo con datos ficticios en modo demo: nada se envía a ningún servidor y no hay coste.

## Preparación (una vez, en el portátil de la demo)

1. Arrancar la demo: `NEXT_PUBLIC_DATA_MODE=demo pnpm dev` y abrir `http://localhost:3000`. Si hay una URL de demo publicada, abrir esa (ver «Pendiente» abajo).
2. Pulsar «Explorar demo». Si la demo ya se había usado, «Restablecer demo» deja los datos de ejemplo limpios.
3. Tener dos pestañas: el **panel del taller** y la **recepción pública** (botón «Abrir como cliente» del panel).

## Recorrido

1. **El problema (1 min).** El taller pierde llamadas mientras trabaja y apunta las citas en papel o en WhatsApp.
2. **El panel (2 min).** Dashboard con las solicitudes nuevas, las próximas citas y la actividad. Solicitudes con su estado, clientes y vehículos enlazados.
3. **La recepción del cliente (3 min).** En la pestaña pública, escribir como un cliente:
   - «Hola, soy Marta, tengo un Seat Ibiza 1234BCD y chirrían los frenos»;
   - un teléfono ficticio (600 000 xxx);
   - «el jueves por la tarde», y después elegir una hora.

   El asistente entiende el problema, pregunta lo que falta y ofrece **horas libres reales** del horario del taller. El cliente revisa los datos, acepta el aviso legal y envía.
   - Decirlo claro: en la demo el asistente es **simulado, por reglas y sin IA**, y así lo indica la pantalla. La versión con IA real conversará con más naturalidad, con las mismas garantías.
4. **Llega al taller (2 min).** Volver al panel sin recargar: aparece el aviso «Hay una cita nueva en la agenda». En Citas, la cita lleva «Reservada por el cliente» y la solicitud está en «Cita creada», con la conversación guardada.
5. **Sin duplicados (1 min).** En la recepción, esa hora ya no se ofrece. Desde el calendario tampoco se puede poner otra cita encima.
6. **El taller manda (1 min).** Reprogramar o cancelar la cita, ver el horario y los días especiales, y el formulario guiado como alternativa («Prefiero el formulario guiado»).
7. **Cierre (1 min).** Precio piloto, y qué se activa con la IA real: conversación natural; las reservas, el panel y las comprobaciones son las mismas.

## Mensajes clave

- El cliente reserva solo a una hora que de verdad está libre; nunca hay dobles citas.
- El taller ve todo en un panel, también desde el móvil.
- La IA nunca toca la base de datos: propone, el cliente confirma y el sistema comprueba.

## Pendiente para una demo comercial sin portátil

- **URL de demo pública.** Producción funciona en modo Supabase (alta con cuenta). Para enseñar la demo desde cualquier dispositivo hace falta un despliegue aparte en modo demo, por ejemplo un proyecto o una rama de Vercel con `NEXT_PUBLIC_DATA_MODE=demo`. Gratis en el plan actual, pero es un cambio en la cuenta de Vercel y requiere la decisión de la usuaria.
- **Alta real de talleres.** El correo de Auth solo entrega a miembros de la organización mientras no haya SMTP propio (bloque E). Un taller externo no puede crear su cuenta todavía.
- **Migración 022 en producción**, para que la autorreserva funcione con datos reales (con autorización).
