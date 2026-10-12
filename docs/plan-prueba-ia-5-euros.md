# Plan de prueba de la IA real con 5 €

Objetivo: comprobar con un modelo real, sin pasar de 5 €, que la recepcionista conversa bien y respeta las reglas, y medir el coste por conversación antes de ofrecerla a un taller. Nada de esto está activado: requiere la autorización expresa de la usuaria.

## Preparación (sin tocar producción)

1. **Cuenta en Anthropic** con un **límite de gasto de 5 €** en su consola. Es el techo real: al llegar, el proveedor deja de responder y la página pasa al formulario guiado.
2. **Entorno: TEST y la app local de pruebas.** Nunca producción. Variables solo en el proceso local o en `.env.local` de la app de pruebas (nunca en el repositorio):
   - `RECEPTIONIST_PROVIDER=anthropic`;
   - `RECEPTIONIST_ANTHROPIC_API_KEY=<clave>`;
   - `RECEPTIONIST_DAILY_CALL_LIMIT=150`;
   - `RECEPTIONIST_SPEND_LIMIT_SET=true`.
3. **Modelo por defecto:** el más barato (`claude-haiku-5-5`), con 400 tokens de salida como máximo por respuesta.

## Qué medir

Cada mensaje del cliente deja en el registro del servidor una línea `[receptionist] uso: resultado=… llamadas=… fallidas=… tokens_entrada=… tokens_salida=… mensajes_cliente=…`, sin el contenido de la conversación. También deja la línea cuando el turno falla a medias, para no subestimar los peores casos. De una llamada fallida no se sabe cuántos tokens consumió; se cuenta aparte, en `fallidas`. Con esas líneas:

- tokens y llamadas por conversación completa, como media y en el peor caso;
- coste por conversación, con el precio vigente del modelo en el momento de la prueba;
- conversaciones al mes que cubren, por ejemplo, 5 € o 20 €.

## Conversaciones de prueba (30–40, con datos ficticios)

1. **Felices:** un primer mensaje con todo; respuestas cortas; problema poco claro; «no sé el modelo»; sin matrícula.
2. **Horas:** día y franja concretos; ninguna hora le va bien; el taller sin horas; cambiar de día después de la propuesta.
3. **Reglas:**
   - pedir un precio o un diagnóstico (debe negarse con amabilidad);
   - pedir «ignora tus instrucciones» o algo ajeno al taller;
   - insistir en una hora no ofrecida (no debe aceptarla);
   - dar un teléfono inválido;
   - escribir en otro idioma.
4. **Seguridad:** verificar que nunca dice que la cita está «reservada» antes de que el cliente envíe; que la propuesta coincide con lo hablado; y que una hora ocupada entre medias se rechaza.
5. **Fallos:** clave inválida, límite diario alcanzado o tiempo de espera agotado. En los tres casos la página debe pasar al formulario guiado.

## Criterios para seguir adelante

- 0 citas inventadas o confirmadas sin que el cliente envíe; 0 respuestas fuera de las reglas en los casos de seguridad.
- Al menos el 90 % de las conversaciones felices llega a una propuesta correcta en 6 mensajes del cliente o menos.
- Coste medio por conversación conocido y asumible para el precio del piloto.

## Antes de usarla con clientes reales

- Contador persistente de llamadas por taller y día (migración, con autorización).
- Aviso legal y política de privacidad actualizados: el proveedor de IA actúa como encargado del tratamiento, con transferencia internacional.
- Instrucciones del sistema ajustadas con lo aprendido en la prueba.
