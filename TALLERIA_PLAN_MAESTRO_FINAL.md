# TALLERIA — Plan maestro persistente

> Documento de continuidad para Claude Code. Leer al iniciar o retomar el proyecto y actualizar al cerrar cada bloque significativo.
>
> Fecha de actualización documental: 24 de septiembre de 2026.
> Repositorio: `paolagutierrezhidalgo3-tech/TALLERIA--APP`.
> Prioridad actual: terminar horarios estructurados, validarlos y cerrar el bloque mediante el flujo Claude → Codex → correcciones → commit/push → actualización del plan.

## 1. Propósito y fuentes

Mantener en el repositorio el estado del producto, la arquitectura, las decisiones confirmadas, las migraciones, el trabajo en curso y el roadmap para que Claude Code pueda continuar sin depender del historial del chat.

Esta versión conserva la estructura útil del plan original y la corrige con el estado expresamente confirmado por el usuario. Sustituye sus advertencias obsoletas sobre arquitectura, funciones y migraciones 001–007 desconocidas.

**Regla de lectura:** «confirmado» representa el estado aportado por el usuario; «en curso» no equivale a terminado. Esta actualización documental no constituye una nueva ejecución de pruebas ni una nueva inspección del repositorio o de Supabase. Al retomar, contrastar los cambios posteriores con el checkpoint y registrar cualquier divergencia concreta, sin volver a tratar toda la línea base como desconocida.

No inventar commits, resultados de pruebas, despliegues ni cierres de fases. La numeración del roadmap de este documento organiza la continuidad operativa; no pretende reconstruir una numeración histórica del chat.

## 2. Resumen del estado actual

| Área | Estado confirmado | Continuidad |
| --- | --- | --- |
| Producto | SaaS multi-tenant para gestión de talleres | Preservar el aislamiento entre talleres |
| Stack | Next.js + React + TypeScript + Tailwind | Integrarse con la arquitectura existente |
| Datos y autenticación | Supabase / PostgreSQL / Auth | Mantener autorización y reglas efectivas en la capa de datos |
| Modos | Demo/local y Supabase | Distinguir validación local de verificación real |
| Funciones existentes | Panel y gestión operativa, equipo, auth y Recepción Digital pública | Inventario en la sección 4 |
| Migraciones 001–005 | Aplicadas previamente en Supabase real | No reaplicarlas por rutina |
| Migración 006 | Aplicada manualmente y verificada mediante flujo real | Conservar el flujo público sin cuenta |
| Migración 007 | Aplicada mediante script seguro y verificada en Supabase real | Mantener consentimiento obligatorio en recepción pública |
| Horarios estructurados | Claude los está implementando | Completar persistencia, bloqueo efectivo y UI owner |
| Recuperación de contraseña | Función existente; prueba manual completa pendiente | Verificar el recorrido completo antes de darlo por validado |
| Despliegue Vercel | Aún no desplegado | Preparación operativa posterior a horarios |

### Decisiones de producto confirmadas

- Horario semanal configurable **por taller**.
- Excepciones por fecha, incluidos festivos.
- Los horarios deben **restringir realmente las citas**.
- El **owner** debe editar horarios y excepciones desde **Configuración** dentro del bloque actual.
- Después: notificaciones/email y preparación operativa/despliegue; pulido visual/UX más adelante.

La existencia de Supabase real y de flujos verificados no implica que la aplicación esté desplegada en Vercel.

## 3. Arquitectura: conservar e integrar

| Elemento | Línea base confirmada |
| --- | --- |
| Repositorio | `paolagutierrezhidalgo3-tech/TALLERIA--APP` |
| Aplicación | Next.js, React, TypeScript y Tailwind |
| Plataforma de datos | Supabase con PostgreSQL |
| Autenticación | Supabase Auth |
| Modelo de producto | SaaS multi-tenant |
| Modos de ejecución | Demo/local y Supabase |
| Roles | `owner` y `staff` |
| Operativa de citas | Recursos/capacidad y bloqueo de solapamientos por recurso |
| Robustez | Auditoría, paginación, búsqueda sin tildes y control de concurrencia/versiones |

Integrar el trabajo nuevo con los patrones existentes. Antes de editar, localizar las rutas, componentes, servicios, consultas y validaciones correspondientes en el código. No inventar rutas, tablas adicionales, versiones de dependencias ni comandos que no se hayan leído en el repositorio.

Comprobar el taller activo y los permisos en las operaciones que acceden a datos. Ocultar controles en la interfaz no sustituye la autorización efectiva. Mantener el aislamiento multi-tenant y el control de concurrencia al añadir horarios.

Los detalles de zona horaria, duración y estados de citas deben extraerse del modelo existente y quedar documentados al cerrar horarios. No reescribir la arquitectura ni rehacer funciones existentes para completar este plan.

## 4. Funcionalidades existentes y revisiones realizadas

### Inventario confirmado

| Área | Funciones existentes |
| --- | --- |
| Gestión principal | Dashboard, solicitudes, clientes y vehículos |
| Seguimiento y agenda | Conversaciones y citas |
| Administración | Configuración, equipo/staff e invitaciones |
| Acceso | Autenticación y recuperación de contraseña |
| Entrada de solicitudes | Recepción Digital pública y registro manual |
| Capacidad | Recursos/capacidad y bloqueo de solapamientos por recurso |
| Permisos y trazabilidad | Roles `owner`/`staff` y auditoría |
| Consulta y consistencia | Paginación, búsqueda sin tildes y concurrencia/versiones |

Este inventario confirma funciones existentes; no atribuye a cada una un commit o una prueba que no se haya documentado. En particular, la prueba manual completa de recuperación de contraseña sigue pendiente.

### Revisiones independientes de Codex

Codex ya realizó varias rondas adversariales sobre equipo, autenticación y recepción pública. Se corrigieron problemas relevantes relacionados con:

- Autorización y límites de miembros.
- Concurrencia de invitaciones y casos de email nulo.
- Manejo de sesión y recuperación de la carga del equipo.
- Privacidad de matrículas y rate limiting.
- Casos de recepción pública.

Preservar esas correcciones y revisar regresiones cuando un cambio afecte a esas áreas. Este historial no equivale a una garantía absoluta de ausencia de defectos ni sustituye la revisión del nuevo bloque de horarios.

## 5. Migraciones 001–007 y Supabase real

**Las migraciones 001–007 están aplicadas en Supabase real según el estado confirmado.** No quedan pendientes de aplicación por falta de contexto documental.

| Migración | Nombre | Estado en Supabase real y evidencia confirmada |
| --- | --- | --- |
| 001 | `initial` | Aplicada previamente |
| 002 | `capacity_security` | Aplicada previamente |
| 003 | `paged_workspace` | Aplicada previamente |
| 004 | `search_versions` | Aplicada previamente |
| 005 | `team_management` | Aplicada previamente |
| 006 | `public_reception` | Aplicada manualmente en SQL Editor; verificada mediante el flujo real descrito abajo |
| 007 | `public_consent` | Aplicada posteriormente mediante script seguro; verificada en Supabase real |

Los identificadores y nombres anteriores son los confirmados. Consultar el repositorio para las rutas y los nombres completos de archivo; no inferirlos.

### Recepción pública: migración 006

Se verificó el recorrido real:

**Cliente sin cuenta → enlace público → recepción → Supabase → solicitud visible en el panel.**

Commit/push confirmado de la fase de recepción pública: **`fb8e6ca`**. No atribuirle automáticamente la migración 007 ni el trabajo de horarios. No se documentan otros hashes sin evidencia.

### Consentimiento: migración 007

- Añade `requests.consent_at`.
- Sustituye `public_intake` por una firma de **7 argumentos**.
- Exige consentimiento para la recepción pública.
- Los registros históricos mantienen `consent_at = null`.

No rellenar fechas de consentimiento retroactivamente ni interpretar un valor histórico nulo como prueba de consentimiento. No extender por suposición la obligación del flujo público a otros recorridos sin revisar su contrato y alcance. Al cambiar recepción pública, preservar la firma vigente y la exigencia efectiva de consentimiento.

### Conexión automatizada existente

La conexión a Supabase real utiliza la variable de entorno **`TALLERIA_DB_URL`**, **Session Pooler**, los scripts **`db-query.mjs` / `apply-migration.mjs`** y una **CA TLS fijada**.

Usar los mecanismos existentes sin debilitar la validación TLS. Este documento solo registra nombres y mecanismos: no debe contener valores de variables, cadenas de conexión, credenciales, tokens ni secretos. No imprimirlos en logs, capturas o mensajes.

### Regla estricta para nuevas migraciones

**Ninguna nueva migración se aplica a Supabase real sin confirmación explícita del usuario para esa operación, aunque exista conexión automatizada.** Implementar código, preparar SQL, disponer de credenciales o ejecutar checks no concede ese permiso. Las autorizaciones históricas de 006/007 no autorizan migraciones futuras.

1. Leer el esquema y las migraciones existentes antes de preparar cambios; comprobar el siguiente identificador disponible.
2. Preparar y revisar la migración, con su finalidad, entorno de destino, efectos y estrategia de recuperación.
3. Completar las validaciones posibles sin modificar Supabase real y dejar el cambio concreto listo para revisión.
4. Solicitar la confirmación explícita del usuario antes de aplicarlo al entorno real.
5. Solo después de recibirla, aplicar mediante el mecanismo seguro existente, verificar y actualizar este registro.

No reejecutar migraciones a ciegas, modificar retrospectivamente migraciones aplicadas ni resetear el entorno real. Si una comprobación posterior revela una divergencia, documentarla de forma concreta; no sustituir el historial confirmado por una declaración genérica de desconocimiento.

## 6. Bloque en curso: horarios estructurados

### Alcance acordado

Claude está implementando horario semanal por taller, excepciones/festivos, bloqueo real de citas fuera de horario y UI de edición para owner en Configuración. **El bloque está en curso; no consta un cierre confirmado.**

### Trabajo y criterios de aceptación

- **Persistencia:** horarios y excepciones asociados al taller correcto e integrados con el modelo existente.
- **Configuración:** el owner puede consultar, editar y guardar con validaciones y mensajes comprensibles. La UI pertenece a este bloque.
- **Autorización:** impedir modificaciones por usuarios sin permiso y accesos cruzados entre talleres.
- **Restricción efectiva:** validar creación y reprogramación de citas en la capa que garantiza la regla de negocio, además de la interfaz.
- **Duración:** la cita completa debe caber en el intervalo permitido según el modelo real.
- **Excepciones:** establecer y probar su precedencia respecto al horario semanal.
- **Capacidad:** mantener los bloqueos existentes de solapamientos por recurso y el control de concurrencia.
- **Modos:** comprobar el comportamiento correspondiente en demo/local y Supabase, indicando qué se ha probado en cada uno.
- **Entrega:** registrar cualquier dependencia de una nueva migración cuya aplicación real siga pendiente de autorización.

### Detalles que deben quedar resueltos en el bloque

Buscar las decisiones ya presentes en el código o el checkpoint. Si no están definidas, concretar las reglas necesarias sin ampliar el producto:

- Zona horaria del taller y cambios de hora.
- Una o varias franjas por día, descansos y tratamiento de cruces de medianoche.
- Días cerrados y límites exactos de apertura/cierre.
- Comportamiento cuando aún no hay horario configurado.
- Efecto de editar horarios sobre citas existentes: no cancelarlas ni alterarlas silenciosamente.
- Tipos de excepción y tratamiento de duplicados o incompatibilidades.

### Validación específica

Cubrir citas dentro y fuera del horario, citas que terminan después del cierre, días cerrados, festivos, excepciones, reprogramación, persistencia tras recargar, permisos owner/staff y aislamiento entre talleres. Comprobar regresiones de capacidad/solapamientos y concurrencia. Añadir casos de límites temporales y franjas múltiples según las reglas admitidas.

## 7. Fases y roadmap operativo

| Fase | Estado | Alcance y condición de avance |
| --- | --- | --- |
| A. Base funcional y robustez | Existente, con revisiones y correcciones realizadas | Funciones de la sección 4 y migraciones 001–005 aplicadas; preservar lo construido |
| B. Recepción Digital pública y consentimiento | Aplicada y verificada en Supabase real | 006 y 007; flujo público real y consentimiento obligatorio; `fb8e6ca` confirmado para recepción pública |
| C. Horarios estructurados | **En curso — prioridad actual** | Semanal + excepciones/festivos + bloqueo real + UI owner; completar checks, revisión y cierre |
| D. Notificaciones/email y preparación operativa/despliegue | Posterior a horarios | Concretar un bloque acotado, completar pruebas operativas y preparar el despliegue; Vercel aún no desplegado |
| E. Pulido visual y UX | Después de la preparación operativa | Mejorar claridad, consistencia y facilidad de uso sobre funciones estables |

### Próximas acciones en orden

1. Revisar el trabajo actual de Claude y completar horarios sin duplicar cambios en curso.
2. Ejecutar tests/typecheck/lint/build, obtener revisión independiente de Codex y corregir bloqueantes.
3. Si hay una nueva migración, obtener confirmación explícita antes de aplicarla a Supabase real y verificarla después. Distinguir cierre del código de activación real.
4. Hacer commit/push y actualizar este plan con evidencia y pendientes reales.
5. Abordar notificaciones/email y preparación operativa/despliegue. Incluir la prueba manual completa pendiente de recuperación de contraseña y documentar su resultado.
6. Realizar el pulido visual/UX después.

El detalle de proveedores, canales de notificación, configuración de despliegue y criterios operativos se concretará en su bloque. No considerar esas capacidades implementadas ni desplegadas por aparecer en el roadmap.

## 8. Flujo obligatorio: Claude → Codex → correcciones → commit/push

1. **Claude implementa** un bloque acotado. Lee las instrucciones del repositorio y el checkpoint, inspecciona los cambios existentes y preserva el trabajo ajeno.
2. **Claude valida:** tests, typecheck, lint y build con los comandos reales del repositorio. Registrar los resultados; si un comando falta o falla, explicar la limitación sin inventar un resultado satisfactorio.
3. **Codex realiza una revisión independiente de los bloques importantes**, especialmente base de datos, autorización, aislamiento entre talleres, autenticación, recepción pública y reglas de citas. Facilitar objetivo, diff, checks y migraciones implicadas sin secretos.
4. **Claude corrige los bloqueantes** y repite los checks afectados. Pedir verificación adicional cuando haya cambios sustanciales o riesgos relevantes pendientes.
5. **Commit/push** del bloque validado, sin secretos ni cambios ajenos. Registrar por separado si el commit existe y si el push se ha completado.
6. **Actualizar el plan y el checkpoint** con el estado real, la evidencia y el próximo paso exacto. Mantener la actualización versionada para nuevas sesiones.

### Evitar el ping-pong infinito

Resolver antes del cierre los fallos que afecten a seguridad, integridad de datos, autorización, aislamiento o comportamiento esencial. Los hallazgos menores no bloqueantes se registran como pendientes acotados y priorizados; no deben provocar rondas indefinidas de revisión ni refactorizaciones ajenas al bloque.

Una solicitud de revisión no equivale a revisión completada. Un commit/push no demuestra que una migración esté aplicada ni que la aplicación esté desplegada.

### Definición de bloque cerrado

- Alcance acordado implementado, incluida su interfaz.
- Tests, typecheck, lint y build completados correctamente.
- Revisión independiente de Codex en bloques importantes y bloqueantes resueltos.
- Hallazgos menores pendientes registrados sin ocultarlos.
- Estado de migraciones y verificación real documentado.
- Commit/push confirmado y plan/checkpoint actualizado.

Si el código está listo pero falta aplicar una migración, indicar **«código validado; activación en Supabase real pendiente de confirmación/aplicación»**. No describir el bloque como operativo en el entorno real hasta verificarlo.

## 9. Fuera de alcance por ahora

- Pagos e integración con Stripe.
- WhatsApp.
- Voz y llamadas.
- IA generativa real.
- Facturación.
- Stock.
- Contabilidad.
- Diagnóstico.
- Presupuestos complejos.
- App nativa.

No añadir SDK, servicios, costes ni infraestructura para estas capacidades dentro de horarios o de otro bloque que no las autorice. Si existen maquetas o simulaciones, no presentarlas como integraciones reales.

## 10. Reglas operativas y seguridad

- No aplicar ninguna nueva migración a Supabase real sin confirmación explícita del usuario, incluso con automatización disponible.
- No exponer secretos ni cadenas de conexión en archivos versionados, documentación, logs, capturas o mensajes.
- Mantener `TALLERIA_DB_URL` en el mecanismo de entorno existente y preservar Session Pooler y la CA TLS fijada.
- No trasladar secretos al cliente ni debilitar permisos para hacer pasar una prueba.
- Preservar aislamiento multi-tenant, roles, auditoría, concurrencia y correcciones previas.
- No ejecutar operaciones destructivas ni sobrescribir trabajo ajeno como tarea rutinaria.
- Diferenciar demo/local, Supabase real, checks automatizados, pruebas manuales, revisión y despliegue.
- No afirmar que se ejecutó una prueba si no se ejecutó; separar fallos previos de regresiones nuevas.
- Evitar refactorizaciones amplias no necesarias y no ampliar el alcance por iniciativa propia.
- Actualizar el plan con hechos y evidencia; no convertir propuestas en decisiones históricas.

## 11. Cómo retomar en una nueva sesión de Claude Code

1. Leer `TALLERIA_PLAN_MAESTRO_FINAL.md` y las instrucciones vigentes del repositorio antes de modificar código.
2. Comprobar rama, commit actual, cambios sin confirmar y checkpoint más reciente. No asumir que `fb8e6ca` es el HEAD actual.
3. Tomar las secciones 2–5 como línea base confirmada y revisar únicamente cambios posteriores o divergencias concretas.
4. Inspeccionar la implementación en curso de horarios, sus pruebas y posibles migraciones preparadas.
5. Continuar desde el próximo paso del checkpoint y seguir el flujo de la sección 8.
6. Respetar la confirmación obligatoria de migraciones reales y el alcance de las fases.
7. Actualizar el checkpoint y dejar explícito qué sigue pendiente para la siguiente sesión.

Este archivo debe estar en el repositorio y ser leído al inicio. Su mera presencia no acredita que Claude lo haya cargado: la instrucción de inicio del proyecto debe referenciarlo expresamente.

## 12. Checkpoint persistente

Actualizar al finalizar cada sesión significativa y al cerrar cada bloque. Mantener este apartado como el resumen vigente; conservar el historial relevante en el control de versiones.

### Checkpoint actual — 24 de septiembre de 2026 (actualizado, misma sesión, tras 4 rondas de Codex)

| Campo | Estado |
| --- | --- |
| Bloque actual | Horarios estructurados por taller |
| Estado | Código implementado y verificado por Codex (4 rondas, sin bloqueantes en la última); **pendiente de commit/push y de aplicar la migración real** |
| Alcance confirmado | Horario semanal + excepciones/festivos + bloqueo real de citas fuera de horario + UI owner en Configuración |
| Línea base | Stack, modos y funciones descritos en las secciones 2–4 |
| Rama y HEAD comprobados | `main`, HEAD `7af4705`. El código de horarios ya estaba implementado y commiteado en `295cbbe` (bajo `7af4705`) al retomar esta sesión; todas las correcciones de esta sesión están sin commitear en el árbol de trabajo |
| Supabase real | 001–005 aplicadas previamente; 006 aplicada manualmente y verificada; 007 aplicada mediante script seguro y verificada |
| Consentimiento | `requests.consent_at`; `public_intake` de 7 argumentos; obligatorio en recepción pública; históricos nulos |
| Automatización de BD | `TALLERIA_DB_URL`, Session Pooler, `db-query.mjs`, `apply-migration.mjs`, CA TLS fijada; no concede permiso para nuevas migraciones |
| Commit/push histórico confirmado | `fb8e6ca`, fase de recepción pública; `295cbbe`, implementación inicial de horarios estructurados (ya en el repositorio, sin revisión de Codex hasta esta sesión); ninguno de los dos es el cierre de este bloque |
| Revisiones anteriores | Varias rondas de Codex sobre equipo/auth/recepción pública y correcciones relevantes realizadas |
| Checks del bloque de horarios | Tests: 147/147 (`pnpm run test`) · Typecheck: limpio (`pnpm run typecheck`) · Lint: limpio (`pnpm run lint`) · Build: correcto (`pnpm run build`). Ejecutados en esta sesión, al final de las 4 rondas, sobre el árbol de trabajo con todas las correcciones aplicadas |
| Revisión Codex de horarios | **4 rondas sobre el mismo bloque, resumen en el historial de abajo.** Ronda 1: 2 bloqueantes + 3 menores sobre la implementación de `295cbbe` (todos corregidos). Ronda 2: verificación de esos 5 fixes — encontró un bloqueante nuevo introducido por la propia corrección DST (asumía delta fijo de 1h; rompía Australia/Lord_Howe, que usa 30 min). Ronda 3: verificación del fix de Lord Howe — encontró OTRO caso no cubierto por el muestreo enero/julio (Africa/Casablanca suspende su DST en Ramadán, fecha móvil). Ronda 4 (sobre el algoritmo reescrito de forma genérica, sin muestreo de meses fijos): **sin hallazgos bloqueantes**; 2 menores (test histórico de Casablanca recomendado en vez de omitirlo; un comentario impreciso), ambos corregidos. Sin fugas multi-tenant ni bypass de autorización en ninguna ronda |
| Nuevas migraciones de horarios | `supabase/migrations/202609240008_business_hours.sql`, ya presente en el repositorio desde `295cbbe`; esta sesión la modificó para corregir el hallazgo bloqueante de excepciones resucitadas y el filtro de fecha del snapshot (el fix de DST fue solo en `src/lib/domain.ts`, el motor TypeScript; el lado SQL usa `AT TIME ZONE` nativo de PostgreSQL y no necesitó cambios). Sigue sin aplicarse a Supabase real. Sin confirmación del usuario para aplicarla |
| Prueba manual pendiente | Recuperación de contraseña de extremo a extremo |
| Despliegue | Vercel aún no desplegado |
| Próximo paso exacto | Solicitar al usuario confirmación explícita y separada para (a) el commit/push del bloque y (b) la aplicación de la migración 008 a Supabase real |
| Después | Notificaciones/email y preparación operativa/despliegue; luego pulido visual/UX |

### Plantilla de actualización

```text
Fecha:
Rama y HEAD comprobados:
Bloque actual y alcance:
Estado: en curso / pendiente de revisión / código validado, activación pendiente / cerrado
Hecho en esta sesión:
Decisiones confirmadas:
Archivos principales:
Pendientes concretos y hallazgos menores:
Migraciones preparadas (identificador y finalidad):
Confirmación explícita del usuario para aplicación real (referencia y alcance):
Migraciones aplicadas/verificadas en Supabase real y evidencia sin secretos:
Tests: comando y resultado
Typecheck: comando y resultado
Lint: comando y resultado
Build: comando y resultado
Pruebas manuales: entorno, recorrido y resultado
Revisión de Codex: referencia, bloqueantes y resolución
Commit de cierre confirmado:
Push: confirmado / pendiente / fallido
Despliegue: no realizado / realizado y verificado (evidencia)
Bloqueos o limitaciones:
Próximo paso exacto:
Actualización de este plan versionada:
```

### Historial

```text
Fecha: 24 de septiembre de 2026
Rama y HEAD comprobados: main, HEAD 7af4705 (295cbbe bajo ese HEAD ya contenía la implementación de horarios estructurados sin revisión de Codex)
Bloque actual y alcance: Horarios estructurados por taller — horario semanal + excepciones/festivos + bloqueo real + UI owner en Configuración
Estado: código validado tras 4 rondas de Codex (sin bloqueantes en la última); activación real (commit/push y migración) pendiente de confirmación del usuario
Hecho en esta sesión: revisada la implementación ya commiteada (295cbbe); ejecutados tests/typecheck/lint/build; 4 rondas de revisión independiente de Codex sobre el mismo bloque (ver detalle abajo), corrigiendo cada hallazgo antes de pasar a la siguiente ronda
Decisiones confirmadas: ninguna decisión de producto nueva; se mantiene el alcance ya acordado del bloque
Archivos principales: src/lib/domain.ts, src/lib/demo.ts, src/lib/demo-migration.ts, src/lib/repository.ts, src/lib/domain.test.ts, src/lib/repository.test.ts, src/lib/supabase/database.test.ts, supabase/migrations/202609240008_business_hours.sql
Pendientes concretos y hallazgos menores: ninguno de los hallazgos de las 4 rondas queda abierto; nota documentada sin corregir (no bloqueante, sin ruta explotable identificada, señalada en la ronda 1): applyCommand en TypeScript es algo más laxo que la función SQL en el aislamiento por workshop_id dentro de la función aislada, no alcanzable en el repositorio demo actual
Migraciones preparadas (identificador y finalidad): 202609240008_business_hours.sql (ya existía desde 295cbbe; modificada esta sesión para rechazar la resurrección de una excepción eliminada y para que el snapshot use la fecha del taller, no la de la sesión de PostgreSQL; el lado SQL de is_within_business_hours no necesitó cambios, usa AT TIME ZONE nativo)
Confirmación explícita del usuario para aplicación real (referencia y alcance): no solicitada ni obtenida en esta sesión
Migraciones aplicadas/verificadas en Supabase real y evidencia sin secretos: ninguna en esta sesión; 001–007 siguen como estaban
Tests: pnpm run test — 147/147 correctos (al cierre de las 4 rondas)
Typecheck: pnpm run typecheck — sin errores
Lint: pnpm run lint — sin errores
Build: pnpm run build — correcto
Pruebas manuales: no realizadas en esta sesión
Revisión de Codex — 4 rondas sobre el mismo bloque (lección para retomar: una corrección de zonas horarias necesitó 3 rondas para converger; no asumir que la primera corrección de un hallazgo de Codex sobre DST/zonas horarias es la última):
  Ronda 1 (task-mufeq3d3-6i5a7o), sobre 295cbbe: 2 bloqueantes — (a) la conversión DST de src/lib/domain.ts no equivalía a PostgreSQL en horas ambiguas/inexistentes; (b) una edición obsoleta de workshop_hour_exception podía resucitar una excepción ya eliminada. 3 menores — hours_version sin inicializar en la demo; Configuración podía hacer retroceder hours_version; el snapshot de excepciones próximas usaba la fecha de sesión de PostgreSQL en vez de la del taller. Corregidos todos.
  Ronda 2 (task-mufin06s-mp7rt7), sobre esas correcciones: confirmó los 5 fixes, pero encontró un bloqueante NUEVO introducido por el propio fix de DST — asumía que el horario de verano siempre suma 1 hora al estándar; Australia/Lord_Howe usa 30 minutos, así que el fix desplazaba incluso citas de días normales sin ambigüedad en esa zona. También señaló que uno de los tests nuevos no discriminaba realmente el bug corregido. Corregido midiendo ambos desplazamientos (min/max de enero y julio) en vez de asumir un delta fijo; reforzado el test señalado.
  Ronda 3 (task-mufj74fm-wefdlc), sobre ese segundo fix: confirmó Lord Howe corregido, pero encontró OTRO caso no cubierto por el muestreo de enero/julio — Africa/Casablanca suspende su horario de verano durante el Ramadán, una ventana de fecha móvil que puede no coincidir con ningún mes fijo. Corregido reescribiendo el resolutor para sondear los desplazamientos reales alrededor de la fecha concreta (±2 días) en vez de muestrear meses fijos, y aplicando el mismo criterio de PostgreSQL confirmado (el desplazamiento numéricamente menor de los dos, en caso de ambigüedad). Verificado manualmente contra PostgreSQL en 6 zonas (Madrid, New York, Sydney, Lord Howe, Casablanca, Chatham), normal/ambiguo/inexistente, 21/21 coincidencias.
  Ronda 4 (task-mufjnn4p-afqlr8), sobre el resolutor reescrito: sin hallazgos bloqueantes. 2 menores — recomendó automatizar la regresión de Casablanca con fechas HISTÓRICAS (2024) en vez de omitir el test por depender de predicciones futuras del calendario islámico (se añadió, con now inyectado en el motor TypeScript y llamando a is_within_business_hours directamente en el lado SQL para evitar la restricción de "cita futura"); y un comentario en domain.ts que sobregeneralizaba la regla (corregido). Sin fugas multi-tenant ni bypass de autorización en ninguna de las 4 rondas.
  Nota operativa: la ronda 4 sufrió un fallo de herramienta (un --resume reanudó por error un hilo de Codex vacío en vez del hilo sustantivo de las rondas 2–3, por una llamada --help previa accidental); no afectó la validez de la revisión porque el prompt de esa ronda ya incluía el contexto completo por escrito, pero conviene verificar el threadId real al usar --resume, no asumir que "el último" es el correcto.
Commit de cierre confirmado: no
Push: pendiente
Despliegue: no realizado
Bloqueos o limitaciones: ninguno técnico; el commit/push y la aplicación de la migración real requieren confirmación explícita del usuario, no solicitada todavía en esta sesión
Próximo paso exacto: pedir al usuario confirmación explícita y separada para (a) el commit/push del bloque y (b) la aplicación de la migración 008 a Supabase real
Actualización de este plan versionada: pendiente de commit junto con el resto del bloque
```
