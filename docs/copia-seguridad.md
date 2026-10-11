# Copia de seguridad de la base de datos

> Versión del 11 de octubre de 2026. El plan gratuito de Supabase no hace copias automáticas ni permite restaurar desde el panel; Supabase recomienda exportar la base de datos con su CLI (`supabase db dump`) y guardarla fuera de la plataforma. Este procedimiento lo automatiza con `scripts/backup-database.mjs`, sin contratar nada. **Estado: ensayado solo en local con datos ficticios; la primera copia real de producción necesita autorización expresa.**

## 1. Qué contiene y por qué es delicada

Una copia completa contiene **todos los datos personales** de TALLERIA: cuentas (correo, contraseña cifrada, sesiones y tokens de Supabase Auth), clientes, vehículos, conversaciones y citas de los talleres. Por eso:

- **Nunca** se guarda en el repositorio ni se sube a GitHub (el script se niega a escribir dentro del repositorio).
- **Nunca** se guarda en una carpeta sincronizada con OneDrive u otra nube (el script se niega a escribir dentro de OneDrive).
- Se guarda en una carpeta privada de este ordenador o en un disco externo, **preferiblemente cifrado** (pendiente de decidir el método: BitLocker en el disco o un archivo cifrado con contraseña).
- Las copias también conservan los datos de cuentas que se borren después; hay que fijar cuánto tiempo se guardan (ver `docs/politica-conservacion-datos.md`, apartado de copias).

## 2. Requisitos

- Docker en marcha (lo usa la CLI de Supabase para ejecutar `pg_dump`).
- La variable de entorno `TALLERIA_DB_URL` (la misma de `scripts/db-query.mjs`). El script nunca la muestra.
- Node, con las dependencias del proyecto instaladas.
- La primera vez descarga la CLI de Supabase 2.117.0 en una carpeta temporal (no en el repositorio) y la imagen `public.ecr.aws/supabase/postgres:17.6.1.167` (misma versión de PostgreSQL que producción, unos 1,7 GB).

## 3. Hacer una copia

```
node scripts/backup-database.mjs <carpeta-privada>
```

Crea `<carpeta-privada>/talleria-<fecha UTC>/` con:

| Archivo | Contenido |
| --- | --- |
| `roles.sql`, `schema.sql`, `data.sql` | Volcado oficial de la CLI de Supabase: roles, estructura (con los comentarios de las funciones) y datos (incluidas las cuentas de Supabase Auth) |
| `acl.sql` | Permisos exactos de cada función, tabla, vista, secuencia y columna de `public`. Necesario: una base de datos de Supabase concede por defecto permisos a `anon` y `authenticated` al crear cada objeto, y `schema.sql` no los revoca; sin este archivo, la copia restaurada quedaría más abierta que el original |
| `custom-auth-triggers.sql` | Triggers propios sobre `auth.users` (los de las migraciones 019 y 020 cuando estén aplicadas). `schema.sql` no los incluye porque deja fuera el esquema `auth` |
| `auth-pre.sql`, `auth-post.sql` | Estructura del esquema `auth`, solo para restaurar fuera de Supabase y para la comprobación automática |
| `manifest.json` | Huella SHA-256 de cada archivo y huellas del origen (recuento y md5 del contenido de cada tabla de `public` y `auth`; estructura: columnas, tipos, valores por defecto, restricciones, índices, triggers, vistas y tipos; estado de las secuencias; código y permisos de las funciones; permisos de tablas, columnas y esquema; RLS; políticas). No contiene datos |

Lee las huellas del origen **antes y después** de los volcados: si algo cambió entretanto (datos, estructura, permisos o secuencias), rechaza la copia, borra la carpeta y pide repetirla. Después **restaura la copia en un contenedor desechable** y compara sus huellas con las del origen. Solo da la copia por buena si todo coincide:

```
✔ Archivos íntegros (SHA-256 iguales al manifiesto)
✔ Restauración de prueba idéntica al origen: N tablas (M filas); funciones, permisos, RLS, políticas y triggers de auth.users
```

El script solo lee del origen (volcados y consultas de lectura) y solo muestra recuentos, huellas y el resultado. Si la restauración de prueba falla, el diagnóstico de PostgreSQL (que puede citar valores de filas) se guarda en `restauracion-errores.log` dentro de la carpeta de la copia, nunca en la consola, y la carpeta queda marcada con `COPIA-NO-VALIDA.txt`. Si falla antes de la prueba, la carpeta incompleta se borra.

## 4. Verificar una copia existente

```
node scripts/backup-database.mjs --verify <carpeta-de-la-copia>
```

Comprueba que ningún archivo ha cambiado y repite la restauración de prueba. Conviene hacerlo antes de confiar en una copia antigua.

## 5. Restaurar

Restaurar es una operación sobre una base de datos real: requiere autorización expresa para esa operación concreta y no se improvisa. Opciones:

**A. En un proyecto nuevo de Supabase** (el caso normal tras una pérdida). El proyecto nuevo ya trae su esquema `auth`. Con `psql` (por ejemplo, desde la misma imagen de Docker, pasando la contraseña por variable de entorno y nunca en la línea de comandos), en una sola transacción y en este orden:

```
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file roles.sql --file schema.sql --file custom-auth-triggers.sql --file acl.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql
```

Después: comprobar con consultas de lectura que recuentos, permisos y triggers son los esperados, y configurar de nuevo en el panel lo que no está en la base de datos (Auth: URLs, SMTP, plantillas, tiempos de token; variables de Vercel con la nueva URL y claves).

**B. Fuera de Supabase** (cualquier PostgreSQL 17 con los roles de Supabase, como hace la comprobación automática): `roles.sql`, `auth-pre.sql`, `auth-post.sql`, `schema.sql`, `custom-auth-triggers.sql`, `acl.sql` y los datos con `session_replication_role = replica`.

**C. Sobre el mismo proyecto de producción**: no se recomienda sin analizar antes qué se ha perdido; implicaría borrar datos actuales.

## 6. Cuándo hacerla

- Antes de cada migración que se aplique en producción (empezando por la 019 y la 020).
- Periódicamente (frecuencia pendiente de decidir).

## 7. Limitaciones conocidas

- No incluye archivos de Supabase Storage (hoy no hay ninguno) ni la configuración del panel (Auth, claves, URLs).
- Los volcados se hacen en conexiones sucesivas (segundos de diferencia). Un cambio entre ellos se detecta comparando las huellas de antes y de después (salvo el caso teórico de un cambio que se deshaga exactamente antes de la segunda lectura); conviene hacer la copia en un momento sin actividad.
- La comprobación cubre el contenido, la estructura, las secuencias, las funciones, los permisos, RLS, las políticas y los triggers de `public` y `auth`; no cubre otros esquemas internos de la plataforma, que Supabase recrea en cada proyecto.
- La comprobación automática restaura el esquema `auth` desde la propia copia; un proyecto nuevo de Supabase usa el de su versión de Supabase Auth, que podría ser más reciente (Supabase admite datos de versiones anteriores, pero conviene comprobarlo al restaurar).
- La copia hereda la versión de PostgreSQL 17.6 de producción; si Supabase actualiza la versión del proyecto, hay que actualizar la imagen fijada en el script.
