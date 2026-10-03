# TALLERIA

Recepción digital y gestión de clientes para talleres mecánicos pequeños y medianos. Cada taller tiene un enlace público de recepción que sus clientes usan sin cuenta: **enlace público → conversación guiada → revisión de datos → solicitud → cliente y vehículo → cita**. El panel conserva además un registro manual para consultas que llegan por teléfono, una agenda con calendario día/semana y una ficha con el historial de cada cliente y vehículo.

Producción: **https://talleria-app.vercel.app**. El estado detallado del proyecto, las decisiones y lo pendiente están en [`TALLERIA_PLAN_MAESTRO_FINAL.md`](TALLERIA_PLAN_MAESTRO_FINAL.md) (el checkpoint actual de su sección 12 es la fuente de verdad).

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
2. Ve a **Configuración** y copia tu enlace de recepción (`/r/<slug-del-taller>`). Ábrelo en una pestaña nueva del mismo navegador (no en incógnito: la demo vive en el almacenamiento local de este perfil) y responde las ocho preguntas como si fueras un cliente (en matrícula y observaciones puedes escribir «omitir»; si no sabes el modelo, «no lo sé» lo deja como «Modelo no indicado»); al enviarlo verás la solicitud aparecer en el panel, ya organizada.
3. Prueba también **Registrar solicitud manual**, para el caso de una consulta que llega por teléfono: responde las mismas ocho preguntas, revisa o corrige el resumen y pulsa **Confirmar y crear solicitud**.
4. Abre cualquiera de las nuevas solicitudes. Comprueba el cliente, el vehículo, la conversación y su origen («Recepción digital» o «Registro manual»).
5. Pulsa **Crear cita**, elige una fecha futura y guarda. Las horas se introducen en la zona horaria del taller.
6. En **Citas**, usa la vista **Calendario** (día/semana): un clic en un hueco libre crea una cita en ese hueco; los días y huecos ya pasados no se pueden reservar. La vista **Lista** permite buscar por motivo, cliente o matrícula y filtrar por estado. Prueba reprogramar, completar o cancelar: el estado de la solicitud se actualiza.
7. En **Clientes** y **Vehículos**, crea o edita registros y pulsa **Ver historial** para ver sus solicitudes (hasta las 200 más recientes) y las citas de esas solicitudes. En **Configuración**, cambia los datos del taller, el horario semanal y las excepciones (festivos, cierres).
8. Recarga para comprobar que tus cambios demo permanecen.

El enlace de recepción también funciona en modo demo (sin Supabase): usa el almacenamiento local del navegador, así que solo verás las solicitudes que envíes en la misma pestaña o dispositivo.

Las coincidencias de teléfono reutilizan clientes. La matrícula evita duplicar vehículos y avisa si pertenece a otra persona. Una solicitud tiene como máximo una cita activa. Cada cita ocupa un recurso del taller. Un mismo recurso no admite solapamientos; recursos diferentes sí. Las citas deben caber dentro del horario del taller. Configura puestos, mecánicos o elevadores en Configuración. Prueba owner/staff con el selector demo.

## Tecnología y estructura

Next.js 16 (App Router), React 19, TypeScript estricto, Tailwind CSS, Supabase Auth y PostgreSQL. Correo con Resend y monitorización de errores con Sentry, ambos opcionales. No hay integraciones de pago.

```text
src/
  app/                    Página principal, layout, estilos responsive
    r/[slug]/             Ruta pública de recepción (sin cuenta) y su aviso legal
    terminos/             Términos de servicio que acepta el taller al darse de alta
    api/notify-new-request/  Única ruta API: aviso por correo de una solicitud pública nueva
  components/             Panel, acceso, recepción, calendario, horarios, formularios y componentes UI
  lib/
    domain.ts             Entidades, validaciones y reglas de negocio
    demo.ts               Datos ficticios
    repository.ts         Contrato de persistencia y almacenamiento demo
    reception/            Preguntas guiadas, asistente compartido y recepción pública en modo demo
    supabase/             Cliente Auth y adaptador de datos real
    security.ts           Comprobación de la clave pública y cabeceras de seguridad
  instrumentation*.ts     Inicialización de Sentry (solo si hay DSN)
supabase/migrations/      Tablas, separación por taller, permisos y comandos (001 a 017)
scripts/                  Consulta de solo lectura y aplicación de migraciones con TLS verificado (uso interno)
.github/workflows/ci.yml  Checks en cada push/PR y despliegue a producción
docs/                     Notas históricas de arquitectura y de la segunda iteración
```

Consulta [la arquitectura](docs/architecture.md) para conocer las relaciones y las decisiones de seguridad iniciales; recoge el diseño de las primeras iteraciones, no todos los cambios posteriores (para eso, el plan maestro).

## Activar Supabase (opcional)

El desarrollo y la demo funcionan sin este paso.

1. Crea o selecciona un proyecto de Supabase. No necesitas contratar un plan de pago para probar.
2. Aplica las migraciones de `supabase/migrations` en orden (001 a 017). Si ya tienes algunas aplicadas, ejecuta solo las pendientes; no reapliques las anteriores. Realiza una copia de seguridad antes de migrar datos reales. [Las notas de la segunda iteración](docs/iteration-2.md) explican el detalle de las primeras migraciones.
3. Copia `.env.example` a `.env.local` y configura:
   - `NEXT_PUBLIC_DATA_MODE=supabase`
   - `NEXT_PUBLIC_SUPABASE_URL`: URL del proyecto.
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: clave pública/publishable del proyecto.
4. Reinicia `pnpm dev`. Registra una cuenta: hay que aceptar los términos de servicio (`/terminos`). Si está activada la confirmación por correo, confírmala y luego inicia sesión.
5. Crea el nombre de tu taller desde el onboarding. El espacio real comienza vacío; prueba el flujo compartiendo tu enlace de recepción (visible en Configuración) o con el registro manual.
6. En Supabase Auth → URL Configuration configura la Site URL y las Redirect URLs (localmente `http://localhost:3000`; en producción la URL del despliegue).

Variables opcionales (todas documentadas en `.env.example`; sin ellas la app funciona igual):

- `SUPABASE_SECRET_KEY`, `RESEND_API_KEY` y `NOTIFICATIONS_FROM_EMAIL`: aviso por correo al equipo del taller cuando llega una solicitud pública. La clave secreta solo se usa en el servidor.
- `LEGAL_TAX_ID` y `LEGAL_CONTACT_EMAIL`: identificación del taller en el aviso legal de la recepción pública. Sin ellos, esa página avisa de que no debe compartirse el enlace todavía.
- `OPERATOR_NAME`, `OPERATOR_TAX_ID` y `OPERATOR_CONTACT_EMAIL`: quien opera TALLERIA, en `/terminos`. Sin ellos, la página muestra «términos pendientes de completar». No los rellenes con datos inventados ni de otra persona.
- `NEXT_PUBLIC_SENTRY_DSN`: monitorización de errores (sin Session Replay ni trazas de rendimiento).

No guardes `.env.local` en Git. **No uses una clave service_role ni secret** en variables públicas. No hay secretos en este repositorio. Las tablas permiten lectura solo a miembros del taller; las escrituras pasan por funciones que verifican la identidad y ejecutan cada operación como una transacción.

La sesión se gestiona en el navegador con Supabase Auth. Las tablas están protegidas por RLS. La única ruta API es `/api/notify-new-request`, que solo envía el aviso por correo de una solicitud pública recién creada. Supabase Storage se añadirá cuando haya una necesidad concreta de archivos; no se ha creado un bucket innecesario.

## Recepción pública y automatizaciones futuras

El enlace `/r/<slug>` es un canal público real: cualquier persona puede escribir su consulta sin cuenta ni iniciar sesión, y `public_intake` la valida y organiza igual que una solicitud creada por el equipo del taller. Exige aceptar el aviso legal. Las preguntas siguen siendo guiadas y mapeadas al resumen: **no usa una IA generativa real** todavía. El contrato `ReceptionProvider` permite sustituir la extracción manteniendo el resto del flujo; una IA real requerirá una ruta de servidor, variables privadas y validación de su respuesta, con revisión humana antes de crear la solicitud, igual que ahora.

El acceso anónimo se limita a exactamente dos funciones (`public_workshop_info` y `public_intake`) protegidas con un campo trampa, un tiempo mínimo de conversación y un límite de 5 envíos por hora y taller desde una misma conexión, dentro de la propia base de datos. La conexión se identifica con la IP de confianza que añade la infraestructura de Supabase (no con lo que envíe el navegador; en IPv6, por su red /64), y esos registros dejan de contar para el límite pasada una hora y se borran con el siguiente envío válido (sin envíos, se conservan hasta entonces; el aviso legal lo explica). Un CAPTCHA invisible queda como mejora futura.

Cuando llega una solicitud pública, el panel la avisa (comprobación cada 30 segundos, en pausa mientras la pestaña no está visible) y, si están configuradas las variables de correo, se envía un aviso a los emails del equipo del taller (como mucho uno cada 2 minutos por taller, sin datos del cliente). Sin un dominio propio verificado en Resend, ese correo solo llega al email de la cuenta de Resend.

WhatsApp, n8n, llamadas, pagos, diagnóstico automático, facturación, stock y contabilidad no están implementados.

## Seguridad

Todas las rutas envían cabeceras de seguridad (`X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'`, `nosniff`, `Referrer-Policy` y `Permissions-Policy`), definidas en `src/lib/security.ts`. No hay una Content-Security-Policy completa para scripts y conexiones (decisión documentada en el plan maestro). Para la anonimización de clientes (derecho de supresión) y la conservación de datos, consulta el plan maestro.

## Verificaciones

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm start
```

El CI de GitHub Actions ejecuta typecheck, lint, test y build en cada push y pull request a `main`. Para revisar dependencias: `pnpm audit --prod`.

Las pruebas de dominio verifican deduplicación, enlaces, idempotencia, conflictos de matrículas, horarios, zonas horarias y transiciones de estados. También se ejecutan las migraciones en PostgreSQL embebido (PGlite) para verificar permisos, aislamiento y atomicidad, sin credenciales ni conexión a Supabase: recepción pública (acceso anónimo acotado a sus dos funciones, campo trampa, envío demasiado rápido, límite por conexión y borrado de los registros de IP), anonimización y migración de datos anteriores. Los pasos de prueba manual están arriba.

## Desplegar en Vercel

Producción se despliega desde GitHub Actions (`.github/workflows/ci.yml`): en cada push a `main`, si los checks pasan, el job «Deploy to Vercel (production)» ejecuta `vercel pull`, `vercel build --prod` y `vercel deploy --prebuilt`. Necesita los secretos de GitHub `VERCEL_TOKEN`, `VERCEL_ORG_ID` y `VERCEL_PROJECT_ID`; sin el token, el job arranca pero omite sus pasos de instalación y despliegue, sin fallar. En Vercel, el «Ignored Build Step» evita que Vercel despliegue también por su cuenta.

Las variables de entorno de producción viven en Vercel (el build las obtiene con `vercel pull`). Sin variables tendrás la demo. Para el modo real configura al menos las tres variables de Supabase y ajusta la Site URL y las Redirect URLs de Supabase Auth a la URL del despliegue. Un cambio de variables requiere un nuevo build.

## Pendiente antes de usarlo con clientes reales

La lista vigente y su detalle están en el checkpoint actual del plan maestro. En resumen:

- Identificar a quien opera TALLERIA (`OPERATOR_*`), los datos legales del taller piloto (`LEGAL_*`) y resolver la situación legal/fiscal; revisión profesional de `/terminos` y del aviso legal; confirmar la ubicación de Vercel y Sentry y las garantías de transferencia internacional.
- Decidir si el alta de talleres debe seguir abierta en producción mientras los términos estén incompletos.
- Revisar las condiciones de los planes gratuitos para un uso real (Vercel Hobby; pausa por inactividad y copias de seguridad de Supabase Free).
- Definir el procedimiento de baja de un taller (hoy se pide por email, según `/terminos`).
- Dominio propio en Resend si el taller necesita los avisos por correo.
- Canales reales (WhatsApp, voz) y proveedor IA quedan fuera del alcance actual.

Consulta también [las decisiones y configuración de la segunda iteración](docs/iteration-2.md) (notas históricas).
