# Arquitectura del MVP

> **Documento histórico (marcado el 3 de octubre de 2026).** Describe la arquitectura de las primeras iteraciones del MVP (hasta septiembre de 2026) y no se mantiene al día: **no es la especificación actual** del producto ni de su seguridad. Lo vigente está en el código, en [`README.md`](../README.md), en el checkpoint actual de [`TALLERIA_PLAN_MAESTRO_FINAL.md`](../TALLERIA_PLAN_MAESTRO_FINAL.md) y, para las pruebas de seguridad, en [`pentest-scope.md`](pentest-scope.md). Las frases que ya no son ciertas van marcadas como *[Superado: …]*; el resto se conserva como registro de las decisiones de su momento.

Una sola aplicación Next.js (App Router), React, TypeScript estricto y Tailwind CSS. Sin microservicios ni servicios de pago adicionales. La interfaz está en español y funciona en escritorio, tablet y móvil.

## Capas

- `src/app/r/[slug]`: ruta pública de recepción, sin autenticación. Resuelve el taller por slug y monta el formulario público.
- `src/components`: acceso, panel, formularios, recepción (interna y pública) y elementos visuales.
- `src/lib/domain.ts`: entidades, validación y transiciones puras de negocio.
- `src/lib/reception/provider.ts`: contrato de extracción y proveedor simulado de preguntas guiadas.
- `src/lib/reception/use-intake-wizard.ts`: máquina de estados de la conversación guiada, compartida por la recepción interna y la pública.
- `src/lib/reception/public-demo.ts`: contraparte en modo demo (localStorage) de `public_workshop_info`/`public_intake`, para poder enseñar el enlace público sin Supabase.
- `src/lib/repository.ts`: contrato de persistencia y adaptador demo con localStorage.
- `src/lib/supabase`: cliente Auth y adaptador PostgreSQL.
- `supabase/migrations`: esquema, RLS, restricciones y operaciones transaccionales.

La interfaz envía comandos. El adaptador demo aplica las reglas al estado local. El adaptador Supabase envía el comando a PostgreSQL para validación autoritativa y después refresca una única vista paginada. El navegador no es una frontera de seguridad: las funciones comprueban auth.uid() y la membresía del taller, salvo la recepción pública, que por definición no tiene sesión: esa resuelve el taller por slug y usa sus propias defensas (ver más abajo).

## Modelo

Taller → miembros, clientes, vehículos, conversaciones, solicitudes y citas. Todas las entidades operativas tienen workshop_id. Las claves foráneas compuestas impiden enlazar datos de otros talleres. Cada vehículo pertenece a un cliente; una solicitud enlaza conversación, cliente y vehículo; cada solicitud admite una cita activa. Cada taller tiene además un slug único, público y no editable desde la interfaz (se genera al crear el taller), que identifica su enlace de recepción. El canal de una conversación distingue `simulator` (registro manual del equipo) de `public` (el propio cliente, por el enlace).

En esta iteración cada cuenta pertenece a un taller. Muchos talleres independientes pueden coexistir. Invitar empleados o permitir a una cuenta pertenecer a varios talleres necesitará ampliar el onboarding y quitar la unicidad de user_id. *[Superado: las invitaciones de empleados existen desde la migración 005 (`invite_member`, `accept_invitation`, `decline_invitation`, `revoke_invitation`, `remove_member`); cada cuenta sigue perteneciendo a un solo taller.]* La tabla de membresías ya define owner y staff; owner administra configuración y recursos; staff solo realiza operaciones normales. La base de datos aplica esta separación.

## Seguridad y consistencia

- Solo miembros autenticados pueden leer datos mediante RLS.
- anon no tiene acceso a ninguna tabla ni a `execute_command`. Solo dos funciones aceptan llamadas anónimas: `public_workshop_info` (lectura, sin datos de clientes) y `public_intake` (creación de solicitudes), ambas resuelven el taller por slug, nunca por un uuid que el visitante pueda manipular.
- `public_intake` no reutiliza el límite de `execute_command` (100 escrituras/15 recepciones por minuto, indexado por `auth.uid()`, que no existe para un visitante anónimo). En su lugar cuenta intentos por IP *[Superado: desde la migración 017 la clave del límite es la IP de confianza que añade la infraestructura (`cf-connecting-ip`, o la última entrada de `x-forwarded-for`; nunca la primera), agrupada por /64 en IPv6 y con un cupo común si no hay dirección válida; desde la 016 los registros dejan de contar pasada una hora y se borran con el siguiente envío válido]* en `public_intake_attempts` (tabla con RLS activada y sin ninguna política: solo la propia función, como propietaria, lee o escribe en ella) y añade un campo trampa y un tiempo mínimo de conversación; los tres fallan en silencio, sin explicar el motivo a quien los dispara. *[Superado/inexacto: el límite de envíos responde con un mensaje explícito («Demasiados envíos desde esta conexión. Inténtalo más tarde.»).]*
- Las escrituras directas están revocadas: execute_command comprueba permisos y ejecuta operaciones atómicas.
- El bloqueo transaccional de la fila del taller serializa comandos y evita carreras al reservar citas o deduplicar; `public_intake` bloquea la misma fila.
- La recepción, pública o interna, utiliza un UUID de solicitud como clave de idempotencia.
- La agenda admite una cita simultánea por recurso y múltiples recursos por taller. El horario de atención es informativo; no impone turnos automáticamente. *[Superado: desde las migraciones 008/009, el horario semanal y sus excepciones restringen realmente las citas en `execute_command`; un taller sin horario configurado sigue sin restricción.]*
- No se necesita service_role ni claves privadas en el frontend.
- El cliente Supabase usa una sesión en el navegador y RLS; no hay rutas privadas de servidor en esta versión. *[Superado: existe la ruta `/api/notify-new-request`, que en el servidor usa `SUPABASE_SECRET_KEY` (nunca en el navegador) para reclamar una solicitud pública recién creada y avisar por correo al equipo del taller.]* La única llamada a Supabase que corre en el servidor (`/r/[slug]`, para resolver el taller antes de renderizar) usa la misma clave anon pública, sin sesión ni privilegio elevado; no es una ruta privada. Antes de añadir rutas de servidor con privilegio, implementar sesión SSR y verificación de identidad en cada operación de servidor.
- La demo guarda información en localStorage y no constituye autenticación ni almacenamiento apto para datos personales reales.
- Sin carga de archivos: no se provisiona Storage todavía.

## IA e integraciones posteriores

ReceptionProvider entrega datos estructurados independientes de la UI y de la base de datos. MockReceptionProvider mapea respuestas guiadas, sin fingir comprensión de lenguaje libre. Un proveedor real deberá ejecutarse en una ruta de servidor con validación, límites de uso y claves exclusivamente del servidor. La revisión humana permanece antes de crear la solicitud.

El enlace `/r/<slug>` ya es un canal público real: cualquier persona lo usa sin cuenta, y `public_intake` crea su solicitud con las mismas reglas de deduplicación y validación que una recepción interna. Sigue sin haber IA generativa ni WhatsApp/voz: son las mismas ocho preguntas guiadas, expuestas ahora fuera del panel. WhatsApp, n8n y voz deberán entrar por su propia API autenticada con firma del proveedor, resolución segura del taller e idempotencia del evento; no está previsto que reutilicen `execute_command`, que sigue sin exponerse a visitantes anónimos.

Stripe, facturación, stock, diagnóstico, contabilidad y presupuestos quedan fuera del alcance. Vercel puede desplegar este mismo repositorio sin configuración especial. *[Superado: producción se despliega desde el CI de GitHub Actions tras pasar los checks; ver `README.md`.]*

## Evolución

La segunda iteración añade teléfonos E.164, recursos, permisos, versiones, paginación y auditoría. Consulta [decisiones, migración y límites actuales](iteration-2.md).
