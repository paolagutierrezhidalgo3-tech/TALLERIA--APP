# TALLERIA

Recepción digital y gestión de clientes para talleres mecánicos pequeños y medianos. Cada taller tiene un enlace público de recepción que sus clientes usan sin cuenta: **enlace público → conversación guiada → revisión de datos → solicitud → cliente y vehículo → cita**. El panel conserva además un registro manual para consultas que llegan por teléfono.

## Probar en tu ordenador

Necesitas Node.js 22.18 o posterior (recomendado: Node.js 22 LTS) y pnpm.

```bash
git clone https://github.com/paolagutierrezhidalgo3-tech/TALLERIA--APP.git
cd TALLERIA--APP
npm install -g pnpm@11.19.0
pnpm install
pnpm dev
```

Abre **http://localhost:3000** y pulsa **Explorar demo**. No hacen falta cuentas externas ni variables de entorno. Si ya tienes la copia del repositorio, actualízala con `git pull` antes de instalar.

Los cambios demo se guardan en este navegador con localStorage. Utiliza datos ficticios. «Restablecer demo» elimina los cambios locales y recupera los ejemplos. La demo no tiene autenticación real y no comparte datos entre dispositivos.

## Recorrido recomendado (5 minutos)

1. Entra en la demo y explora el dashboard.
2. Ve a **Configuración** y copia tu enlace de recepción (`/r/<slug-del-taller>`). Ábrelo en una pestaña nueva o de incógnito y responde las ocho preguntas como si fueras un cliente (en matrícula y observaciones puedes escribir «omitir»); al enviarlo verás la solicitud aparecer en el panel, ya organizada.
3. Prueba también **Registrar solicitud manual**, para el caso de una consulta que llega por teléfono: responde las mismas ocho preguntas, revisa o corrige el resumen y pulsa **Confirmar y crear solicitud**.
4. Abre cualquiera de las nuevas solicitudes. Comprueba el cliente, el vehículo, la conversación y su origen («Recepción digital» o «Registro manual»).
5. Pulsa **Crear cita**, elige una fecha futura y guarda.
6. En **Citas**, prueba reprogramar, completar o cancelar. El estado de la solicitud se actualiza.
7. En **Clientes** y **Vehículos**, crea o edita registros. En **Configuración**, cambia los datos del taller.
8. Recarga para comprobar que tus cambios demo permanecen.

El enlace de recepción también funciona en modo demo (sin Supabase): usa el almacenamiento local del navegador, así que solo verás las solicitudes que envíes en la misma pestaña o dispositivo.

Las coincidencias de teléfono reutilizan clientes. La matrícula evita duplicar vehículos y avisa si pertenece a otra persona. Una solicitud tiene como máximo una cita activa. Cada cita ocupa un recurso del taller. Un mismo recurso no admite solapamientos; recursos diferentes sí. Configura puestos, mecánicos o elevadores en Configuración. Prueba owner/staff con el selector demo.

## Tecnología y estructura

Next.js App Router, React, TypeScript estricto, Tailwind CSS, Supabase Auth y PostgreSQL. No hay integraciones de pago.

```text
src/
  app/                  Página principal, layout, estilos responsive
    r/[slug]/            Ruta pública de recepción (sin cuenta)
  components/           Panel, acceso, recepción, formularios y componentes UI
    public-reception.tsx Formulario público que usa la ruta r/[slug]
  lib/
    domain.ts           Entidades, validaciones y reglas de negocio
    demo.ts             Datos ficticios
    repository.ts       Contrato de persistencia y almacenamiento demo
    reception/          Preguntas guiadas, asistente compartido y recepción pública en modo demo
    supabase/           Cliente Auth y adaptador de datos real
supabase/migrations/    Tablas, separación por taller, permisos y comandos
docs/architecture.md    Decisiones y límites del MVP
```

Consulta [la arquitectura](docs/architecture.md) para conocer las relaciones, decisiones de seguridad y la evolución prevista.

## Activar Supabase (opcional)

El desarrollo y la demo funcionan sin este paso.

1. Crea o selecciona un proyecto de Supabase. No necesitas contratar un plan de pago para probar.
2. Aplica las migraciones de `supabase/migrations` en orden (001 a 006). Si la inicial ya está aplicada, ejecuta solo las pendientes. Consulta [la guía de actualización](docs/iteration-2.md) y realiza una copia de seguridad antes de migrar datos reales.
3. Copia `.env.example` a `.env.local` y configura:
   - `NEXT_PUBLIC_DATA_MODE=supabase`
   - `NEXT_PUBLIC_SUPABASE_URL`: URL del proyecto.
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: clave pública/publishable del proyecto.
4. Reinicia `pnpm dev`. Registra una cuenta. Si está activada la confirmación por correo, confírmala y luego inicia sesión.
5. Crea el nombre de tu taller desde el onboarding. El espacio real comienza vacío; prueba el flujo compartiendo tu enlace de recepción (visible en Configuración) o con el registro manual.
6. En Supabase Auth → URL Configuration configura la Site URL (localmente `http://localhost:3000`; en producción la URL del despliegue).

No guardes `.env.local` en Git. **No uses una clave service_role** en variables públicas. No hay secretos en este repositorio. Las tablas permiten lectura solo a miembros del taller; las escrituras pasan por funciones que verifican la identidad y ejecutan cada operación como una transacción.

La sesión se gestiona en el navegador con Supabase Auth. Las tablas están protegidas por RLS. No hay endpoints privados SSR en esta versión. Supabase Storage se añadirá cuando haya una necesidad concreta de archivos; no se ha creado un bucket innecesario.

## Recepción pública y automatizaciones futuras

El enlace `/r/<slug>` es un canal público real: cualquier persona puede escribir su consulta sin cuenta ni iniciar sesión, y `public_intake` la valida y organiza igual que una solicitud creada por el equipo del taller. Las preguntas siguen siendo guiadas y mapeadas al resumen: **no usa una IA generativa real** todavía. El contrato `ReceptionProvider` permite sustituir la extracción manteniendo el resto del flujo; una IA real requerirá una ruta de servidor, variables privadas y validación de su respuesta, con revisión humana antes de crear la solicitud, igual que ahora.

El acceso anónimo se limita a exactamente dos funciones (`public_workshop_info` y `public_intake`) protegidas con un campo trampa, un tiempo mínimo de conversación y un límite de envíos por IP dentro de la propia base de datos. Antes de anunciar el enlace ampliamente conviene añadir protecciones a nivel de servidor/CDN (no solo en PostgreSQL).

WhatsApp, n8n, llamadas, pagos, diagnóstico automático, facturación, stock y contabilidad no están implementados. Tampoco hay aviso de nueva solicitud por correo al taller todavía: hoy hay que revisar el panel.

## Verificaciones

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm start
```

Las pruebas de dominio verifican deduplicación, enlaces, idempotencia, conflictos de matrículas, horarios y transiciones de estados. También se ejecuta la migración en PostgreSQL embebido (PGlite) para verificar permisos, aislamiento y atomicidad, sin credenciales ni conexión a Supabase. Incluyen las reglas de la segunda iteración, la migración de datos anteriores y la recepción pública: acceso anónimo acotado a sus dos funciones, campo trampa, envío demasiado rápido y límite por IP. Los pasos de prueba manual están arriba.

## Desplegar en Vercel

Importa **este mismo repositorio** en Vercel. Framework: Next.js; directorio raíz: el raíz del repositorio. Usa `pnpm install --frozen-lockfile` como instalación y `pnpm build` como compilación.

Sin variables tendrás la demo. Para el modo real configura las tres variables anteriores en Vercel y ajusta la Site URL de Supabase a la URL del despliegue. Un cambio de variables NEXT_PUBLIC requiere un nuevo build. No hay un despliegue automático provisionado por este código.

## Pendiente antes de usarlo con clientes reales

- Verificar el proyecto Supabase real y el aislamiento entre cuentas con sus credenciales configuradas, incluida la nueva recepción pública.
- Aviso legal, consentimiento y política de retención/borrado en el formulario público: ya recoge datos de clientes reales, no solo del equipo del taller.
- Notificación (por correo, como mínimo) al taller cuando llega una solicitud pública; hoy no hay aviso, solo el contador del panel.
- Protecciones adicionales de servidor/CDN para el enlace público, más allá del límite por IP dentro de PostgreSQL.
- Sincronización realtime y políticas de retención de auditoría (ya hay paginación y auditoría básica).
- Horarios estructurados y recordatorios (ya hay capacidad por recurso).
- Canales reales (WhatsApp, voz) y proveedor IA, con autenticación de eventos, límites e idempotencia.

Consulta [las decisiones y configuración de la segunda iteración](docs/iteration-2.md).
