# TALLERIA — Plan maestro persistente

> Documento de continuidad para Claude Code. Leer al iniciar o retomar el proyecto y actualizar al cerrar cada bloque significativo.
>
> Fecha de actualización documental: 25 de septiembre de 2026.
> Repositorio: `paolagutierrezhidalgo3-tech/TALLERIA--APP`.
> Prioridad actual: bloque de notificaciones (aviso por correo al owner/staff en solicitudes públicas nuevas) — código validado y revisado por Codex, pendiente de configurar los secretos reales (Resend, Supabase secret key), probarlo de extremo a extremo, y solo entonces commitear/empujar.

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
| Recuperación de contraseña | Función existente; prueba manual completa de extremo a extremo superada en Supabase real (25 de septiembre de 2026, con cuenta de prueba desechable) | Ninguna; validada |
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

Este inventario confirma funciones existentes; no atribuye a cada una un commit o una prueba que no se haya documentado. La prueba manual completa de recuperación de contraseña ya se realizó (25 de septiembre de 2026); ver la sección 12.

### Revisiones independientes de Codex

Codex ya realizó varias rondas adversariales sobre equipo, autenticación y recepción pública. Se corrigieron problemas relevantes relacionados con:

- Autorización y límites de miembros.
- Concurrencia de invitaciones y casos de email nulo.
- Manejo de sesión y recuperación de la carga del equipo.
- Privacidad de matrículas y rate limiting.
- Casos de recepción pública.

Preservar esas correcciones y revisar regresiones cuando un cambio afecte a esas áreas. Este historial no equivale a una garantía absoluta de ausencia de defectos ni sustituye la revisión del nuevo bloque de horarios.

## 5. Migraciones 001–011 y Supabase real

**Las migraciones 001–011 están aplicadas en Supabase real según el estado confirmado.**

| Migración | Nombre | Estado en Supabase real y evidencia confirmada |
| --- | --- | --- |
| 001 | `initial` | Aplicada previamente |
| 002 | `capacity_security` | Aplicada previamente |
| 003 | `paged_workspace` | Aplicada previamente |
| 004 | `search_versions` | Aplicada previamente |
| 005 | `team_management` | Aplicada previamente |
| 006 | `public_reception` | Aplicada manualmente en SQL Editor; verificada mediante el flujo real descrito abajo |
| 007 | `public_consent` | Aplicada posteriormente mediante script seguro; verificada en Supabase real |
| 008 | `business_hours` | **Ya estaba aplicada al retomar esta sesión, en su forma original (sin las correcciones de la revisión de Codex); no se documentó cuándo ni en qué sesión.** Verificado por lectura directa del esquema real |
| 009 | `business_hours_fixes` | Aplicada el 24 de septiembre de 2026 mediante `apply-migration.mjs --confirm` (ejecutado por el usuario, con confirmación explícita); solo corrige los cuerpos de `execute_command` y `workspace_snapshot`. Verificada por lectura directa: ambas funciones ya contienen las correcciones |
| 010 | `new_request_notifications` | **Aplicada a Supabase real el 25 de septiembre de 2026**, con confirmación explícita del usuario ("sí, aplica la migración"). Añade `requests.notified_at`, `workshops.notifications_last_sent_at` y la función `claim_public_request_notification` (con su `grant`/`revoke` explícitos). Verificada por lectura directa del esquema real (columnas presentes; función presente, `security_type` `DEFINER`), además de los tests reales contra PGlite en `src/lib/supabase/database.test.ts` |
| 011 | `customer_erasure` | **Aplicada a Supabase real el 26 de septiembre de 2026**, mediante `apply-migration.mjs --confirm`, con confirmación explícita del usuario ("sí, aplica la migración 011 a Supabase real"). Añade la rama `customer_anonymize` a `execute_command` (derecho de supresión: anonimiza cliente/vehículos, deja auditoría `customer_anonymize`/`vehicle_plate_erased`). Verificada por lectura directa del esquema real (el cuerpo de `execute_command` ya contiene `customer_anonymize` y `vehicle_plate_erased`; los `grant`/`revoke` de la función quedaron igual que antes: `execute` solo para `authenticated`), además de los tests reales contra PGlite en `src/lib/supabase/database.test.ts` |

Los identificadores y nombres anteriores son los confirmados. Consultar el repositorio para las rutas y los nombres completos de archivo; no inferirlos.

**Nota de continuidad:** la migración 008 se descubrió ya aplicada en Supabase real al intentar aplicarla en esta sesión, sin que el checkpoint previo lo reflejara. Al retomar una sesión, comprobar siempre el esquema real antes de asumir que una migración está pendiente solo porque el checkpoint lo dice.

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
| C. Horarios estructurados | **Cerrada** | Semanal + excepciones/festivos + bloqueo real + UI owner; commiteada (`7408745`, `2bce298`) y activa en Supabase real (migración 009); prueba manual de recuperación de contraseña superada |
| D. Notificaciones/email y preparación operativa/despliegue | **Notificaciones: cerrada** (código, migración 010 y prueba real contra Supabase/Resend). **Despliegue en Vercel: hecho y verificado** — producción en `https://talleria-app.vercel.app` (subdominio gratuito, sin dominio propio, por decisión explícita del usuario del 25 de septiembre de 2026); Site URL/Redirect URLs de Supabase Auth configuradas por el usuario apuntando a esa URL; secretos de producción (`SUPABASE_SECRET_KEY`, `RESEND_API_KEY`) verificados correctos mediante una prueba real de extremo a extremo contra esa URL. **Pendiente para producción real, explícitamente diferido: verificar un dominio propio en Resend (resend.com/domains), configurar `NOTIFICATIONS_FROM_EMAIL`, y opcionalmente usar ese mismo dominio como dominio propio del despliegue de Vercel** — mientras tanto el aviso solo se entrega si el destinatario coincide con la cuenta de Resend en uso, no a los emails reales del equipo del taller | Aviso por correo al owner/staff en solicitudes públicas nuevas (alcance acotado: sin canal al cliente, sin WhatsApp); desplegado en Vercel sobre el subdominio gratuito |
| E. Pulido visual y UX | **Cerrada** (código + revisión visual real de dashboard y recepción pública, con un hallazgo real corregido) | Recepción pública (móvil): marca más presente, dirección/horario compactos, chat más compacto — commiteado y desplegado. Panel principal (dashboard): las 7 mejoras acordadas con el usuario están implementadas — tipografía (Inter vía `next/font`), banner de recepción digital menos protagonista, hover en filas de la tabla de solicitudes, más énfasis visual en la métrica "solicitudes nuevas", efecto de cristal del topbar resuelto (`position:sticky` + `backdrop-filter:blur` reales), `.agenda-card` visible también entre 900–1250px, y los grises de texto secundario sueltos consolidados en dos tokens nuevos (`--muted-2`, `--muted-3`). **Revisión visual real del dashboard hecha el 26 de septiembre de 2026** (escritorio y responsive/móvil, sin hallazgos). **Revisión visual real de la recepción pública en móvil hecha el 26 de septiembre de 2026**: se encontró y corrigió un hallazgo real -- el campo honeypot anti-bot del formulario (`input.sr-only`, invisible en teoría) no quedaba realmente oculto porque las utilidades de Tailwind viven en una capa de cascada CSS que el reset propio de `input{...}` (sin capa) siempre gana, dejándolo a ancho completo y añadiendo una barra de scroll horizontal no deseada en todos los anchos probados; corregido con una regla `input.sr-only` sin capa, sin cambios visuales ni funcionales en el resto del formulario. Con esto la fase E queda cerrada por completo |
| F. Cumplimiento legal del formulario público (RGPD/LOPDGDD) para el piloto | **Cerrada** | Se evaluó el estado completo de la app pensando en un piloto real (onboarding, Supabase real, despliegue, recepción pública, gestión diaria, seguridad/permisos, notificaciones) y se identificaron los huecos de cumplimiento del aviso legal de la recepción pública. Reescrito con: derecho a reclamar ante la AEPD, lista explícita de datos recogidos (incluida la conversación completa), aviso sobre no incluir datos sensibles en texto libre, edad mínima de 14 años (LOPDGDD), Resend listado como encargado junto a Supabase, y confirmación de que Supabase aloja los datos en la UE (Irlanda, verificado contra el host real del proyecto) por lo que no hace falta cláusula de transferencia internacional para ese proveedor. El NIF/CIF y el email de contacto para protección de datos —datos reales del taller que no se debían inventar— se resolvieron con dos variables de entorno nuevas y opcionales (`LEGAL_TAX_ID`, `LEGAL_CONTACT_EMAIL`, mismo patrón que `NOTIFICATIONS_FROM_EMAIL`); mientras no estén configuradas, la página muestra un aviso visible de que no debe compartirse el enlace con clientes reales. Revisado en escritorio y móvil, sin desbordamientos, en ambos estados (con y sin configurar). Commit `6d1168f`. **Derecho de supresión implementado**: el aviso legal promete un derecho de supresión que la app no podía cumplir (no existía ningún borrado de cliente/vehículo); se añadió un comando `customer_anonymize` (solo owner) que anonimiza nombre/teléfono/observaciones del cliente y borra la matrícula de sus vehículos, conservando solicitudes/citas/conversaciones para el historial del taller, con su propio rastro de auditoría (`vehicle_plate_erased` + `customer_anonymize`). Implementado en demo (`domain.ts`) y en Supabase real mediante la migración `202609260011_customer_erasure.sql`. **Migración aplicada y verificada en Supabase real el 26 de septiembre de 2026**, con confirmación explícita del usuario. UI de confirmación en el editor de cliente, probada en el navegador en modo demo. Commit `ad10f4d` |

### Próximas acciones en orden

1. ~~Configurar `SUPABASE_SECRET_KEY` y `RESEND_API_KEY` y probar el aviso de extremo a extremo contra Supabase real.~~ Hecho el 25 de septiembre de 2026; migración 010 aplicada; commit/push del bloque completado.
2. ~~Preparar y ejecutar el despliegue en Vercel.~~ Hecho el 25 de septiembre de 2026: producción en `https://talleria-app.vercel.app` (subdominio gratuito, decisión explícita de no comprar dominio todavía); Supabase Auth Site URL/Redirect URLs configuradas por el usuario; comprobaciones de producción superadas (páginas públicas responden, lectura real de Supabase confirmada, `SUPABASE_SECRET_KEY`/`RESEND_API_KEY` verificadas correctas en Vercel mediante una prueba real de extremo a extremo, datos de prueba limpiados).
3. **Diferido explícitamente por el usuario, pendiente para más adelante:** verificar un dominio propio en Resend (resend.com/domains), configurar `NOTIFICATIONS_FROM_EMAIL` con un remitente de ese dominio, y opcionalmente usar ese mismo dominio como dominio propio del despliegue de Vercel (en vez del subdominio `*.vercel.app` gratuito).
4. ~~Pulido visual/UX (fase E).~~ **Cerrada el 26 de septiembre de 2026.** Recepción pública móvil (marca, contacto compacto, chat compacto, 25 de septiembre) y las 7 mejoras del dashboard (tipografía, banner de recepción, hover de tabla, énfasis de la métrica de solicitudes nuevas, topbar con cristal real, agenda visible entre 900–1250px, grises consolidados en tokens, 26 de septiembre) commiteadas y empujadas. Revisión visual real completada para ambas partes: dashboard sin hallazgos; en la recepción pública se encontró y corrigió un honeypot anti-bot que no quedaba realmente oculto (barra de scroll horizontal no deseada en móvil), commit `9abde5c`.
5. ~~Evaluación de qué falta para un piloto real y cumplimiento legal del formulario público (fase F).~~ **Cerrada el 26 de septiembre de 2026.** Evaluación completa de la app pensando en un piloto real (onboarding, Supabase, despliegue, recepción pública, gestión diaria, seguridad, notificaciones, bloqueos); a partir de ahí, reescritura del aviso legal de la recepción pública para RGPD/LOPDGDD (AEPD, datos recogidos explícitos, edad mínima, Resend como encargado, confirmación de que Supabase está en la UE) con placeholders vía `LEGAL_TAX_ID`/`LEGAL_CONTACT_EMAIL`, commit `6d1168f`.
6. ~~Derecho de supresión (anonimizar cliente en vez de borrar, con auditoría, seguro para Supabase real).~~ **Cerrado el 26 de septiembre de 2026.** Comando `customer_anonymize` (solo owner) en `domain.ts` y en la migración `202609260011_customer_erasure.sql`; conserva solicitudes/citas/conversaciones, deja auditoría (`customer_anonymize` + `vehicle_plate_erased`), y libera el teléfono (`phone_e164=null`) para que una alta real futura no se confunda con el registro anonimizado. UI de confirmación en el editor de cliente. Commit `ad10f4d`. **Migración 011 aplicada a Supabase real el 26 de septiembre de 2026**, con confirmación explícita del usuario ("sí, aplica la migración 011 a Supabase real"); verificada por lectura directa del esquema real.
7. **Explícitamente dejado pendiente por el usuario ("deja esto pendiente"):** configurar `LEGAL_TAX_ID` y `LEGAL_CONTACT_EMAIL` en Vercel con los datos reales del taller piloto antes de compartir el enlace de recepción pública con clientes reales (mientras no estén, la propia página lo avisa). Requiere datos reales del taller (NIF/CIF y un email de contacto) que esta sesión no debía inventar, y acceso al panel de Vercel del usuario (sin CLI de Vercel disponible en este entorno).
8. ~~CI automatizado (tests/typecheck/lint/build en cada push/PR a main).~~ **Cerrado el 26 de septiembre de 2026.** Workflow de GitHub Actions (`.github/workflows/ci.yml`) que instala con pnpm, y ejecuta typecheck, lint, test y build en cada push/PR a main. No necesita secretos: el build corre en modo demo (igual que cualquier checkout nuevo sin `.env.local`) y los tests de integración usan una instancia embebida de PGlite, no un proyecto Supabase real -- verificado localmente moviendo `.env.local` fuera antes de ejecutar los cuatro checks. Primera ejecución real en GitHub Actions tras el push: **success**. Commit `16c8af5`.
9. ~~Conectar el CI al despliegue de Vercel (que un CI en rojo bloquee producción).~~ **Cerrado el 26 de septiembre de 2026** en el lado de código. Se añadió un job `deploy` a `.github/workflows/ci.yml` que depende de `checks` (`needs: checks`) y solo se ejecuta en un push a `main`; usa el flujo oficial de la CLI de Vercel (`vercel pull` → `vercel build --prod` → `vercel deploy --prebuilt --prod`). **Pendiente, a decidir por el usuario, para que el despliegue real quede conectado de verdad:** (a) crear un token de Vercel (vercel.com/account/tokens) y añadirlo como secreto de GitHub `VERCEL_TOKEN`; (b) añadir `VERCEL_ORG_ID` y `VERCEL_PROJECT_ID` como secretos también (se obtienen con `vercel link` local, o en el dashboard); (c) desactivar el auto-despliegue nativo de Vercel para `main` (Project Settings → Git → Ignored Build Step, con un comando que solo se salte el build en la rama de producción) para que no se despliegue dos veces. Mientras esos tres secretos no existan, el job `deploy` se salta limpiamente (sin fallar) — confirmado en la ejecución real de GitHub Actions tras el push. Commit `15cca30` (con una corrección intermedia en `ec51eb5`, que falló porque GitHub Actions no permite referenciar `secrets` directamente en un `if:` de job).
10. **Recomendaciones no bloqueantes restantes de la evaluación de piloto** (a decidir por el usuario): monitorización de errores en producción, confirmar el plan/tier real de Supabase y Vercel, y el dominio propio de Resend (ya diferido, sin fecha).

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

### Checkpoint actual — 26 de septiembre de 2026 (CI conectado al despliegue de Vercel, en el lado de código; faltan tres secretos y un ajuste en Vercel para que quede activo de verdad)

| Campo | Estado |
| --- | --- |
| Bloque actual | Conectar el CI al despliegue de Vercel. **Cerrado en el lado de código**; falta configuración externa en GitHub/Vercel (ver "Próximo paso exacto") para que el despliegue real quede gobernado por el CI |
| Estado | El usuario pidió conectar el CI (añadido en el bloque anterior, `16c8af5`) al despliegue de Vercel. Se añadió un job `deploy` a `.github/workflows/ci.yml`, con `needs: checks` (solo se ejecuta si typecheck/lint/test/build ya pasaron) y `if: github.ref == 'refs/heads/main' && github.event_name == 'push'` (nunca en pull requests, solo en push directo a main). Usa el flujo oficial de la CLI de Vercel: `vercel pull --yes --environment=production` (trae las variables de entorno reales del proyecto en Vercel, incluidas `LEGAL_TAX_ID`/`RESEND_API_KEY` si ya estuvieran puestas ahí -- nunca se leen de los `.env` de este repositorio), `vercel build --prod`, y `vercel deploy --prebuilt --prod`. El primer intento (commit `ec51eb5`) puso `secrets.VERCEL_TOKEN != ''` directamente en el `if:` del job -- **GitHub Actions rechazó el workflow entero al arrancar** (la ejecución real terminó en `failure` con **0 jobs ejecutados**, confirmado consultando la API de runs/jobs: GitHub Actions no permite referenciar el contexto `secrets` dentro de una condición `if:` de job). Corregido en `15cca30`: la comprobación de si `VERCEL_TOKEN` existe se hace ahora en un primer step del job (`env: TOKEN: secrets.VERCEL_TOKEN`, donde `secrets` sí está permitido) que escribe un output (`ready=true/false`); cada step posterior usa `if: steps.vercel_ready.outputs.ready == 'true'` en vez de tocar `secrets` directamente. Verificado con una segunda ejecución real: el job `checks` pasó igual que siempre, y el job `deploy` se ejecutó, detectó correctamente que `VERCEL_TOKEN` no existe todavía, y saltó limpiamente los 4 steps de Vercel (`skipped`, no `failure`) sin romper el resultado global del workflow (`success`) |
| Decisiones de producto confirmadas para este bloque | Ninguna decisión de producto; continuación directa de la petición del usuario ("conecta el CI al despliegue de Vercel") |
| Alcance confirmado (bloques anteriores) | Fases A–E y F (incluida la migración 011 en Supabase real) y el CI base: **cerrados** (ver entradas anteriores del historial) |
| Línea base | Stack, modos y funciones descritos en las secciones 2–4 |
| Rama y HEAD comprobados | `main`, HEAD `15cca30` (fix del job de deploy) tras push; `ec51eb5` (intento fallido, workflow inválido) y `c41c2b7` (checkpoint del CI base) en el mismo historial, anteriores |
| Archivos principales del bloque | `.github/workflows/ci.yml` (job `deploy` añadido y luego corregido) |
| Secretos del bloque | Ninguno añadido por mí; el job `deploy` espera tres secretos de GitHub que el usuario debe crear (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`) -- ninguno se ha visto ni manejado en esta sesión |
| Supabase real | Sin cambios en este bloque |
| Consentimiento | Sin cambios |
| Automatización de BD | No usada en este bloque |
| Commit/push histórico confirmado | `16c8af5` (CI base), `c41c2b7` (checkpoint CI base), `ec51eb5` (intento de job `deploy`, workflow inválido -- confirmado por una ejecución real con 0 jobs), `15cca30` (fix: comprobación de secreto movida a un step con output, deploy ya funciona en modo "saltar limpiamente") |
| Checks de este bloque | El job `checks` (typecheck/lint/test/build) siguió pasando en ambas ejecuciones reales de este bloque. El job `deploy` no tiene "checks" propios que ejecutar todavía -- su validación es la propia ejecución de GitHub Actions, confirmada dos veces por la API pública de runs/jobs (primera: `failure`, 0 jobs, error real detectado y corregido; segunda: `success`, `deploy` con sus 4 steps de Vercel en `skipped`, como se esperaba sin los secretos) |
| Revisión de Codex de este bloque | No solicitada (archivo de configuración de CI/CD, sin tocar código de la aplicación, base de datos, autorización ni aislamiento entre talleres) |
| Prueba manual real | No aplica (nada visual); la validación es la propia ejecución del workflow, verificada dos veces vía la API de GitHub Actions |
| Despliegue | El despliegue de Vercel sigue siendo, por ahora, el mismo automático vía su integración nativa con Git (sin cambios en Vercel en este bloque). El job `deploy` del CI existe y está listo, pero no hace nada todavía porque le faltan los tres secretos -- en cuanto se añadan, empezará a desplegar producción él mismo tras cada push a main que pase los checks, y en ese momento habrá que desactivar el auto-despliegue nativo de Vercel para `main` para no desplegar dos veces (ver "Próximo paso exacto") |
| Próximo paso exacto | Para que el despliegue quede realmente gobernado por el CI, el usuario debe: (1) crear un token en vercel.com/account/tokens y añadirlo como secreto de GitHub `VERCEL_TOKEN` (repo → Settings → Secrets and variables → Actions); (2) obtener y añadir `VERCEL_ORG_ID` y `VERCEL_PROJECT_ID` como secretos también (con `vercel link` local, que genera `.vercel/project.json` con ambos, o desde el dashboard de Vercel); (3) en Vercel, Project Settings → Git → "Ignored Build Step", poner un comando que salte el build automático solo en la rama de producción (p. ej. saltar si `$VERCEL_GIT_COMMIT_REF` es `main`, dejando que las demás ramas/PRs sigan con el preview automático de Vercel como hasta ahora), para que main no se despliegue dos veces (una por Vercel, otra por el CI). Mientras esto no se haga, todo sigue funcionando exactamente como antes (Vercel despliega solo, el CI corre sus checks y el job `deploy` se salta sin hacer nada) -- nada se ha roto. `LEGAL_TAX_ID`/`LEGAL_CONTACT_EMAIL` siguen explícitamente pendientes, sin fecha. **No se ha empezado ningún bloque nuevo más allá de este** |
| Después | Cuando el usuario lo priorice: los tres secretos y el ajuste de Vercel de arriba, `LEGAL_TAX_ID`/`LEGAL_CONTACT_EMAIL`, monitorización de errores, confirmar plan/tier de Supabase y Vercel, y el dominio propio de Resend |

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
Estado: cerrado -- código validado tras 4 rondas de Codex, commiteado/empujado (7408745), y la corrección activa en Supabase real (migración 009, aplicada por el usuario y verificada)
Hecho en esta sesión: revisada la implementación ya commiteada (295cbbe); ejecutados tests/typecheck/lint/build; 4 rondas de revisión independiente de Codex sobre el mismo bloque (ver detalle abajo), corrigiendo cada hallazgo antes de pasar a la siguiente ronda
Decisiones confirmadas: ninguna decisión de producto nueva; se mantiene el alcance ya acordado del bloque
Archivos principales: src/lib/domain.ts, src/lib/demo.ts, src/lib/demo-migration.ts, src/lib/repository.ts, src/lib/domain.test.ts, src/lib/repository.test.ts, src/lib/supabase/database.test.ts, supabase/migrations/202609240008_business_hours.sql
Pendientes concretos y hallazgos menores: ninguno de los hallazgos de las 4 rondas queda abierto; nota documentada sin corregir (no bloqueante, sin ruta explotable identificada, señalada en la ronda 1): applyCommand en TypeScript es algo más laxo que la función SQL en el aislamiento por workshop_id dentro de la función aislada, no alcanzable en el repositorio demo actual
Migraciones preparadas (identificador y finalidad): 202609240008_business_hours.sql (ya existía desde 295cbbe, modificada en el código para rechazar la resurrección de una excepción eliminada y para que el snapshot use la fecha del taller); 202609240009_business_hours_fixes.sql (preparada al descubrir que 008 ya estaba aplicada en su forma original -- ver nota de divergencia en la sección 5 --, con solo los dos cuerpos de función corregidos)
Confirmación explícita del usuario para aplicación real (referencia y alcance): el usuario pidió expresamente "aplica la migración 008 a Supabase real"; al descubrirse la divergencia se le explicó y eligió preparar la 009; después ejecutó él mismo `node scripts/apply-migration.mjs supabase/migrations/202609240009_business_hours_fixes.sql --confirm` (el clasificador de modo automático bloqueó que Claude lo ejecutara)
Migraciones aplicadas/verificadas en Supabase real y evidencia sin secretos: 202609240009_business_hours_fixes.sql, aplicada por el usuario el 24 de septiembre de 2026; verificada por lectura directa del esquema (pg_get_functiondef de execute_command y workspace_snapshot, sin volcar nada sensible). 001–008 sin cambios en esta sesión (008 ya estaba aplicada desde antes, ver nota de divergencia)
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
Commit de cierre confirmado: sí — 7408745, a petición explícita del usuario ("haz commit y push del bloque")
Push: confirmado — fb8e6ca..7408745 a origin/main
Despliegue: no realizado
Bloqueos o limitaciones: ninguno; el clasificador de modo automático de Claude Code bloqueó ejecutar apply-migration.mjs (incluso en vista previa, sin --confirm) por estar etiquetado "Production Deploy" -- el usuario lo ejecutó directamente en su terminal
Próximo paso exacto: commitear y empujar 202609240009_business_hours_fixes.sql junto con esta actualización del plan (el código ya está aplicado en Supabase real; solo falta dejarlo versionado); después, la prueba manual de recuperación de contraseña y planificar el bloque de notificaciones/email y despliegue
Actualización de este plan versionada: sí, en el commit que sigue a este cierre
```

```text
Fecha: 25 de septiembre de 2026
Rama y HEAD comprobados: main, HEAD 2bce298 (push confirmado en la sesión anterior)
Bloque actual y alcance: prueba manual pendiente del roadmap -- recuperación de contraseña de extremo a extremo, en Supabase real
Estado: cerrado
Hecho en esta sesión: prueba manual guiada paso a paso (sin extensión Claude in Chrome conectada) con una cuenta de prueba desechable (alias +test del correo del usuario, nunca su cuenta real de owner); servidor local (`pnpm run dev`) apuntando a Supabase real (NEXT_PUBLIC_DATA_MODE=supabase); tras la prueba, borrada la cuenta y el taller de prueba de Supabase real
Decisiones confirmadas: ninguna decisión de producto nueva
Archivos principales: ninguno (prueba manual; no hubo cambios de código). Cambio de datos: DELETE en Supabase real sobre un taller y una cuenta de prueba, sin afectar migraciones ni esquema
Pendientes concretos y hallazgos menores: ninguno
Migraciones preparadas (identificador y finalidad): ninguna en esta sesión
Confirmación explícita del usuario para aplicación real (referencia y alcance): el usuario pidió expresamente borrar la cuenta y el taller de prueba, y explícitamente excluyó su cuenta y taller reales ("no toques mi cuenta real ni mi taller real"); verificado por id antes y después de borrar que son entidades distintas
Migraciones aplicadas/verificadas en Supabase real y evidencia sin secretos: ninguna migración; sí una limpieza de datos (DELETE, no un cambio de esquema) sobre el taller de prueba `b5d6144e-...` y la cuenta `1a6906f0-...`, verificada por lectura directa que ambos desaparecieron y que el taller real `6c349da4-...` y la cuenta real siguen intactos
Tests: no aplica (prueba manual, no automatizada)
Typecheck: no aplica
Lint: no aplica
Build: no aplica
Pruebas manuales: Supabase real, modo `supabase` (no demo) -- recorrido completo: registro con cuenta de prueba → confirmación de correo → cierre de sesión → "¿Olvidaste tu contraseña?" → mensaje genérico sin confirmar existencia de cuenta → enlace de recuperación recibido por correo → evento PASSWORD_RECOVERY → pantalla de nueva contraseña → "Contraseña actualizada" → contraseña antigua rechazada, nueva aceptada. Resultado: superada sin hallazgos
Revisión de Codex: no aplica en esta sesión
Commit de cierre confirmado: no aplica (sin cambios de código; esta actualización del plan se commiteará junto con la siguiente sesión o de forma independiente si el usuario lo pide)
Push: no aplica
Despliegue: no realizado
Bloqueos o limitaciones: ninguno
Próximo paso exacto: concretar y acotar con el usuario el bloque D (notificaciones/email y preparación operativa/despliegue) antes de empezar a implementarlo
Actualización de este plan versionada: pendiente de commit
```

```text
Fecha: 25 de septiembre de 2026
Rama y HEAD comprobados: main, HEAD c189337. El bloque de notificaciones está sin commitear en el árbol de trabajo, a petición explícita del usuario ("vamos a configurar y probar los secretos primero")
Bloque actual y alcance: Notificaciones -- aviso por correo al owner/staff cuando llega una solicitud pública nueva (decisiones acotadas: solo owner/staff, no el cliente; proveedor Resend; correo mínimo sin datos del cliente)
Estado: código validado y revisado por Codex; pendiente de secretos, prueba real y commit
Hecho en esta sesión: implementado el bloque completo; 6 rondas de revisión independiente de Codex sobre el mismo bloque, corrigiendo cada hallazgo antes de pasar a la siguiente ronda (detalle abajo); actualizado este plan (secciones 5, 7 y 12) sin commitear
Decisiones confirmadas: las 3 decisiones de alcance/proveedor/contenido del correo, ya reflejadas en la sección 12
Archivos principales: src/lib/notifications.ts, src/lib/notifications.test.ts, src/lib/supabase/admin.ts, src/app/api/notify-new-request/route.ts, src/components/public-reception.tsx, supabase/migrations/202609250010_new_request_notifications.sql, .env.example, src/lib/supabase/database.test.ts
Pendientes concretos y hallazgos menores: ninguno de los hallazgos de las 6 rondas de Codex queda abierto (la última ronda confirmó explícitamente "no queda ningún hallazgo bloqueante ni menor" tras la corrección de un detalle cosmético de aislamiento entre tests)
Migraciones preparadas (identificador y finalidad): 202609250010_new_request_notifications.sql -- columnas de reclamación/enfriamiento y la función claim_public_request_notification (con grant explícito a service_role)
Confirmación explícita del usuario para aplicación real (referencia y alcance): no solicitada ni obtenida en esta sesión; el usuario pidió explícitamente no commitear todavía y configurar/probar los secretos primero
Migraciones aplicadas/verificadas en Supabase real y evidencia sin secretos: ninguna en esta sesión; 001-009 siguen como estaban
Tests: pnpm run test -- 165/165 correctos (incluidas pruebas reales contra PGlite para claim_public_request_notification y la verificación de permisos por rol)
Typecheck: pnpm run typecheck -- sin errores
Lint: pnpm run lint -- sin errores
Build: pnpm run build -- correcto, incluida la nueva ruta /api/notify-new-request
Pruebas manuales: no realizadas en esta sesión (pendiente: requiere SUPABASE_SECRET_KEY y RESEND_API_KEY configurados, ver sección 12)
Revisión de Codex -- 6 rondas sobre el mismo bloque (misma lección que con horarios: una primera corrección no es necesariamente la última; verificar con pruebas reales, no solo mocks, cuando la corrección depende de un esquema o infraestructura real):
  Ronda 1: hallazgo bloqueante -- el diseño identificaba el taller solo por su slug público (dato conocido por cualquier visitante de la página de recepción), permitiendo generar avisos falsos sin haber creado ninguna solicitud real, y pudiendo agotar la ventana de enfriamiento justo antes de una solicitud legítima. Corregido exigiendo el id de la propia solicitud (un UUID generado por el cliente, nunca mostrado públicamente) y una reclamación atómica e idempotente sobre esa solicitud.
  Ronda 2: hallazgo bloqueante -- el filtro de "canal público" (`.eq('channel','public')`) se aplicaba sobre la tabla `requests`, que no tiene esa columna (vive en `conversations`); en Postgres real la consulta habría fallado, y como el código solo leía `data` sin comprobar `error`, el fallo habría sido silencioso: nunca se habría enviado ningún aviso en producción. Los mocks del test unitario no lo detectaron. Corregido moviendo la reclamación a una función SQL (`claim_public_request_notification`) que hace el join correcto con `conversations`, y añadidas pruebas de integración reales contra PostgreSQL (PGlite) que sí lo habrían detectado.
  Ronda 3: 2 hallazgos menores -- el permiso de ejecución de la función dependía de privilegios predeterminados de Supabase, no comprobados; corregido con un `grant execute ... to service_role` explícito y una prueba real que cambia de rol y verifica la denegación a anon/authenticated y el acceso de service_role. Los tests de los caminos de error no probaban que fuera el chequeo de `error` (y no una `data` nula) lo que detenía el flujo; corregido dando `data` con un valor válido a la vez que el error en esos tests, y espiando `console.error`.
  Ronda 4: 4 hallazgos menores de pulido -- un comentario SQL impreciso sobre los privilegios de PUBLIC; los errores de `getUserById` se descartaban en silencio (ahora se registran y se continúa con el resto de miembros); dos títulos de test no describían el escenario que realmente probaban; un comentario en la ruta de API decía "siempre responde 200" sin matizar los 400 por entrada inválida.
  Ronda 5 (verificación de la ronda 4): al corregir la limpieza de los tests, la primera solución probada (`vi.restoreAllMocks()` en un afterEach) rompió 4 tests porque también borraba el `mockResolvedValue` por defecto de los mocks planos (getUserById, emailsSend), no solo el spy real de console.error. Detectado al ejecutar los tests antes de reportar el fix como terminado; corregido restaurando solo el spy específico.
  Ronda 6 (cierre): sin hallazgos bloqueantes. Un detalle cosmético (variables de entorno de los tests no restauradas a su valor original entre tests, confirmado explícitamente por Codex como "no un fallo de producción ni de seguridad"); corregido igualmente. Confirmación final explícita: "no queda ningún hallazgo bloqueante ni menor".
Commit de cierre confirmado: no -- pendiente a petición explícita del usuario
Push: pendiente
Despliegue: no realizado
Bloqueos o limitaciones: ninguno técnico; faltan los secretos reales (SUPABASE_SECRET_KEY, RESEND_API_KEY) para poder probar el bloque de extremo a extremo antes de commitear
Próximo paso exacto: configurar los secretos en .env.local, probar el flujo completo contra Supabase/Resend reales, y solo si sale bien, pedir confirmación explícita para aplicar la migración 010 y luego commitear/empujar
Actualización de este plan versionada: pendiente de commit junto con el resto del bloque
```

```text
Fecha: 25 de septiembre de 2026
Rama y HEAD comprobados: main, HEAD c189337 (bloque de notificaciones implementado y revisado por Codex en la sesión anterior, sin commitear a petición del usuario)
Bloque actual y alcance: Notificaciones -- configuración de los secretos reales, prueba de extremo a extremo contra Supabase y Resend reales, limpieza de los datos de prueba, y cierre del bloque (commit/push)
Estado: cerrado
Hecho en esta sesión: guiado al usuario para añadir SUPABASE_SECRET_KEY y RESEND_API_KEY a .env.local sin que los valores aparecieran en el chat (el usuario los pegó directamente en el Bloc de notas, abierto a petición suya); verificados por nombre/longitud sin mostrar valores; detectada y corregida una duplicidad de NEXT_PUBLIC_SUPABASE_URL/PUBLISHABLE_KEY en el archivo (una línea vacía de plantilla y otra con el valor real); aplicada la migración 010 con confirmación explícita y verificada por lectura directa del esquema; primera prueba real de extremo a extremo (solicitud pública real vía la RPC pública public_intake -- llamada directamente, no a través del navegador, por no haber extensión Claude in Chrome conectada -- seguida de la llamada real a /api/notify-new-request) reveló que SUPABASE_SECRET_KEY era inválida ("Invalid API key"); investigado y encontrado que el usuario había pegado por error un sufijo literal ("_SUPABASE"/"_RESEND") junto a ambas claves al copiarlas; corregido por el usuario; segunda prueba real: reclamo atómico, cooldown y resolución de miembros correctos contra Supabase real, pero Resend rechazó el envío (403, política de sandbox: el remitente de pruebas onboarding@resend.dev solo entrega al email de la propia cuenta de Resend, distinto del email de los miembros reales del taller); explorada una vía para probar el envío sin tocar workshop_members del taller real (taller de prueba desechable, vinculando el usuario ya existente cuyo email sí coincide con la cuenta de Resend) -- bloqueada por una restricción real descubierta en esta sesión (UNIQUE(user_id) en workshop_members: un usuario solo puede pertenecer a un taller a la vez), la transacción se revirtió sola sin dejar residuo (verificado); resuelto finalmente con un envío directo a la API de Resend (mismo asunto/cuerpo que usa la app, sin tocar Supabase) solo al email autorizado por Resend -- aceptado por Resend (200) y confirmado recibido por el usuario; identificados uno a uno y eliminados, con confirmación explícita del usuario, los datos de prueba (cliente, vehículo, conversación, solicitud y evento de auditoría) que la primera prueba de intake había dejado en el taller real, verificados eliminados sin afectar ninguna otra fila; ejecutados tests/typecheck/lint/build; actualizado este plan (secciones 5, 7 y 12)
Decisiones confirmadas: ninguna decisión de producto nueva
Archivos principales: los mismos del bloque de notificaciones (ver entrada anterior del historial); sin cambios de código en esta sesión más allá de la propia prueba -- solo .env.local (no versionado, nunca mostrado en el chat) y este plan
Pendientes concretos y hallazgos menores: para producción real falta verificar un dominio propio en Resend (resend.com/domains) y configurar NOTIFICATIONS_FROM_EMAIL con un remitente de ese dominio -- mientras tanto el aviso solo se entrega si el destinatario coincide con la cuenta de Resend en uso, no con los emails reales de los miembros del taller
Migraciones preparadas (identificador y finalidad): ninguna nueva en esta sesión; se aplicó la 010 ya preparada en la sesión anterior
Confirmación explícita del usuario para aplicación real (referencia y alcance): "sí, aplica la migración" (migración 010 a Supabase real); "sí, adelante" (intento de taller de prueba desechable, revertido solo por una restricción real de esquema antes de escribir ningún dato, sin necesidad de limpieza); "sí, envía el correo de prueba CON RESEND unicamente a mi email autorizado" (envío directo de prueba, sin tocar Supabase); "sí, bórralos" (limpieza de los datos de prueba dejados en el taller real por la primera prueba de intake)
Migraciones aplicadas/verificadas en Supabase real y evidencia sin secretos: 202609250010_new_request_notifications.sql, aplicada en esta sesión; verificada por lectura directa del esquema real (columnas requests.notified_at y workshops.notifications_last_sent_at presentes; función claim_public_request_notification presente, security_type DEFINER)
Tests: pnpm run test -- 165/165 correctos
Typecheck: pnpm run typecheck -- sin errores
Lint: pnpm run lint -- sin errores
Build: pnpm run build -- correcto, incluida /api/notify-new-request
Pruebas manuales: Supabase real (modo supabase, no demo) + Resend real. Solicitud pública real creada vía la RPC pública public_intake (llamada directamente, no a través del navegador, por no haber extensión Claude in Chrome conectada, contra el taller real "Taller Prueba Paola") y aviso disparado vía /api/notify-new-request. Resultado: reclamo atómico, cooldown y resolución de miembros validados con datos reales contra Supabase real; entrega de email a los miembros reales bloqueada por la política de sandbox de la cuenta de Resend en uso (no por ningún fallo del código, confirmado por el mensaje de error de la propia Resend); entrega de email confirmada por separado con un envío directo solo al email autorizado por Resend, aceptado por Resend y recibido y confirmado explícitamente por el usuario. Datos de prueba creados en el taller real durante la prueba de intake, identificados uno a uno y eliminados con confirmación explícita del usuario; verificados eliminados
Revisión de Codex: no aplica en esta sesión (el bloque ya fue revisado en 6 rondas en la sesión anterior; sin cambios de código en esta sesión)
Commit de cierre confirmado: sí, a petición explícita del usuario ("haz commit y push de este bloque")
Push: confirmado
Despliegue: no realizado
Bloqueos o limitaciones: para que el aviso llegue a los emails reales de los miembros del taller en producción, falta verificar un dominio propio en Resend y configurar NOTIFICATIONS_FROM_EMAIL (ver pendientes arriba); hallazgo de esquema para tener en cuenta en trabajo futuro: workshop_members.user_id es UNIQUE (un usuario, un taller a la vez)
Próximo paso exacto: verificar un dominio propio en Resend y configurar NOTIFICATIONS_FROM_EMAIL; preparar y ejecutar el despliegue en Vercel (dominio, variables de entorno reales -- incluidas SUPABASE_SECRET_KEY/RESEND_API_KEY/NOTIFICATIONS_FROM_EMAIL --, criterios operativos)
Actualización de este plan versionada: sí, en el commit que sigue a este cierre
```

```text
Fecha: 25 de septiembre de 2026
Rama y HEAD comprobados: main, HEAD 03a8d94 (bloque de notificaciones ya commiteado y empujado en la sesión anterior)
Bloque actual y alcance: Preparación operativa y despliegue -- decisión sobre el dominio de Resend, despliegue en Vercel, y comprobaciones de producción del bloque de notificaciones
Estado: cerrado (despliegue en Vercel); el dominio propio de Resend queda diferido explícitamente, sin fecha
Hecho en esta sesión: preguntado y confirmado que el usuario no quiere comprar ningún dominio todavía; anotado como pendiente diferido. Guiado al usuario para crear el proyecto en Vercel él mismo (cuenta propia, import desde GitHub) y para las variables de entorno de producción, sin que ningún valor pasara por este chat. Tras el despliegue confirmado por el usuario en `https://talleria-app.vercel.app`, ejecutadas comprobaciones de producción no destructivas: home/recepción pública/aviso legal responden 200; la recepción pública muestra el nombre real del taller (confirma lectura de Supabase real, no demo); `/api/notify-new-request` valida bien la entrada (400 con body vacío, ok:true con id inexistente sin crear nada). Como la ruta de notificaciones es best-effort y nunca revela un fallo de credenciales al visitante, se acordó con el usuario una prueba real controlada contra producción: solicitud pública real creada vía la RPC pública public_intake contra el taller real, aviso disparado a través de la URL de Vercel, notified_at verificado en Supabase real (confirma SUPABASE_SECRET_KEY correcta en Vercel), y el usuario revisó los Runtime Logs de Vercel confirmando el mensaje de sandbox de Resend (no de clave inválida), confirmando RESEND_API_KEY correcta en Vercel también. Identificados y eliminados, con confirmación explícita del usuario, los datos de prueba (cliente, vehículo, conversación, solicitud y evento de auditoría) dejados en el taller real por esa prueba; verificados eliminados. Actualizado este plan (secciones 7 y 12)
Decisiones confirmadas: no comprar ningún dominio por ahora; desplegar en Vercel sobre el subdominio gratuito `*.vercel.app`; diferir explícitamente la verificación de dominio en Resend y la configuración de NOTIFICATIONS_FROM_EMAIL para más adelante, sin fecha concreta
Archivos principales: ninguno (sin cambios de código en esta sesión); cambios de configuración fuera del repositorio (proyecto y variables de entorno en Vercel, Site URL/Redirect URLs en Supabase Auth, ambos hechos por el usuario en sus propias cuentas) y datos de prueba en Supabase real (creados y eliminados en la misma sesión)
Pendientes concretos y hallazgos menores: diferido por decisión explícita del usuario -- verificar un dominio propio en Resend (resend.com/domains), configurar NOTIFICATIONS_FROM_EMAIL con un remitente de ese dominio, y opcionalmente usar ese mismo dominio como dominio propio del despliegue de Vercel (en vez de *.vercel.app). Hasta entonces, el aviso de solicitud nueva solo se entrega si el destinatario coincide con la cuenta de Resend en uso, no a los emails reales del equipo del taller -- confirmado de nuevo en esta sesión contra producción
Migraciones preparadas (identificador y finalidad): ninguna en esta sesión
Confirmación explícita del usuario para aplicación real (referencia y alcance): "no quiero comprar ningun dominio todavia... continuemos con el despliegue gratuito en vercel" (alcance y decisión del bloque); "hago un test real controlado en produccion" (elegido entre dos opciones ofrecidas para verificar los secretos de Vercel); "vi el mensaje de sandbox, borra los datos de prueba" (confirmación de la limpieza de los datos de prueba en el taller real)
Migraciones aplicadas/verificadas en Supabase real y evidencia sin secretos: ninguna migración nueva; 001-010 sin cambios (ver sección 5). Sí una limpieza de datos (DELETE, no un cambio de esquema) sobre la solicitud/cliente/vehículo/conversación/evento de auditoría de prueba creados en el taller real durante la prueba contra producción, verificada por lectura directa que desaparecieron
Tests: no aplica (sin cambios de código en esta sesión; el bloque de notificaciones ya tenía 165/165 de la sesión anterior)
Typecheck: no aplica
Lint: no aplica
Build: no aplica (build de producción lo ejecuta Vercel al desplegar; no re-ejecutado localmente en esta sesión)
Pruebas manuales: producción real en `https://talleria-app.vercel.app`. Home, recepción pública y aviso legal responden 200; recepción pública confirmada leyendo Supabase real (nombre real del taller, no demo); /api/notify-new-request valida entrada correctamente. Prueba de extremo a extremo contra producción: solicitud pública real → aviso disparado vía la URL de Vercel → reclamo atómico confirmado en Supabase real → RESEND_API_KEY confirmada correcta por el usuario vía Runtime Logs de Vercel (mensaje de sandbox esperado, no de clave inválida) → datos de prueba eliminados y verificados. Resultado: superada sin hallazgos, salvo el pendiente ya conocido y diferido del dominio de Resend
Revisión de Codex: no aplica en esta sesión (sin cambios de código)
Commit de cierre confirmado: sí -- este cierre se registra en un commit de solo documentación (sin cambios de código), a petición implícita de continuar el flujo habitual del proyecto
Push: confirmado
Despliegue: realizado y verificado -- `https://talleria-app.vercel.app`, por el usuario en su propia cuenta de Vercel, con las comprobaciones de producción de esta sesión
Bloqueos o limitaciones: ninguno técnico para el estado actual; el pendiente del dominio de Resend/NOTIFICATIONS_FROM_EMAIL sigue abierto por decisión explícita del usuario, sin afectar al resto de la app
Próximo paso exacto: pulido visual/UX (fase E), u otro trabajo que el usuario priorice; retomar el dominio propio de Resend/Vercel cuando el usuario decida comprarlo
Actualización de este plan versionada: sí, en el commit que sigue a este cierre
```

```text
Fecha: 25 de septiembre de 2026
Rama y HEAD comprobados: main, HEAD e59c8e1 (despliegue en Vercel documentado) al empezar esta sesión
Bloque actual y alcance: Fase E, pulido visual/UX -- primero recepción pública en móvil (marca, dirección/horario, chat), después panel principal del taller (dashboard)
Estado: en curso
Hecho en esta sesión: (1) Recepción pública en móvil: dirección/horario visibles de forma compacta en vez de ocultos por debajo de 700px, marca/nombre del taller con más presencia visual, y chat/formulario de revisión más compactos para reducir scroll -- todo mediante CSS ya existente reescrito y ampliado, sin tocar la lógica del asistente ni el envío; commiteado y empujado. El usuario pidió revisar el resultado visual en móvil abriendo la extensión Claude in Chrome; no fue posible porque la extensión no está conectada en esta sesión -- se dejó pendiente explícitamente a petición del usuario ("dejamos pendiente la revisión visual de la recepción pública en móvil"). (2) Dashboard: se revisó el componente y el CSS y se propusieron 7 mejoras concretas con su razonamiento (tipografía, protagonismo del banner de recepción, `.agenda-card` oculta entre 900-1250px, efecto de cristal a medias del topbar, hover de tabla, grises inconsistentes, énfasis de la métrica de solicitudes nuevas); el usuario confirmó que le gusta la paleta morada de marca y no la cambiaría; el usuario pidió implementar primero las mejoras 1, 2 y 5. Implementadas: (1) tipografía Inter autoalojada vía `next/font/google` en `src/app/layout.tsx`, quitando el `font-family:Arial,Helvetica` explícito de `body` en `globals.css` para que herede la nueva fuente; (2) banner "comparte tu enlace de recepción" del dashboard reescrito con un fondo plano `--soft-purple` (antes degradado), texto y padding más pequeños, y el collage decorativo de iconos (`banner-art`) ocultado, por duplicar el mensaje ya presente en el widget del sidebar y pesar demasiado en una pantalla de uso diario; (5) hover sutil (`background:#faf9fe`) añadido a las filas de la tabla de "Últimas solicitudes" (compartida con la página de solicitudes completa), igualando el tratamiento que ya tenía `.conversation-row`. Ejecutados tests/typecheck/lint/build tras cada parte
Decisiones confirmadas: mantener la paleta morada de marca sin cambios (confirmado explícitamente por el usuario); empezar la fase E por la recepción pública móvil y seguir por el dashboard; dentro del dashboard, implementar primero las mejoras 1, 2 y 5 de las 7 propuestas, dejando 3, 4, 6 y 7 pendientes para una próxima sesión
Archivos principales: `src/app/globals.css` (recepción pública móvil y dashboard), `src/app/layout.tsx` (fuente Inter), `TALLERIA_PLAN_MAESTRO_FINAL.md` (este cierre)
Pendientes concretos y hallazgos menores: revisión visual real en móvil de la recepción pública, explícitamente pendiente (falta la extensión Claude in Chrome conectada); revisión visual del dashboard en navegador, tampoco hecha por el mismo motivo -- solo verificado que compila y pasa los checks automatizados; de las 7 mejoras propuestas para el dashboard quedan sin implementar: más énfasis visual en la métrica "solicitudes nuevas" (3), resolver el efecto de cristal a medias del topbar (4), dejar de ocultar `.agenda-card` entre 900-1250px (3 de la propuesta original, ojo con la numeración: es la nº 3 de la lista de 7, distinta del punto 3 de esta lista de pendientes), y consolidar los grises de texto secundario sueltos en tokens (6)
Migraciones preparadas (identificador y finalidad): ninguna
Confirmación explícita del usuario para aplicación real (referencia y alcance): no aplica (sin cambios de datos ni Supabase en este bloque); "empieza por 1, 2 y 5" (alcance del subconjunto de mejoras del dashboard a implementar ahora)
Migraciones aplicadas/verificadas en Supabase real y evidencia sin secretos: ninguna; sin cambios de esquema ni de datos en este bloque
Tests: pnpm run test -- 165/165 correctos (ejecutado tras la parte de recepción pública móvil y de nuevo tras la parte de dashboard)
Typecheck: pnpm run typecheck -- sin errores (ambas partes)
Lint: pnpm run lint -- sin errores (ambas partes)
Build: pnpm run build -- correcto (ejecutado tras la parte de dashboard; incluye la descarga y autoalojado de la fuente Inter en build, sin red en runtime)
Pruebas manuales: ninguna superada en esta sesión. Se intentó abrir la extensión Claude in Chrome para revisar visualmente tanto la recepción pública en móvil como el dashboard; en ambos casos la extensión no está conectada, así que la revisión visual queda pendiente para una próxima sesión (explícitamente aceptado por el usuario para la recepción pública; el dashboard no se ha probado visualmente por el mismo motivo, sin que el usuario lo haya pedido todavía)
Revisión de Codex: no solicitada en este bloque (cambios puramente visuales -- CSS y una fuente --, sin tocar base de datos, autorización, aislamiento entre talleres ni la lógica de la recepción pública)
Commit de cierre confirmado: sí, a petición explícita del usuario ("haz commit y push a main") para ambas partes de este bloque
Push: confirmado (ambos commits empujados a main)
Despliegue: no verificado directamente en esta sesión; el push a main dispara el despliegue automático ya configurado en Vercel sobre la misma producción verificada en el bloque anterior (`https://talleria-app.vercel.app`)
Bloqueos o limitaciones: la extensión Claude in Chrome no está conectada en esta máquina/sesión, lo que bloquea toda verificación visual real (recepción pública móvil y dashboard) hasta que el usuario la instale/conecte
Próximo paso exacto: cuando la extensión esté conectada, revisar visualmente la recepción pública en móvil (pendiente explícito) y el dashboard; después, con el usuario, decidir si continuar con el resto de mejoras propuestas para el dashboard (3, 4, 6 y 7 de la lista original) u otro trabajo. No se ha empezado ningún bloque nuevo más allá de este
Actualización de este plan versionada: sí, en el commit que sigue a este cierre
```

```text
Fecha: 26 de septiembre de 2026
Rama y HEAD comprobados: main, HEAD 06ad0b8 (checkpoint del bloque anterior) al empezar esta sesión; working tree limpio, sin nada pendiente de push
Bloque actual y alcance: Fase E, pulido visual/UX -- terminar las 4 mejoras del dashboard que quedaron pendientes de la sesión anterior (3, 4, 6 y 7 de la lista original de 7): énfasis de la métrica "solicitudes nuevas", efecto de cristal a medias del topbar, `.agenda-card` oculta entre 900-1250px, y grises de texto secundario sueltos
Estado: código cerrado; revisión visual real sigue pendiente (mismo bloqueo de sesiones anteriores)
Hecho en esta sesión: (1) Métrica "solicitudes nuevas": la tarjeta con `color="purple"` (única entre las 4 métricas) ahora se distingue visualmente vía `.metric:has(.metric-icon.purple)` -- fondo con degradado sutil hacia `--soft-purple` y el número en `--purple-dark` -- sin tocar el componente `Metric` ni su lógica. (2) Topbar: tenía `background:#ffffffb8` (semitransparente) pero no era `position:sticky` ni tenía `backdrop-filter`, por lo que la transparencia no producía ningún efecto real (el topbar no es fijo, así que nunca hay contenido detrás visible a través de él); se añadió `position:sticky;top:0;z-index:10` y `backdrop-filter:blur(10px)` para que el cristal semitransparente sea real cuando el contenido se desplaza por debajo. (3) `.agenda-card{display:none}` estaba en el bloque `@media(max-width:1250px)`, que también cubre todo el rango por debajo de 900px; se movió esa regla al bloque `@media(max-width:900px)`, de modo que la agenda ahora se sigue mostrando (apilada en una sola columna) entre 900 y 1250px, y solo se oculta por debajo de 900px. (4) Grises: se detectaron mediante análisis de distancia de color (RGB) sobre los ~70 códigos hex usados en `color:` en todo `globals.css` dos grupos de grises casi idénticos (diferencias de 1-15 unidades por canal, imperceptibles en texto de 8-11px) usados una sola vez cada uno en sitios dispersos -- topbar/breadcrumbs, métricas, encabezados de tarjeta, la tabla, la agenda, el placeholder de los inputs, el buscador, la barra de progreso del chat, listas de detalle, estados vacíos, etiquetas de navegación, etc. Se crearon dos tokens nuevos en `:root`, `--muted-2:#a1a2b0` y `--muted-3:#9793aa`, y se reemplazaron sus 18 usos dispersos por `var(--muted-2)`/`var(--muted-3)`, dejando el resto de grises (los que sí eran visualmente distintos entre sí, p. ej. estados de cita o iconos con color) sin tocar para no arriesgar cambios visuales no buscados. Ningún cambio de funcionalidad ni de lógica en ningún punto, solo CSS en `globals.css`. Ejecutados tests/typecheck/lint/build una vez, tras completar las 4 mejoras
Decisiones confirmadas: ninguna decisión de producto nueva; el usuario pidió explícitamente continuar con las 4 mejoras restantes ya acordadas en la sesión anterior, sin modificar funcionalidades existentes ni romper el flujo
Archivos principales: `src/app/globals.css` (único archivo tocado), `TALLERIA_PLAN_MAESTRO_FINAL.md` (este cierre)
Pendientes concretos y hallazgos menores: revisión visual real en navegador/móvil tanto del dashboard como de la recepción pública sigue pendiente -- la extensión Claude in Chrome sigue sin estar conectada en esta sesión (comprobado explícitamente con `tabs_context_mcp`, mismo resultado que en las dos sesiones anteriores). Con esto, el código de la fase E queda completo; el único trabajo que falta en esta fase es esa revisión visual
Migraciones preparadas (identificador y finalidad): ninguna
Confirmación explícita del usuario para aplicación real (referencia y alcance): no aplica (sin cambios de datos ni Supabase en este bloque); "continua con las 4 mejoras restantes del dashboard [...] si todo pasa, haz commit y push a main" (alcance de este cierre)
Migraciones aplicadas/verificadas en Supabase real y evidencia sin secretos: ninguna; sin cambios de esquema ni de datos en este bloque
Tests: pnpm run test -- 165/165 correctos
Typecheck: pnpm run typecheck -- sin errores
Lint: pnpm run lint -- sin errores
Build: pnpm run build -- correcto
Pruebas manuales: ninguna superada en esta sesión; extensión Claude in Chrome no conectada, igual que en las sesiones anteriores
Revisión de Codex: no solicitada en este bloque (cambios puramente visuales -- CSS --, sin tocar base de datos, autorización, aislamiento entre talleres ni la lógica de la recepción pública)
Commit de cierre confirmado: sí, a petición explícita del usuario ("si todo pasa, haz commit y push a main")
Push: pendiente de confirmar en este mismo cierre (ver estado justo después de este bloque de texto)
Despliegue: no verificado directamente en esta sesión; el push a main dispara el despliegue automático ya configurado en Vercel sobre la misma producción verificada en bloques anteriores (`https://talleria-app.vercel.app`)
Bloqueos o limitaciones: la extensión Claude in Chrome sigue sin estar conectada, lo que sigue bloqueando toda verificación visual real del pulido de fase E (dashboard y recepción pública)
Próximo paso exacto: cuando la extensión esté conectada, revisar visualmente en navegador y móvil tanto la recepción pública como el dashboard completo -- único pendiente de la fase E, ya que su código está terminado. No se ha empezado ningún bloque nuevo más allá de este
Actualización de este plan versionada: sí, en el mismo commit que este cierre
```

```text
Fecha: 26 de septiembre de 2026
Rama y HEAD comprobados: main, HEAD 62ab7d9 (checkpoint del bloque anterior) al empezar esta sesión; working tree limpio
Bloque actual y alcance: Fase E, pulido visual/UX -- la extensión Claude in Chrome se conectó durante esta sesión (tras varios intentos fallidos de instalación/reinicio del usuario); el usuario pidió la revisión visual completa del dashboard que quedó pendiente, en escritorio y responsive/móvil, comprobando navegación, layouts, desbordamientos, textos, botones, formularios, tablas, agenda, métricas, topbar y estados visuales, corrigiendo únicamente problemas reales sin cambiar funcionalidades existentes
Estado: revisión completada; ningún hallazgo que corregir
Hecho en esta sesión: se confirmó la conexión de la extensión con `tabs_context_mcp` (tras varios intentos previos fallidos en la misma sesión). Como la producción en Vercel exige login real y el dev local también estaba configurado en modo Supabase real, se levantó `pnpm dev` en modo demo mediante un archivo `.env.development.local` temporal (no commiteado, `.env*` ya está en `.gitignore`) para poder navegar el dashboard con datos ficticios sin usar credenciales reales. Como el entorno de escritorio de esta máquina tiene una ventana de Chrome con un ancho mínimo de ~1045px (no se pudo redimensionar por debajo de eso pese a varios intentos con `resize_window`), los anchos de tablet/móvil (320, 390, 650, 850, 1100, 1300px) se probaron con un iframe auxiliar servido desde `public/responsive-harness.html` (temporal, eliminado al terminar) que carga la app dentro de un contenedor de ancho controlado -- equivalente a la emulación de dispositivo, válido porque todos los breakpoints de esta app son media queries de ancho CSS. Se comprobó, con capturas de pantalla y con `getComputedStyle`/`scrollWidth` vía JavaScript en la página: navegación (sidebar fijo en escritorio, menú hamburguesa + overlay en móvil, funcionando); layout de métricas (4 columnas en escritorio/tablet, 2 columnas por debajo de 900px, la tarjeta de "solicitudes nuevas" con su fondo degradado y valor en color de marca visibles en todos los anchos); `.agenda-card` oculta por debajo de 900px y visible entre 900 y 1250px (el fix de la sesión anterior confirmado exacto); topbar con `position:sticky` y `backdrop-filter:blur(10px)` activos en todos los anchos (confirmado con `getComputedStyle`, y visualmente el contenido de la tabla se ve difuminado al desplazarse bajo el topbar); ausencia de desbordamiento horizontal real (`document.documentElement.scrollWidth - clientWidth` fue 0px en todos los anchos probados, salvo 1px irrelevante a 320px); formulario de registro manual (chat) usable en móvil, con el input y el botón de enviar visibles y sin recortes; tabla de solicitudes con su propio scroll horizontal en móvil (comportamiento ya existente, documentado en el propio CSS, no una regresión); modal de detalle de una solicitud sin overlaps. No se encontró ningún problema real que corregir en el dashboard
Decisiones confirmadas: ninguna decisión de producto nueva; el usuario pidió expresamente enfocar esta revisión en el dashboard (escritorio y responsive/móvil), dejando la recepción pública para otra sesión
Archivos principales: ninguno de producto tocado (solo revisión); `TALLERIA_PLAN_MAESTRO_FINAL.md` (este cierre). Artefactos temporales de la revisión creados y eliminados en la misma sesión: `.env.development.local`, `public/responsive-harness.html`
Pendientes concretos y hallazgos menores: revisión visual real de la recepción pública (móvil) sigue pendiente, no se abordó en esta sesión a petición explícita del usuario (pidió específicamente el dashboard). Con esto, el dashboard de la fase E queda completo (código + revisión visual); solo queda la recepción pública para cerrar toda la fase E
Migraciones preparadas (identificador y finalidad): ninguna
Confirmación explícita del usuario para aplicación real (referencia y alcance): no aplica (sin cambios de datos ni Supabase en este bloque); "realiza la revision visual completa de talleria en chrome que quedo pendiente en la fase E... revisa tanto dashboard en escritorio como responsive/movil... corrige unicamente problemas reales... despues ejecuta tests, typecheck, lint y build. si todo pasa haz commit y push a main y actualiza el plan maestro" (alcance de este cierre)
Migraciones aplicadas/verificadas en Supabase real y evidencia sin secretos: ninguna; sin cambios de esquema ni de datos en este bloque
Tests: pnpm run test -- 165/165 correctos
Typecheck: pnpm run typecheck -- sin errores
Lint: pnpm run lint -- sin errores
Build: pnpm run build -- correcto
Pruebas manuales: sí, superada -- revisión visual real del dashboard en escritorio y responsive/móvil con la extensión Claude in Chrome conectada, sin hallazgos que corregir
Revisión de Codex: no aplica (no hubo cambios de código en este bloque, solo revisión visual)
Commit de cierre confirmado: sí, a petición explícita del usuario ("si todo pasa haz commit y push a main y actualiza el plan maestro"); como no hubo cambios de código que corregir, el único commit de este cierre es la actualización de este plan
Push: confirmado inmediatamente después de este cierre
Despliegue: no aplica (no hubo cambios de código que desplegar)
Bloqueos o limitaciones: ninguno técnico; la revisión visual de la recepción pública queda para otra sesión por decisión de alcance del usuario, no por ningún bloqueo técnico (la extensión ya está conectada)
Próximo paso exacto: revisión visual real de la recepción pública (móvil) con la extensión ya conectada, para cerrar por completo la fase E; después, cuando el usuario lo priorice, el dominio propio de Resend/`NOTIFICATIONS_FROM_EMAIL` diferido en el bloque de notificaciones
Actualización de este plan versionada: sí, en el mismo commit que este cierre
```

```text
Fecha: 26 de septiembre de 2026
Rama y HEAD comprobados: main, HEAD 2eccf72 (checkpoint del dashboard) al empezar esta sesión; working tree limpio
Bloque actual y alcance: Fase E, pulido visual/UX -- el usuario pidió revisar también la recepción pública en móvil, el único punto que quedaba abierto de la fase tras cerrar el dashboard
Estado: revisión completada; se encontró y corrigió un hallazgo real
Hecho en esta sesión: se repitió el método de la revisión anterior del dashboard -- dev server local en modo demo (`.env.development.local` temporal) e iframe auxiliar (`public/responsive-harness.html`, temporal) para alcanzar anchos móviles/tablet, dado que la ventana de Chrome de esta máquina tiene un mínimo de ~1045px. Se descubrió que en modo demo la recepción pública SÍ es navegable sin Supabase real: `src/app/r/[slug]/page.tsx` resuelve el taller vía `publicDemoWorkshop`/`localStorage` cuando `isSupabaseMode` es falso, usando el slug derivado del nombre del taller demo (`taller-motor-norte`). Se revisó visualmente el layout en 320/390/650/900/1000px (marca, dirección/horario compactos, tarjeta de chat) y se midió el desbordamiento horizontal real con `document.documentElement.scrollWidth - clientWidth` vía JavaScript: se encontró desbordamiento real (17px en anchos móviles, hasta 471px a 900px de ancho) en TODOS los anchos probados. Se localizó la causa exacta inspeccionando el elemento infractor con `getBoundingClientRect()` sobre todos los elementos del `<body>`: el campo honeypot anti-bot del formulario (`<input class="sr-only" name="website" tabIndex={-1} aria-hidden>` en `src/components/public-reception.tsx`), pensado para ser invisible con la utilidad `.sr-only` de Tailwind, tenía en la práctica `width:374.667px`, `padding:11px 12px` y borde visible en vez de `width:1px` y sin padding/borde. Causa raíz confirmada con `getComputedStyle`: Tailwind (`@import "tailwindcss"` en la primera línea de `globals.css`) genera sus utilidades dentro de una capa de cascada CSS (`@layer`), y el reset propio de este archivo (`input{width:100%;padding:11px 12px;border:1px solid #dfe2eb;...}`, sin capa) gana siempre frente a reglas en capa, sin importar la especificidad del selector -- así es como funciona la prioridad de `@layer` en CSS. Se validó la hipótesis inyectando una regla de prueba con JavaScript antes de tocar ningún archivo (el desbordamiento bajó a 0px en todos los anchos con la regla de prueba), y solo entonces se aplicó el fix real en `src/app/globals.css`: una regla `input.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}` sin capa (por eso compite en igualdad de condiciones con el reset y gana por mayor especificidad de selector), con un comentario explicando el porqué. Se recargó la página real (no la inyección de prueba) y se confirmó 0px de desbordamiento en 320/390/650/900/1000px. Se probó el flujo del chat completo (escribir un nombre, enviar, avanzar de paso) tras el cambio para confirmar que seguía funcionando sin cambios visuales ni de comportamiento, y se revisó también la página de aviso legal en móvil, sin problemas. No se encontró ningún otro hallazgo
Decisiones confirmadas: ninguna decisión de producto nueva; el usuario pidió expresamente revisar la recepción pública en móvil tras la revisión ya cerrada del dashboard
Archivos principales: `src/app/globals.css` (una regla nueva, `input.sr-only`); `TALLERIA_PLAN_MAESTRO_FINAL.md` (este cierre). Artefactos temporales de la revisión creados y eliminados en la misma sesión: `.env.development.local`, `public/responsive-harness.html`
Pendientes concretos y hallazgos menores: ninguno. Con este cierre, la fase E de pulido visual/UX queda completamente terminada -- código y revisión visual real en dashboard y recepción pública
Migraciones preparadas (identificador y finalidad): ninguna
Confirmación explícita del usuario para aplicación real (referencia y alcance): no aplica (sin cambios de datos ni Supabase en este bloque); "revisa también la recepción pública en móvil" (alcance de este cierre, continuación directa del bloque anterior del dashboard con los mismos criterios: corregir solo problemas reales, tests/typecheck/lint/build, commit y push, actualizar el plan)
Migraciones aplicadas/verificadas en Supabase real y evidencia sin secretos: ninguna; sin cambios de esquema ni de datos en este bloque
Tests: pnpm run test -- 165/165 correctos
Typecheck: pnpm run typecheck -- sin errores
Lint: pnpm run lint -- sin errores
Build: pnpm run build -- correcto
Pruebas manuales: sí, superada -- revisión visual real de la recepción pública en móvil con la extensión Claude in Chrome conectada; hallazgo real encontrado (honeypot no oculto) y corregido; flujo del chat re-verificado tras el fix
Revisión de Codex: no solicitada (fix de una sola regla CSS, de bajo riesgo, verificado con medición de desbordamiento antes/después; sin tocar autorización, aislamiento entre talleres, base de datos ni el envío real del formulario de recepción)
Commit de cierre confirmado: sí, a petición explícita del usuario ("si todo pasa haz commit y push a main y actualiza el plan maestro")
Push: confirmado (commit `9abde5c` del fix, y este cierre del plan, empujados a main)
Despliegue: no verificado directamente en esta sesión; el push a main dispara el despliegue automático ya configurado en Vercel sobre la misma producción verificada en bloques anteriores (`https://talleria-app.vercel.app`)
Bloqueos o limitaciones: ninguno
Próximo paso exacto: la fase E queda cerrada por completo. Cuando el usuario lo priorice: el dominio propio de Resend/`NOTIFICATIONS_FROM_EMAIL` diferido en el bloque de notificaciones, u otro trabajo nuevo que decida
Actualización de este plan versionada: sí, en el mismo commit que este cierre
```

```text
Fecha: 26 de septiembre de 2026
Rama y HEAD comprobados: main, HEAD ba38d5e (checkpoint fase E cerrada) al empezar esta sesión; working tree limpio
Bloque actual y alcance: dos peticiones encadenadas del usuario, ambas fuera de las fases A-E (ya cerradas). Primero, una evaluación de qué falta para un piloto real con un taller (onboarding, Supabase real, despliegue, recepción pública, gestión diaria por empleados, seguridad/permisos, notificaciones, bloqueos críticos), separada en imprescindible/recomendable/futuro, sin implementar nada. Segundo, a partir de uno de los hallazgos de esa evaluación (el aviso legal es una plantilla no revisada), revisar el aviso legal/política de privacidad/protección de datos de la recepción pública pensando en un piloto real en España (RGPD/LOPDGDD), con placeholders para los datos propios de cada taller, sin inventar datos de ningún taller -- diagnóstico primero, implementación después, a petición explícita
Estado: ambas peticiones cerradas
Hecho en esta sesión: (1) Evaluación de piloto: se lanzó un agente de exploración de solo lectura sobre el código (no sobre el plan, que ya se conocía) para verificar hechos concretos -- flujo de onboarding (solo pide el nombre del taller; teléfono/dirección/horario se configuran después en Configuración), invitaciones de equipo (fila en base de datos, sin email automático, el owner comparte el acceso a mano; límite de 20 miembros), protecciones anti-abuso de la recepción pública (honeypot, mínimo 20s antes de enviar, límite de 5 intentos/hora por IP, límites de tamaño de payload; sin CAPTCHA), seguridad/RLS (RLS activo en todas las tablas, todas las escrituras vía RPCs `SECURITY DEFINER`, tests de integración reales contra Postgres para aislamiento multi-taller), variables de entorno de `.env.example` completas, ausencia de monitorización de errores en producción (solo `console.error` y logs de Vercel), contenido del aviso legal actual (autodeclarado como plantilla no revisada por un profesional), seguridad de contraseña (mínimo 8 caracteres, sin 2FA ni bloqueo de intentos), cobertura de tests (fuerte, incluida una suite de integración real contra Postgres), y ausencia de CI automatizado (despliegue manual vía Vercel). Con estos hechos, se entregó al usuario una evaluación organizada en imprescindible antes del piloto (completar Configuración con datos reales, decidir qué hacer con las notificaciones sin dominio de Resend, revisar el aviso legal, confirmar plan/tier de Supabase y Vercel, invitar al equipo a mano), recomendable durante el piloto (monitorización de errores, CI, reforzar Supabase Auth, verificar el derecho de supresión de datos) y funciones futuras (dominio propio de Vercel, invitaciones por email, CAPTCHA/2FA, términos del propio SaaS). No se tocó ningún archivo en esta parte
(2) Revisión y reescritura del aviso legal: se leyó el contenido completo de `src/app/r/[slug]/aviso-legal/page.tsx`, el checkbox de consentimiento y los datos reales que recoge el formulario (`src/components/public-reception.tsx`) para diagnosticar los huecos: faltaba el derecho a reclamar ante la AEPD (obligatorio por el art. 13.2.d RGPD), los derechos no decían cómo ejercerlos (sin canal de contacto concreto), faltaba la cláusula de edad mínima de la LOPDGDD (14 años, más baja que el RGPD por defecto), Resend no aparecía como encargado del tratamiento (solo Supabase), no se resolvían las transferencias internacionales, no había aviso sobre datos sensibles en los campos de texto libre, y el propio texto se autodeclaraba "plantilla no revisada por un profesional" -- inaceptable para que lo vea un cliente real. Se entregó este diagnóstico al usuario junto con una propuesta de texto completo usando placeholders entre corchetes, antes de tocar código, y se le preguntó explícitamente por la región de Supabase y si prefería mantener una sola casilla de consentimiento
El usuario respondió: usar placeholders, comprobar la región de Supabase directamente (no asumirla), mantener una sola casilla, e implementarlo todo para el piloto, revisando escritorio/móvil, pasando todos los checks, y haciendo commit y push. Se comprobó la región de Supabase leyendo (sin escribir nada) el hostname del pooler desde `TALLERIA_DB_URL` con un script Node de una línea que solo imprime el host, nunca la cadena de conexión completa ni credenciales: `aws-1-eu-west-1.pooler.supabase.com`, confirmando que los datos están en la Unión Europea (Irlanda) y que no hace falta cláusula de transferencia internacional para Supabase. Para Resend (proveedor de EE. UU. que solo trata emails del personal, nunca datos de clientes, según `src/lib/notifications.ts`) se añadió una cláusula estándar de cláusulas contractuales tipo, sin necesitar más verificación al no tratar datos de clientes
Se reescribió `src/app/r/[slug]/aviso-legal/page.tsx` con: identificación del responsable (taller + NIF/CIF si está configurado + dirección real ya existente), lista explícita de los datos recogidos (incluida la conversación completa del chat, no solo los campos estructurados), aviso de no incluir datos sensibles en texto libre, finalidad y legitimación sin cambios sustanciales, cláusula de edad mínima de 14 años, sección de destinatarios ampliada con Supabase (UE/Irlanda) y Resend (EE. UU., solo emails del personal, cláusulas contractuales tipo), conservación orientativa (5-6 años, remitiendo a la asesoría del taller para el plazo exacto), derechos con el nuevo canal de contacto y el derecho a reclamar ante la AEPD (con enlace a aepd.es), y confirmación de que no hay decisiones automatizadas. El NIF/CIF y el email de contacto para protección de datos -- únicos datos genuinamente específicos de cada taller que no se debían inventar -- se resolvieron con dos variables de entorno nuevas, `LEGAL_TAX_ID` y `LEGAL_CONTACT_EMAIL` (sin prefijo `NEXT_PUBLIC_`, servidor-only, mismo patrón que `NOTIFICATIONS_FROM_EMAIL`, documentadas en `.env.example`), con fallback a un aviso visible en rojo cuando no están configuradas ("no debe compartirse este enlace con clientes reales hasta completarlo"), en vez de mostrar placeholders en bruto entre corchetes a un cliente real. Se ajustó también el texto del checkbox de consentimiento en `public-reception.tsx` de "protección de datos" a "política de privacidad" para que coincida con el nuevo título de la página, sin añadir una segunda casilla ni cambiar el consentimiento en sí
Verificación visual: se levantó el dev server local en modo demo (`.env.development.local` temporal) y un iframe auxiliar (`public/responsive-harness.html`, temporal) para revisar la página en escritorio y en anchos móviles (320-1000px), en los dos estados -- sin configurar (aviso visible, sin desbordamientos) y con valores de prueba configurados (`LEGAL_TAX_ID=B00000000`, `LEGAL_CONTACT_EMAIL` de prueba con dominio `.local`, aviso desaparece, NIF y enlace `mailto:` se muestran correctamente). Durante esta verificación se encontró un 404 transitorio en la ruta al usarla por primera vez tras el cambio, causado por una caché de `.next` mezclando artefactos de una compilación de producción (`pnpm run build`, ejecutada en el bloque anterior) con el modo dev -- se resolvió con `rm -rf .next` y reinicio del servidor, confirmado que no era un fallo del código nuevo sino de la caché local de esta sesión
Decisiones confirmadas: usar placeholders vía variables de entorno en vez de texto entre corchetes en la página en vivo; verificar la región real de Supabase antes de escribir sobre transferencias internacionales, no asumirla; mantener una única casilla de consentimiento
Archivos principales: `src/app/r/[slug]/aviso-legal/page.tsx` (reescrito), `src/components/public-reception.tsx` (texto del checkbox), `.env.example` (nuevas variables documentadas), `TALLERIA_PLAN_MAESTRO_FINAL.md` (este cierre). Artefactos temporales creados y eliminados en la misma sesión: `.env.development.local`, `public/responsive-harness.html`
Pendientes concretos y hallazgos menores: `LEGAL_TAX_ID` y `LEGAL_CONTACT_EMAIL` siguen sin configurarse en Vercel con los datos reales del taller piloto -- hasta entonces, la producción seguirá mostrando el aviso de "no compartir este enlace". El resto de recomendaciones de la evaluación de piloto (monitorización de errores, CI, confirmar plan/tier de Supabase y Vercel, verificar el derecho de supresión de datos de un cliente) quedan registradas como no bloqueantes, a decidir por el usuario
Migraciones preparadas (identificador y finalidad): ninguna
Confirmación explícita del usuario para aplicación real (referencia y alcance): no aplica (sin cambios de datos ni Supabase en este bloque, solo una lectura del hostname de conexión); "usa placeholders, comprueba tu la region d supabase y manten una sola casilla. implementalo todo para el piloto, revisa el movil y escritorio, pasa todos los tests y has commit y pusch" (alcance de este cierre)
Migraciones aplicadas/verificadas en Supabase real y evidencia sin secretos: ninguna; sin cambios de esquema ni de datos en este bloque
Tests: pnpm run test -- 165/165 correctos
Typecheck: pnpm run typecheck -- sin errores
Lint: pnpm run lint -- sin errores
Build: pnpm run build -- correcto
Pruebas manuales: sí, superada -- revisión visual real del aviso legal en escritorio y móvil, en los dos estados (sin configurar / configurado), sin desbordamientos
Revisión de Codex: no solicitada (cambio de texto legal en una página pública ya existente y dos variables de entorno de solo lectura; sin tocar autorización, aislamiento entre talleres, base de datos ni el envío real del formulario)
Commit de cierre confirmado: sí, a petición explícita del usuario ("has commit y pusch")
Push: confirmado (commit `6d1168f` del aviso legal, y este cierre del plan, empujados a main)
Despliegue: no verificado directamente en esta sesión; el push a main dispara el despliegue automático ya configurado en Vercel sobre la misma producción verificada en bloques anteriores (`https://talleria-app.vercel.app`); recordar que `LEGAL_TAX_ID`/`LEGAL_CONTACT_EMAIL` siguen sin configurarse ahí
Bloqueos o limitaciones: ninguno técnico; falta que el usuario proporcione el NIF/CIF real y un email de contacto real del taller piloto para completar `LEGAL_TAX_ID`/`LEGAL_CONTACT_EMAIL` antes de ir a producción real con clientes
Próximo paso exacto: cuando el usuario tenga los datos reales del taller piloto, configurar LEGAL_TAX_ID y LEGAL_CONTACT_EMAIL en Vercel; después, decidir junto con el usuario cuáles de las recomendaciones no bloqueantes de la evaluación de piloto priorizar (monitorización de errores, CI, dominio de Resend, etc.)
Actualización de este plan versionada: sí, en el mismo commit que este cierre
```

```text
Fecha: 26 de septiembre de 2026
Rama y HEAD comprobados: main, HEAD ecae118 (checkpoint del aviso legal RGPD/LOPDGDD) al empezar esta sesión; working tree limpio
Bloque actual y alcance: continuación directa de la revisión legal anterior. El aviso legal recién reescrito promete el derecho de supresión ("puedes ejercer tu derecho de... supresión... escribiendo a [email]"), pero la app no tenía ningún comando para borrar o anonimizar un cliente -- se propuso como "el siguiente imprescindible" y el usuario confirmó continuar, con tres condiciones explícitas: anonimizar en vez de borrar físicamente, dejar auditoría, y hacerlo seguro para Supabase real
Estado: cerrado (en demo y en código para Supabase real); migración NO aplicada a Supabase real todavía
Hecho en esta sesión: se leyó primero `src/lib/domain.ts` completo (el motor de comandos que domain.ts/execute_command reflejan en paralelo) y el `execute_command` real más reciente (`202609240009_business_hours_fixes.sql`) para entender el patrón exacto de comandos existentes (tipo, validación, versión optimista, auditoría) antes de diseñar uno nuevo. Se revisaron las restricciones reales de las tablas `customers`/`vehicles` (`202609200001_initial.sql`, `202609200002_capacity_security.sql`): `customers.phone` exige un formato de teléfono válido (no puede quedar vacío), pero `phone_e164` sí puede ser `null` y ya no tiene una restricción de unicidad activa a nivel de `phone_normalized` (se retiró en la migración 002 a favor de un índice único parcial sobre `phone_e164 where phone_e164 is not null`) -- esto permitió diseñar la anonimización sin colisiones: teléfono fijo `+00000000` (cumple el formato) y `phone_e164=null` (de lo que realmente dependen el índice único y las búsquedas de cliente por teléfono en altas nuevas/ediciones), de modo que un cliente anonimizado nunca choca con otro y una alta real futura con el mismo teléfono original crea un cliente nuevo en vez de resucitar el anonimizado -- verificado con un test que hace precisamente eso. Se añadió el comando `customer_anonymize` (solo owner, mismo conjunto que `settings`/`resource`/horarios) en `domain.ts` (mutación directa del cliente encontrado y de sus vehículos, versión optimista, sin tocar solicitudes/citas/conversaciones) y una migración nueva, `supabase/migrations/202609260011_customer_erasure.sql`, con `create or replace function execute_command` (cuerpo completo, ya que Postgres exige reemplazar la función entera) añadiendo la misma rama: cada matrícula borrada dejó su propio evento de auditoría `vehicle_plate_erased` (mismo patrón que `vehicle_corrected`, insertando el evento con los valores antiguos antes del `update`), y el evento principal de la operación se resolvió mapeando `customer_anonymize` a `entity_type='customer'` en la lógica genérica de auditoría del final de la función, sin tocar ningún grant/RLS (todo pasa por la misma función `SECURITY DEFINER` ya existente). Se añadió un marcador de texto exportado, `ANONYMIZED_MARKER`, para que tanto `domain.ts` como el editor de cliente reconozcan de forma fiable un cliente ya anonimizado sin depender de comparar teléfonos. En `src/components/editors.tsx`, el editor de cliente ganó un enlace "Anonimizar datos (derecho de supresión)" (oculto para staff y una vez ya anonimizado, mostrando en su lugar "Datos personales ya anonimizados") que abre una pantalla de confirmación explícita dentro del mismo modal antes de ejecutar la acción irreversible
Se añadieron tests: en `domain.test.ts`, un test que cubre el bloqueo a staff, el conflicto de versión, y el resultado esperado (nombre/teléfono/notas sustituidos, matrícula borrada, solicitud conservada); en `database.test.ts` (integración real contra PGlite), un test que reproduce lo mismo contra Postgres real -- incluida la comprobación explícita de que, tras anonimizar, una nueva alta real con el mismo teléfono original crea un cliente distinto en vez de fusionarse con el anonimizado. Este segundo test se insertó deliberadamente ANTES del test existente "limita operaciones repetitivas..." (que deja 100 eventos de auditoría recientes para el mismo usuario/taller) para no disparar el limitador de tasa por contaminación de un test anterior en la misma base de datos compartida del archivo
Verificación visual: se levantó el dev server local en modo demo (`.env.development.local` temporal) y se probó el flujo completo en el navegador -- abrir "Editar cliente", pulsar "Anonimizar datos", ver la pantalla de confirmación con el texto exacto de la advertencia, confirmar, comprobar que la tarjeta del cliente pasa a "Cliente anonimizado" con teléfono `+00000000` y un aviso de notas con la fecha y el motivo, que su vehículo pasa a "Sin matrícula", y que reabrir su editor muestra "Datos personales ya anonimizados" en vez del enlace. Todo verificado sin tocar Supabase real, solo modo demo
Decisiones confirmadas: anonimizar en vez de borrar físicamente; conservar solicitudes/citas/conversaciones para el historial operativo y de garantía del taller; dejar auditoría explícita de la operación; no aplicar la migración a Supabase real sin confirmación explícita aparte (regla ya vigente, reiterada aquí)
Archivos principales: `src/lib/domain.ts` (comando y marcador exportado), `src/lib/domain.test.ts` y `src/lib/supabase/database.test.ts` (tests nuevos), `src/components/editors.tsx` (UI de confirmación), `supabase/migrations/202609260011_customer_erasure.sql` (nueva), `TALLERIA_PLAN_MAESTRO_FINAL.md` (este cierre)
Pendientes concretos y hallazgos menores: la migración 011 está preparada, revisada localmente y probada, pero **no aplicada a Supabase real** -- el comando `customer_anonymize` fallaría con "Operación no reconocida" contra Supabase real hasta que se aplique. No se ha pedido una revisión independiente de Codex para este bloque pese a que toca base de datos y una operación irreversible sobre datos de cliente; sería razonable pedirla antes de aplicar la migración
Migraciones preparadas (identificador y finalidad): `202609260011_customer_erasure.sql` -- añade la rama `customer_anonymize` a `execute_command` para que el derecho de supresión funcione contra Supabase real (anonimiza cliente y vehículos, dos nuevos tipos de evento de auditoría). No aplicada
Confirmación explícita del usuario para aplicación real (referencia y alcance): no se ha pedido ni obtenido en esta sesión; el usuario dijo "sí, sigue. anonimiza en vez de borrar y deja auditoria. hazlo seguro para supabase real" (alcance: implementar el código y la migración de forma segura, no autorización para aplicarla)
Migraciones aplicadas/verificadas en Supabase real y evidencia sin secretos: ninguna en este bloque; 001-010 siguen aplicadas y verificadas (ver sección 5)
Tests: pnpm run test -- 167/167 correctos (165 anteriores + 2 nuevos: domain.test.ts y database.test.ts)
Typecheck: pnpm run typecheck -- sin errores
Lint: pnpm run lint -- sin errores
Build: pnpm run build -- correcto
Pruebas manuales: sí, superada en modo demo -- flujo completo de anonimización probado en el navegador de principio a fin, sin hallazgos
Revisión de Codex: no solicitada en este bloque (ver pendientes arriba -- candidato razonable antes de aplicar la migración a Supabase real, no pedida explícitamente)
Commit de cierre confirmado: sí, a petición explícita del usuario (continuación de "hazlo seguro para supabase real", con el mismo flujo de tests/commit/push ya establecido en el bloque anterior)
Push: confirmado (commit `ad10f4d` del comando/migración/UI, y este cierre del plan, empujados a main)
Despliegue: no verificado directamente en esta sesión; el push a main dispara el despliegue automático ya configurado en Vercel sobre la misma producción verificada en bloques anteriores (`https://talleria-app.vercel.app`); el comando nuevo no tendrá efecto contra Supabase real hasta que la migración 011 se aplique
Bloqueos o limitaciones: ninguno técnico; falta la confirmación explícita del usuario para aplicar la migración 202609260011_customer_erasure.sql a Supabase real
Próximo paso exacto: pedir al usuario confirmación explícita para aplicar la migración 202609260011_customer_erasure.sql a Supabase real; después, retomar las recomendaciones no bloqueantes de la evaluación de piloto (monitorización de errores, CI, LEGAL_TAX_ID/LEGAL_CONTACT_EMAIL en Vercel, dominio de Resend) según lo priorice el usuario
Actualización de este plan versionada: sí, en el mismo commit que este cierre
```

```text
Fecha: 26 de septiembre de 2026
Rama y HEAD comprobados: main, HEAD bb2dd03 (checkpoint del derecho de supresión, código) al empezar esta sesión; working tree limpio
Bloque actual y alcance: aplicar a Supabase real la migración 202609260011_customer_erasure.sql, ya commiteada y probada en el bloque anterior, con confirmación explícita del usuario para esta operación concreta ("sí, aplica la migración 011 a Supabase real")
Estado: cerrado
Hecho en esta sesión: se ejecutó primero `node scripts/apply-migration.mjs supabase/migrations/202609260011_customer_erasure.sql` sin `--confirm` para ver la vista previa exacta del SQL que se iba a ejecutar (el script nunca aplica nada sin ese flag). Confirmada la vista previa, se ejecutó con `--confirm`, y el script devolvió "Migración aplicada" sin errores. Se verificó el resultado con dos consultas de solo lectura vía `db-query.mjs` (nunca se leyó ni imprimió `TALLERIA_DB_URL`): (1) el cuerpo de `execute_command` en `pg_proc` contiene tanto `customer_anonymize` como `vehicle_plate_erased`; (2) los privilegios de la función (`information_schema.routine_privileges`) siguen siendo exactamente `postgres`, `authenticated` y `service_role` con `EXECUTE`, sin ningún privilegio para `anon` ni `public` -- es decir, la migración se aplicó sin alterar accidentalmente los permisos de la función
Decisiones confirmadas: aplicar la migración 011 a Supabase real, exactamente como estaba commiteada, sin modificarla
Archivos principales: ninguno de código (la migración ya estaba commiteada); `TALLERIA_PLAN_MAESTRO_FINAL.md` (este cierre)
Pendientes concretos y hallazgos menores: ninguno nuevo. El comando `customer_anonymize` ya funciona en Supabase real, no solo en demo. No se probó manualmente el comando contra un cliente real de un taller en Supabase (solo se verificó que la función desplegada es correcta); si se quiere una prueba end-to-end contra Supabase real, sería un taller de prueba desechable, no un taller real con clientes reales
Migraciones preparadas (identificador y finalidad): ninguna nueva
Confirmación explícita del usuario para aplicación real (referencia y alcance): sí -- "sí, aplica la migración 011 a Supabase real" (alcance: exactamente esa migración, tal como estaba commiteada en ad10f4d)
Migraciones aplicadas/verificadas en Supabase real y evidencia sin secretos: 011 (`customer_erasure`) aplicada el 26 de septiembre de 2026; verificada por lectura directa de `pg_proc`/`information_schema.routine_privileges`, sin credenciales ni cadenas de conexión mostradas en ningún momento
Tests: sin cambios de código en este bloque; siguen siendo los mismos 167/167 del bloque anterior (ya cubren esta migración vía PGlite)
Typecheck: sin cambios de código en este bloque
Lint: sin cambios de código en este bloque
Build: sin cambios de código en este bloque
Pruebas manuales: verificación de solo lectura contra Supabase real (ver "hecho en esta sesión"); no se ejecutó el comando `customer_anonymize` contra un cliente real
Revisión de Codex: no solicitada (el código ya se había revisado/probado en el bloque anterior; esta sesión solo aplicó esa migración ya escrita)
Commit de cierre confirmado: sí, la actualización del plan; la migración en sí no genera un commit nuevo de código (ya estaba en ad10f4d), solo la aplicación real y este cierre documental
Push: confirmado (este cierre del plan empujado a main)
Despliegue: no aplica un despliegue nuevo; el código ya estaba en producción desde el push anterior, y ahora la migración aplicada hace que ese código funcione también contra Supabase real
Bloqueos o limitaciones: ninguno
Próximo paso exacto: fase F cerrada por completo. Recomendaciones no bloqueantes de la evaluación de piloto siguen pendientes de priorizar por el usuario (monitorización de errores, CI, LEGAL_TAX_ID/LEGAL_CONTACT_EMAIL en Vercel, dominio propio de Resend)
Actualización de este plan versionada: sí, en el mismo commit que este cierre
```

```text
Fecha: 26 de septiembre de 2026
Rama y HEAD comprobados: main, HEAD 2ab1bd2 (checkpoint de la migración 011 aplicada) al empezar esta sesión; working tree limpio
Bloque actual y alcance: el usuario pidió configurar LEGAL_TAX_ID y LEGAL_CONTACT_EMAIL en Vercel. Al no tener datos reales del taller (no se debían inventar) ni acceso al panel de Vercel del usuario ni CLI de Vercel en este entorno, se le pidieron los datos y se le dieron los pasos para hacerlo él mismo. El usuario respondió: dejar eso pendiente por ahora, y en su lugar configurar CI para el proyecto -- una de las recomendaciones no bloqueantes ya registradas en la evaluación de piloto
Estado: CI cerrado; LEGAL_TAX_ID/LEGAL_CONTACT_EMAIL sigue explícitamente pendiente, sin fecha
Hecho en esta sesión: se comprobó que no hay `vercel` CLI instalado en este entorno (`vercel --version` -> comando no encontrado) y que tampoco existía ya ningún directorio `.github`. Se revisó `package.json` (Node >=22.18.0, pnpm 11.19.0 fijado en `packageManager`, scripts `typecheck`/`lint`/`test`/`build` ya existentes) y se confirmó que no hay `.nvmrc` ni configuración de CI previa. Se creó `.github/workflows/ci.yml`: se dispara en push y pull request a `main` (más `workflow_dispatch` manual), usa `actions/checkout`, `pnpm/action-setup` (sin fijar versión, para que tome la del campo `packageManager` de `package.json` automáticamente) y `actions/setup-node` con Node 22 y caché de pnpm, y ejecuta `pnpm install --frozen-lockfile` seguido de `typecheck`, `lint`, `test` y `build`, en ese orden. Antes de commitear, se verificó localmente que el CI no necesitaría ningún secreto: se movió `.env.local` fuera del repositorio (`mv .env.local .env.local.bak`) para simular exactamente un checkout nuevo de CI sin ese archivo (que está en `.gitignore`), se ejecutaron los cuatro comandos completos (typecheck, lint, test con los 167 tests, y build) y los cuatro pasaron sin necesitar ninguna variable de entorno -- el build corre en modo demo por defecto (sin `NEXT_PUBLIC_DATA_MODE` ni claves de Supabase) y los tests de integración usan PGlite embebido, no un proyecto Supabase real. Se restauró `.env.local` a su sitio (`mv .env.local.bak .env.local`) sin ninguna pérdida, y se repitieron los cuatro checks una vez más ya con `.env.local` presente para confirmar que tampoco se había roto nada en el estado normal de desarrollo. Se hizo commit y push del workflow. Tras el push, se confirmó el resultado real consultando la API pública de GitHub Actions con `curl` (sin necesitar el `gh` CLI, tampoco instalado en este entorno): el workflow se disparó automáticamente (evento `push`, rama `main`) y, tras sondear su estado cada 15 segundos, terminó con `status: completed` y `conclusion: success` en su primera ejecución real, validando tanto el propio pipeline como que en efecto no hacía falta ningún secreto de GitHub configurado
Decisiones confirmadas: dejar LEGAL_TAX_ID/LEGAL_CONTACT_EMAIL pendiente por ahora, sin fecha; priorizar en su lugar el CI automatizado
Archivos principales: `.github/workflows/ci.yml` (nuevo); `TALLERIA_PLAN_MAESTRO_FINAL.md` (este cierre)
Pendientes concretos y hallazgos menores: LEGAL_TAX_ID/LEGAL_CONTACT_EMAIL en Vercel sigue pendiente, a la espera de que el usuario aporte el NIF/CIF real del taller y un email de contacto real, y de que él mismo los configure en el panel de Vercel (o me los facilite para guiarlo paso a paso). El CI no está conectado al despliegue de Vercel (son pipelines independientes); si en el futuro se quiere que un CI en rojo bloquee el despliegue, habría que configurarlo explícitamente en Vercel (Ignored Build Step o Git integration) o mover el despliegue a que dependa del propio workflow de GitHub Actions -- no se ha hecho, ni se ha pedido
Migraciones preparadas (identificador y finalidad): ninguna
Confirmación explícita del usuario para aplicación real (referencia y alcance): no aplica (sin cambios de Supabase ni de datos en este bloque); "DEJA ESTO PENDIENTE Y CONFIGURA CI PARA EL PROYECTO" (alcance: aparcar LEGAL_TAX_ID/LEGAL_CONTACT_EMAIL, implementar CI)
Migraciones aplicadas/verificadas en Supabase real y evidencia sin secretos: ninguna en este bloque; 001-011 siguen aplicadas (ver sección 5)
Tests: pnpm run test -- 167/167 correctos, verificado tanto con .env.local presente como ausente (simulando CI)
Typecheck: pnpm run typecheck -- sin errores, en ambos escenarios
Lint: pnpm run lint -- sin errores, en ambos escenarios
Build: pnpm run build -- correcto, en ambos escenarios
Pruebas manuales: no aplica (nada visual que revisar); validación funcional del propio CI confirmada con la ejecución real en GitHub Actions (success)
Revisión de Codex: no solicitada (archivo de configuración de CI, sin tocar código de producto, base de datos, autorización ni aislamiento entre talleres)
Commit de cierre confirmado: sí, a petición implícita del usuario al pedir "configura CI para el proyecto" (se siguió el mismo flujo de checks/commit/push ya establecido)
Push: confirmado (commit `16c8af5` del workflow de CI, y este cierre del plan, empujados a main)
Despliegue: no aplica un despliegue nuevo de la app; el CI en sí no dispara ni bloquea el despliegue de Vercel, que sigue siendo manual vía su integración con git
Bloqueos o limitaciones: ninguno técnico para el CI. LEGAL_TAX_ID/LEGAL_CONTACT_EMAIL siguen bloqueados por falta de datos reales del taller y de acceso al panel de Vercel del usuario, tal como estaba ya documentado; el usuario decidió aparcarlo explícitamente en este bloque
Próximo paso exacto: cuando el usuario lo priorice, retomar LEGAL_TAX_ID/LEGAL_CONTACT_EMAIL en Vercel (con los datos reales del taller) y el resto de recomendaciones no bloqueantes de la evaluación de piloto (monitorización de errores, plan/tier de Supabase y Vercel, dominio propio de Resend)
Actualización de este plan versionada: sí, en el mismo commit que este cierre
```

```text
Fecha: 26 de septiembre de 2026
Rama y HEAD comprobados: main, HEAD c41c2b7 (checkpoint del CI base) al empezar esta sesión; working tree limpio
Bloque actual y alcance: el usuario pidió "conecta el CI al despliegue de Vercel" -- que un CI en rojo bloquee producción, en vez de que el despliegue de Vercel sea completamente independiente del workflow de GitHub Actions añadido en el bloque anterior
Estado: cerrado en el lado de código; falta configuración externa (tres secretos de GitHub + un ajuste en Vercel) para que quede activo de verdad
Hecho en esta sesión: se añadió un job `deploy` a `.github/workflows/ci.yml`, dependiente de `checks` (`needs: checks`) y limitado a un push directo a `main` (nunca en pull requests), siguiendo el flujo oficial documentado por Vercel para desplegar desde GitHub Actions con su propia CLI: `vercel pull --yes --environment=production` (trae las variables de entorno reales de producción del proyecto en Vercel, para que el build sea idéntico al que Vercel haría por su cuenta), `vercel build --prod`, y `vercel deploy --prebuilt --prod`. Para no exigir los secretos desde el primer momento (evitando que el CI se pusiera en rojo simplemente por no estar configurado todavía), se intentó primero un guardián en el propio `if:` del job: `if: ... && secrets.VERCEL_TOKEN != ''` (commit `ec51eb5`). Al hacer push, se comprobó el resultado real de la ejecución consultando la API pública de GitHub Actions (mismo método que en el bloque anterior, sin `gh` CLI): la ejecución terminó en `conclusion: failure`, y al consultar `/actions/runs/{id}/jobs` la respuesta tenía `total_count: 0` -- ningún job llegó siquiera a arrancar, lo que confirma que el fallo era de GitHub Actions rechazando el propio archivo del workflow al analizarlo, no un fallo real de ningún check. La causa: GitHub Actions no permite usar el contexto `secrets` directamente dentro de una condición `if:` a nivel de job (sí está permitido dentro de `env:` y de los `run:` de los steps). Se corrigió (commit `15cca30`) moviendo esa comprobación a un primer step del job (`Check whether Vercel is configured`), que sí puede leer `secrets.VERCEL_TOKEN` a través de una variable de entorno del propio step, y escribe el resultado como un output (`ready=true`/`ready=false`); los cuatro steps siguientes (instalar la CLI, pull, build, deploy) usan `if: steps.vercel_ready.outputs.ready == 'true'` en vez de tocar `secrets` de nuevo. Se hizo push y se verificó la ejecución real por segunda vez: el job `checks` pasó exactamente igual que antes, y el job `deploy` se ejecutó, detectó correctamente que `VERCEL_TOKEN` no existe como secreto todavía, y saltó (`skipped`, no `failure`) los cuatro steps de Vercel -- el resultado global del workflow quedó en `success`, confirmando que el diseño "se salta limpiamente hasta que se configure" funciona de verdad y no solo sobre el papel
Decisiones confirmadas: ninguna decisión de producto nueva; se siguió el pedido explícito del usuario de conectar el CI al despliegue
Archivos principales: `.github/workflows/ci.yml` (job `deploy` añadido y corregido); `TALLERIA_PLAN_MAESTRO_FINAL.md` (este cierre)
Pendientes concretos y hallazgos menores: para que el despliegue quede realmente gobernado por el CI (y no solo listo para estarlo), el usuario debe crear un token de Vercel y añadirlo como secreto de GitHub `VERCEL_TOKEN`, añadir `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` como secretos también, y desactivar (o acotar por rama) el auto-despliegue nativo de Vercel para que `main` no se despliegue dos veces. Ninguno de esos tres pasos se ha hecho en esta sesión -- requieren el panel de Vercel/GitHub del usuario, sin CLI de Vercel ni `gh` CLI disponibles en este entorno
Migraciones preparadas (identificador y finalidad): ninguna
Confirmación explícita del usuario para aplicación real (referencia y alcance): no aplica (sin cambios de Supabase ni de datos en este bloque); "conecta el CI al despliegue de Vercel" (alcance de este cierre)
Migraciones aplicadas/verificadas en Supabase real y evidencia sin secretos: ninguna en este bloque; 001-011 siguen aplicadas (ver sección 5)
Tests: sin cambios de código de la aplicación en este bloque; el job `checks` del CI (que sí ejecuta los 167 tests) siguió pasando en ambas ejecuciones reales
Typecheck: sin cambios; el job `checks` del CI siguió pasando
Lint: sin cambios; el job `checks` del CI siguió pasando
Build: sin cambios; el job `checks` del CI siguió pasando
Pruebas manuales: no aplica (nada visual); validación mediante dos ejecuciones reales del workflow en GitHub Actions, confirmadas por API -- la primera reveló un fallo real (workflow inválido, 0 jobs) que se corrigió antes de dar el bloque por cerrado, la segunda confirmó el comportamiento correcto
Revisión de Codex: no solicitada (archivo de configuración de CI/CD, sin tocar código de la aplicación, base de datos, autorización ni aislamiento entre talleres)
Commit de cierre confirmado: sí, a petición explícita del usuario ("conecta el CI al despliegue de Vercel"), con el mismo flujo de checks/commit/push ya establecido
Push: confirmado (commits `ec51eb5` y `15cca30` del job de deploy y su corrección, y este cierre del plan, empujados a main)
Despliegue: no se ha desplegado nada nuevo ni se ha tocado la configuración de Vercel en esta sesión; el auto-despliegue nativo de Vercel sigue funcionando exactamente igual que antes, sin cambios
Bloqueos o limitaciones: ninguno técnico para lo hecho en esta sesión. Para que el "conectar" quede completo de verdad hacen falta tres secretos de GitHub y un ajuste en el dashboard de Vercel, ninguno de los cuales puedo crear yo sin acceso a esas cuentas
Próximo paso exacto: cuando el usuario quiera terminar de conectar el despliegue, crear el token de Vercel y los IDs de organización/proyecto como secretos de GitHub, y ajustar el "Ignored Build Step" de Vercel para que main no se despliegue dos veces. Mientras tanto, nada se ha roto: Vercel sigue desplegando solo, como siempre
Actualización de este plan versionada: sí, en el mismo commit que este cierre
```
