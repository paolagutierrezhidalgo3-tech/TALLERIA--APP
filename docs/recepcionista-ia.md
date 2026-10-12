# Recepcionista conversacional (IA configurable)

Estado: preparada con un **proveedor simulado (reglas, sin IA)** para DEMO y TEST. El proveedor de IA real (Anthropic) está implementado y probado con la red simulada, pero **apagado**: no hay clave configurada en ningún entorno y no se ha hecho ninguna llamada de pago.

## Qué hace

En el enlace público `/r/<taller>`, el cliente conversa en lenguaje libre. El asistente recoge nombre, teléfono, marca, modelo, matrícula y el problema del vehículo, consulta las horas libres reales y prepara la solicitud. El cliente la revisa, acepta el aviso legal y pulsa enviar: se guarda por `public_intake`, igual que con el formulario guiado.

## Garantías de seguridad

- **La IA no escribe nunca.** Solo tiene dos herramientas, las ejecuta el servidor y ninguna escribe:
  - `check_availability`: solo lectura, mediante `public_availability` del taller de la conversación;
  - `propose_request`: valida los datos y comprueba que la hora siga ofrecida; no guarda nada.
- **La reserva la hace el cliente.** Pulsa el botón y la recibe `public_intake`, que vuelve a comprobar la hora con el bloqueo del taller (sin duplicados, con el tope diario de autorreservas). Una hora inventada por el modelo se rechaza dos veces.
- **El servidor usa el cliente anónimo de Supabase**, con los mismos permisos que el navegador del visitante. Nunca usa la clave secreta. El slug lo fija la conversación, no el modelo.
- **El historial que envía el navegador no se da por bueno:** se comprueba su forma y su tamaño (20 mensajes del cliente, 2000 caracteres cada uno). Falsificarlo solo engaña a la propia propuesta del visitante, que se revisa antes de enviar.
- **Si algo falla, el formulario guiado de siempre:** el asistente apagado, un error del proveedor, el límite diario alcanzado, una ráfaga de peticiones o un bucle de herramientas.
- **Etiquetado honesto.** El simulado se muestra como «Asistente de prueba · Simulado · sin IA». El real, como «Recepcionista con IA», con aviso de que puede equivocarse.

## Activación (variables del servidor; ver `.env.example`)

| Modo | Variables | Coste |
| --- | --- | --- |
| Apagada (por defecto, producción hoy) | `RECEPTIONIST_PROVIDER` vacía | — |
| Simulada (DEMO/TEST) | `RECEPTIONIST_PROVIDER=simulated` | ninguno |
| IA real | `RECEPTIONIST_PROVIDER=anthropic` + `RECEPTIONIST_ANTHROPIC_API_KEY` + `RECEPTIONIST_DAILY_CALL_LIMIT` > 0 + `RECEPTIONIST_SPEND_LIMIT_SET=true` | de pago |

En modo IA, si falta la clave o el límite, la recepcionista queda **apagada**: nunca pasa al simulado. En la demo local (sin Supabase), el simulado corre en el navegador y nunca hay modelo real.

## Control de presupuesto (IA real)

1. **Límite de gasto en la consola del proveedor.** Es el techo real, común a todas las instancias. La IA no se activa sin `RECEPTIONIST_SPEND_LIMIT_SET=true`, con lo que el operador confirma que lo ha configurado.
2. **`RECEPTIONIST_DAILY_CALL_LIMIT`:** llamadas al modelo por día y por instancia del servidor. Es un freno contra bucles y ráfagas, no un presupuesto exacto: va en memoria.
3. **Por respuesta y por conversación:**
   - `RECEPTIONIST_MAX_OUTPUT_TOKENS` (400 por defecto, máximo 1024);
   - como mucho 4 llamadas al modelo por mensaje del cliente;
   - 20 mensajes del cliente por conversación;
   - 40 peticiones cada 10 minutos por dirección;
   - cuerpo de la petición de 100 KB como máximo, historial de 64 KB y 2000 caracteres por argumento de herramienta.
4. **Pendiente antes de un uso real:**
   - un contador persistente de llamadas y conversaciones por taller y día (requiere una migración);
   - medir el consumo real de tokens en TEST para estimar el coste por conversación.

## Pendiente para activar la IA real

- Autorización y presupuesto de la usuaria, cuenta en el proveedor con límite de gasto y clave en las variables del servidor (Vercel). La clave nunca va en el repositorio.
- Actualizar el aviso legal y la política de privacidad: los mensajes del cliente se envían a un proveedor de IA, que actúa como encargado del tratamiento, con transferencia internacional.
- Probar en TEST con conversaciones reales de ejemplo y ajustar las instrucciones del sistema (`src/lib/receptionist/anthropic.ts`).

## Archivos

- `src/lib/receptionist/agent.ts`: contrato, herramientas, bucle y límites.
- `src/lib/receptionist/simulated.ts`: reglas.
- `src/lib/receptionist/anthropic.ts`: proveedor real.
- `src/lib/receptionist/config.ts`: activación, presupuesto y limitador.
- `src/lib/receptionist/handler.ts` y `src/app/api/receptionist/route.ts`: endpoint.
- `src/components/assistant-reception.tsx`: interfaz.
