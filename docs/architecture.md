# Arquitectura del MVP

Una sola aplicación Next.js (App Router), React, TypeScript estricto y Tailwind CSS. Sin microservicios ni servicios de pago adicionales. La interfaz está en español y funciona en escritorio, tablet y móvil.

## Capas

- `src/components`: acceso, panel, formularios, recepción y elementos visuales.
- `src/lib/domain.ts`: entidades, validación y transiciones puras de negocio.
- `src/lib/reception/provider.ts`: contrato de extracción y proveedor simulado de preguntas guiadas.
- `src/lib/repository.ts`: contrato de persistencia y adaptador demo con localStorage.
- `src/lib/supabase`: cliente Auth y adaptador PostgreSQL.
- `supabase/migrations`: esquema, RLS, restricciones y operaciones transaccionales.

La interfaz envía comandos. El adaptador demo aplica las reglas al estado local. El adaptador Supabase envía el comando a PostgreSQL para validación autoritativa y después refresca una única vista paginada. El navegador no es una frontera de seguridad: las funciones comprueban auth.uid() y la membresía del taller.

## Modelo

Taller → miembros, clientes, vehículos, conversaciones, solicitudes y citas. Todas las entidades operativas tienen workshop_id. Las claves foráneas compuestas impiden enlazar datos de otros talleres. Cada vehículo pertenece a un cliente; una solicitud enlaza conversación, cliente y vehículo; cada solicitud admite una cita activa.

En esta iteración cada cuenta pertenece a un taller. Muchos talleres independientes pueden coexistir. Invitar empleados o permitir a una cuenta pertenecer a varios talleres necesitará ampliar el onboarding y quitar la unicidad de user_id. La tabla de membresías ya define owner y staff; owner administra configuración y recursos; staff solo realiza operaciones normales. La base de datos aplica esta separación.

## Seguridad y consistencia

- Solo miembros autenticados pueden leer datos mediante RLS.
- anon no tiene acceso a las tablas ni a las funciones operativas.
- Las escrituras directas están revocadas: execute_command comprueba permisos y ejecuta operaciones atómicas.
- El bloqueo transaccional de la fila del taller serializa comandos y evita carreras al reservar citas o deduplicar.
- La recepción utiliza un UUID de solicitud como clave de idempotencia.
- La agenda admite una cita simultánea por recurso y múltiples recursos por taller. El horario de atención es informativo; no impone turnos automáticamente.
- No se necesita service_role ni claves privadas en el frontend.
- El cliente Supabase usa una sesión en el navegador y RLS; no hay rutas privadas de servidor en esta versión. Antes de añadirlas, implementar sesión SSR y verificación de identidad en cada operación de servidor.
- La demo guarda información en localStorage y no constituye autenticación ni almacenamiento apto para datos personales reales.
- Sin carga de archivos: no se provisiona Storage todavía.

## IA e integraciones posteriores

ReceptionProvider entrega datos estructurados independientes de la UI y de la base de datos. MockReceptionProvider mapea respuestas guiadas, sin fingir comprensión de lenguaje libre. Un proveedor real deberá ejecutarse en una ruta de servidor con validación, límites de uso y claves exclusivamente del servidor. La revisión humana permanece antes de crear la solicitud.

WhatsApp, n8n y voz deberán entrar por una API autenticada con firma del proveedor, resolución segura del taller e idempotencia del evento. No exponer execute_command a visitantes anónimos. La recepción actual es una herramienta del taller para probar el flujo, no un enlace público de captación.

Stripe, facturación, stock, diagnóstico, contabilidad y presupuestos quedan fuera del alcance. Vercel puede desplegar este mismo repositorio sin configuración especial.

## Evolución

La segunda iteración añade teléfonos E.164, recursos, permisos, versiones, paginación y auditoría. Consulta [decisiones, migración y límites actuales](iteration-2.md).
