# TALLERIA

Recepción digital y gestión de clientes para talleres mecánicos pequeños y medianos. Segunda iteración funcional: **conversación simulada → revisión de datos → solicitud → cliente y vehículo → cita**.

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
2. Abre **Simulador** y responde las ocho preguntas (en matrícula y observaciones puedes escribir «omitir»).
3. Revisa o corrige el resumen y pulsa **Confirmar y crear solicitud**.
4. Abre la nueva solicitud. Comprueba el cliente, el vehículo y la conversación.
5. Pulsa **Crear cita**, elige una fecha futura y guarda.
6. En **Citas**, prueba reprogramar, completar o cancelar. El estado de la solicitud se actualiza.
7. En **Clientes** y **Vehículos**, crea o edita registros. En **Configuración**, cambia los datos del taller.
8. Recarga para comprobar que tus cambios demo permanecen.

Las coincidencias de teléfono reutilizan clientes. La matrícula evita duplicar vehículos y avisa si pertenece a otra persona. Una solicitud tiene como máximo una cita activa. Cada cita ocupa un recurso del taller. Un mismo recurso no admite solapamientos; recursos diferentes sí. Configura puestos, mecánicos o elevadores en Configuración. Prueba owner/staff con el selector demo.

## Tecnología y estructura

Next.js App Router, React, TypeScript estricto, Tailwind CSS, Supabase Auth y PostgreSQL. No hay integraciones de pago.

```text
src/
  app/                  Página principal, layout y estilos responsive
  components/           Panel, acceso, recepción, formularios y componentes UI
  lib/
    domain.ts           Entidades, validaciones y reglas de negocio
    demo.ts             Datos ficticios
    repository.ts       Contrato de persistencia y almacenamiento demo
    reception/          Contrato de proveedor y extracción simulada
    supabase/           Cliente Auth y adaptador de datos real
supabase/migrations/    Tablas, separación por taller, permisos y comandos
docs/architecture.md    Decisiones y límites del MVP
```

Consulta [la arquitectura](docs/architecture.md) para conocer las relaciones, decisiones de seguridad y la evolución prevista.

## Activar Supabase (opcional)

El desarrollo y la demo funcionan sin este paso.

1. Crea o selecciona un proyecto de Supabase. No necesitas contratar un plan de pago para probar.
2. Aplica las cuatro migraciones de `supabase/migrations` en orden (001, 002, 003 y 004). Si la inicial ya está aplicada, ejecuta las pendientes: 002, 003 y 004. Consulta [la guía de actualización](docs/iteration-2.md) y realiza una copia de seguridad antes de migrar datos reales.
3. Copia `.env.example` a `.env.local` y configura:
   - `NEXT_PUBLIC_DATA_MODE=supabase`
   - `NEXT_PUBLIC_SUPABASE_URL`: URL del proyecto.
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: clave pública/publishable del proyecto.
4. Reinicia `pnpm dev`. Registra una cuenta. Si está activada la confirmación por correo, confírmala y luego inicia sesión.
5. Crea el nombre de tu taller desde el onboarding. El espacio real comienza vacío; puedes probar el flujo con el simulador.
6. En Supabase Auth → URL Configuration configura la Site URL (localmente `http://localhost:3000`; en producción la URL del despliegue).

No guardes `.env.local` en Git. **No uses una clave service_role** en variables públicas. No hay secretos en este repositorio. Las tablas permiten lectura solo a miembros del taller; las escrituras pasan por funciones que verifican la identidad y ejecutan cada operación como una transacción.

La sesión se gestiona en el navegador con Supabase Auth. Las tablas están protegidas por RLS. No hay endpoints privados SSR en esta versión. Supabase Storage se añadirá cuando haya una necesidad concreta de archivos; no se ha creado un bucket innecesario.

## IA y automatizaciones

El simulador utiliza preguntas guiadas y mapea las respuestas al resumen: **no usa una IA generativa real**. El contrato `ReceptionProvider` permite sustituir la extracción manteniendo el resto del flujo. Una IA real requerirá una ruta de servidor, variables privadas y validación de su respuesta.

WhatsApp, n8n, llamadas, pagos, diagnóstico automático, facturación, stock y contabilidad no están implementados. El simulador pertenece al panel del taller y no es un canal público de atención.

## Verificaciones

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm start
```

Las pruebas de dominio verifican deduplicación, enlaces, idempotencia, conflictos de matrículas, horarios y transiciones de estados. También se ejecuta la migración en PostgreSQL embebido (PGlite) para verificar permisos, aislamiento y atomicidad, sin credenciales ni conexión a Supabase. Incluyen las reglas de la segunda iteración y migración de datos anteriores. Los pasos de prueba manual están arriba.

## Desplegar en Vercel

Importa **este mismo repositorio** en Vercel. Framework: Next.js; directorio raíz: el raíz del repositorio. Usa `pnpm install --frozen-lockfile` como instalación y `pnpm build` como compilación.

Sin variables tendrás la demo. Para el modo real configura las tres variables anteriores en Vercel y ajusta la Site URL de Supabase a la URL del despliegue. Un cambio de variables NEXT_PUBLIC requiere un nuevo build. No hay un despliegue automático provisionado por este código.

## Pendiente antes de usarlo con clientes reales

- Verificar el proyecto Supabase real y el aislamiento entre cuentas con sus credenciales configuradas.
- Recuperación de contraseña e invitaciones (owner/staff ya tienen permisos diferenciados).
- Sincronización realtime y políticas de retención (ya hay paginación y auditoría básica).
- Horarios estructurados y recordatorios (ya hay capacidad por recurso).
- Política de privacidad, consentimiento y gestión de retención/borrado.
- Canales reales y proveedor IA, con autenticación de eventos, límites e idempotencia.

Consulta [las decisiones y configuración de la segunda iteración](docs/iteration-2.md).
