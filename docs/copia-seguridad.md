# Copia de seguridad de la base de datos

> Versión del 12 de octubre de 2026. El plan gratuito de Supabase no hace copias automáticas ni permite restaurar desde el panel; Supabase recomienda exportar la base de datos con su CLI (`supabase db dump`) y guardarla fuera de la plataforma. Este procedimiento lo automatiza con `scripts/backup-database.mjs`, sin contratar nada. **Estado: en uso. Primera copia real de producción hecha y verificada el 12 de octubre de 2026 (restauración de prueba idéntica, cifrada; comprobado también su descifrado).**

## 1. Qué contiene y por qué es delicada

Una copia completa contiene **todos los datos personales** de TALLERIA: cuentas (correo, contraseña cifrada, sesiones y tokens de Supabase Auth), clientes, vehículos, conversaciones y citas de los talleres. Por eso:

- **Nunca** se guarda en el repositorio ni se sube a GitHub (el script se niega a escribir dentro del repositorio).
- **Nunca** se guarda en una carpeta sincronizada con OneDrive u otra nube (el script se niega a escribir dentro de OneDrive).
- Se guarda **cifrada** (el script no permite copias sin cifrar) en la carpeta privada `%USERPROFILE%\TALLERIA-COPIAS-PRIVADO\copias`, a la que solo tienen acceso el usuario de Windows y SYSTEM (sin permisos heredados; ver apartado 2).
- Las copias también conservan los datos de cuentas que se borren después; hay que fijar cuánto tiempo se guardan (ver `docs/politica-conservacion-datos.md`, apartado de copias).

## 2. Ubicación y clave de cifrado

Windows 11 Home no permite BitLocker ni EFS, así que el cifrado lo hace el propio script:

- **Carpeta**: `%USERPROFILE%\TALLERIA-COPIAS-PRIVADO` (fuera del repositorio y de OneDrive), con permisos solo para el usuario y SYSTEM: subcarpetas `clave` y `copias`.
- **Cifrado**: cada archivo de la copia se cifra con AES-256-GCM (el nombre del archivo va autenticado, así que no se pueden intercambiar archivos ni alterarlos sin que se note). Al terminar solo quedan los `.enc` y `manifest.json` (huellas, sin datos).
- **Clave**: 32 bytes aleatorios, creados una vez con `node scripts/backup-database.mjs --init-key` y guardados en `clave\backup-key.dpapi`, protegidos con DPAPI de Windows: solo el mismo usuario de Windows en este ordenador puede abrirla, sin teclear nada, así que las copias se hacen y se verifican de forma automática y la clave no se muestra nunca. No se sobrescribe si ya existe.
- **Copia de emergencia de la clave (imprescindible)**: si este ordenador o este usuario de Windows se pierden, las copias solo se pueden abrir con una copia de la clave guardada en tu gestor de contraseñas. Se hace una vez, en una terminal propia (no a través de Claude ni redirigiendo la salida):
  1. `node scripts/backup-database.mjs --export-key` copia la clave al portapapeles **sin mostrarla**, marcada para que no entre en el historial ni en el portapapeles en la nube de Windows, y lo borra a los 60 segundos (o antes con Ctrl+C; nunca borra algo que hayas copiado después). Pégala con Ctrl+V en una entrada nueva del gestor llamada «TALLERIA - clave de copias».
  2. `node scripts/backup-database.mjs --check-key-copy` comprueba esa copia: pegas la clave desde el gestor (no se ve en pantalla) y responde si coincide.

  Ninguna de las dos órdenes funciona fuera de una terminal interactiva, ni muestra la clave, ni la escribe en archivos; la clave tampoco queda en el historial de órdenes, porque nunca se teclea en la línea de comandos. En otro ordenador, la copia del gestor se usa con `--key-env NOMBRE_DE_VARIABLE` (variable creada por ti con esa clave).
- **Comprobación automática**: `node scripts/backup-database.mjs --check-key` confirma, sin mostrarla, que la clave existe, que DPAPI la abre, que tiene 32 bytes, su identificador y que está fuera del repositorio y de OneDrive.
- Cada copia indica en `manifest.json` el identificador público de su clave (no la clave), para saber cuál necesita.

## 3. Requisitos

- Docker en marcha (lo usa la CLI de Supabase para ejecutar `pg_dump`).
- La variable de entorno `TALLERIA_DB_URL` (la misma de `scripts/db-query.mjs`). El script nunca la muestra.
- Node, con las dependencias del proyecto instaladas.
- La primera vez descarga la CLI de Supabase 2.117.0 en una carpeta temporal (no en el repositorio) y la imagen `public.ecr.aws/supabase/postgres:17.6.1.167` (misma versión de PostgreSQL que producción, unos 1,7 GB).

## 4. Hacer una copia

```
node scripts/backup-database.mjs %USERPROFILE%\TALLERIA-COPIAS-PRIVADO\copias
```

Si no encuentra la clave, se detiene antes de volcar nada. Crea `copias/talleria-<fecha UTC>/` con (antes de cifrar):

| Archivo | Contenido |
| --- | --- |
| `roles.sql`, `schema.sql`, `data.sql` | Volcado oficial de la CLI de Supabase: roles, estructura (con los comentarios de las funciones) y datos (incluidas las cuentas de Supabase Auth) |
| `acl.sql` | Permisos exactos de cada función, tabla, vista, secuencia y columna de `public`. Necesario: una base de datos de Supabase concede por defecto permisos a `anon` y `authenticated` al crear cada objeto, y `schema.sql` no los revoca; sin este archivo, la copia restaurada quedaría más abierta que el original |
| `custom-triggers.sql` | Triggers propios sobre tablas de `auth` y `storage` que llaman a funciones de `public` (los de las migraciones 019 y 020 cuando estén aplicadas). `schema.sql` no los incluye porque deja fuera esos esquemas |
| `platform-pre.sql`, `platform-post.sql` | Estructura de los esquemas de la plataforma `auth` y `storage` (el volcado de datos incluye sus filas), solo para restaurar fuera de Supabase y para la comprobación automática |
| `manifest.json` | Huella SHA-256 de cada archivo y huellas del origen (recuento y md5 del contenido de cada tabla de `public`, `auth` y `storage`; estructura: columnas, tipos, valores por defecto, restricciones, índices, triggers, vistas y tipos; estado de las secuencias; código y permisos de las funciones; permisos de tablas, columnas y esquema; RLS; políticas). No contiene datos |

Lee las huellas del origen **antes y después** de los volcados: si algo cambió entretanto (datos, estructura, permisos o secuencias), rechaza la copia, borra la carpeta y pide repetirla. Después **restaura la copia en un contenedor desechable** y compara sus huellas con las del origen. Solo da la copia por buena si todo coincide:

```
✔ Archivos íntegros (SHA-256 iguales al manifiesto)
✔ Restauración de prueba idéntica al origen: N tablas (M filas); estructura, secuencias, funciones, permisos, RLS, políticas y triggers
✔ Copia cifrada (AES-256-GCM, clave <identificador>); los archivos sin cifrar se han borrado
```

Solo después de esa comprobación cifra cada archivo, comprueba que cada `.enc` se descifra exactamente igual y borra los archivos sin cifrar. (Al borrar, el contenido en claro puede seguir recuperable en el disco hasta que se sobrescriba; la carpeta tiene acceso restringido.)

El script solo lee del origen (volcados y consultas de lectura) y solo muestra recuentos, huellas y el resultado. Si la restauración de prueba falla, se borran los archivos de la copia y solo se conserva el diagnóstico de PostgreSQL (que puede citar valores de filas), **cifrado** (`restauracion-errores-<fecha>.log.enc`), nunca en la consola; la carpeta queda marcada con `COPIA-NO-VALIDA.txt`. Si falla antes de la prueba, la carpeta incompleta se borra.

## 5. Verificar una copia existente

```
node scripts/backup-database.mjs --verify <carpeta-de-la-copia>
```

Comprueba los archivos cifrados, los descifra en una subcarpeta temporal dentro de la propia copia (con acceso restringido, se borra al terminar) y repite la restauración de prueba. Conviene hacerlo antes de confiar en una copia antigua.

## 6. Restaurar

Restaurar es una operación sobre una base de datos real: requiere autorización expresa para esa operación concreta y no se improvisa. Primero se descifra la copia en una carpeta privada (fuera del repositorio y de OneDrive) y se vuelve a verificar:

```
node scripts/backup-database.mjs --decrypt <carpeta-de-la-copia> --out <carpeta-privada-nueva>
node scripts/backup-database.mjs --verify <carpeta-privada-nueva>
```

La carpeta descifrada contiene datos personales en claro: se borra en cuanto termina la restauración. Opciones:

**A. En un proyecto nuevo de Supabase** (el caso normal tras una pérdida). El proyecto nuevo ya trae sus esquemas `auth` y `storage` y los roles de la plataforma. Con `psql` (por ejemplo, desde la misma imagen de Docker, pasando la contraseña por variable de entorno y nunca en la línea de comandos), en una sola transacción y en este orden:

```
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file roles.sql --file schema.sql --file custom-triggers.sql --file acl.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql
```

Después: comprobar con consultas de lectura que recuentos, permisos y triggers son los esperados, y configurar de nuevo en el panel lo que no está en la base de datos (Auth: URLs, SMTP, plantillas, tiempos de token; variables de Vercel con la nueva URL y claves).

**B. Fuera de Supabase** (cualquier PostgreSQL 17 con los roles de Supabase, como hace la comprobación automática): `roles.sql`, `platform-pre.sql`, `platform-post.sql`, `schema.sql`, `custom-triggers.sql`, `acl.sql` y los datos con `session_replication_role = replica`.

**C. Sobre el mismo proyecto de producción**: no se recomienda sin analizar antes qué se ha perdido; implicaría borrar datos actuales.

## 7. Cuándo hacerla: copias automáticas diarias

- Antes de cada migración que se aplique en producción (empezando por la 019 y la 020), además de la diaria.
- **Una copia diaria automática** con `node scripts/backup-database.mjs --daily`, programada con el Programador de tareas de Windows (preparado, sin activar; ver más abajo).

**Qué hace `--daily`**, en este orden: comprueba si la última copia válida tiene más de 48 horas (avisa de que faltan copias); arranca Docker Desktop si no está en marcha (espera hasta 4 minutos); hace la copia (con bloqueo para que no haya dos a la vez y limpieza previa de restos); la verifica y la cifra; aplica la rotación; si hay espejo configurado, duplica la copia cifrada y rota el espejo; y lo anota en el registro.

**Conservación (7 diarias y 4 semanales)**: se conserva la última copia válida de cada uno de los 7 días más recientes que tengan copia, más la última copia válida de cada una de las 4 semanas más recientes (semanas ISO) que tengan copia. Siempre se conserva la copia válida más reciente. Las copias fallidas o incompletas se guardan 7 días para diagnóstico y después se borran. Nunca se borra nada si no hay ninguna copia válida, nunca se toca una carpeta que no tenga el nombre de una copia (`talleria-AAAAMMDDTHHMMSSZ`) y **nunca se borra una copia cuya carpeta contenga un archivo `CONSERVAR.txt`** (útil para la copia de antes de una migración). Simulación sin borrar nada: `node scripts/backup-database.mjs --prune <carpeta> --dry-run`.

**Avisos**: si la copia diaria falla, o si falta alguna copia (la última válida tiene más de 48 horas), aparece una notificación de Windows y queda anotado en `%USERPROFILE%\TALLERIA-COPIAS-PRIVADO\registro\copias.log` (solo líneas de estado, nunca datos, claves ni la cadena de conexión). Probar los avisos: `--notify-test`. Ver el estado de las copias: `--status`.

**Limpieza de restos**: antes de cada copia, y con `--sweep <carpeta>`, primero se detienen los procesos y contenedores de volcado que hubieran quedado vivos (Windows no termina los procesos hijos al forzar el cierre del principal): los de la CLI fijada, nuestros contenedores etiquetados de procesos que ya no existen y los contenedores de volcado de la CLI que vuelcan exactamente esta base de datos (mismas cuatro variables de conexión), nunca un volcado o un servidor ajenos; si no se puede comprobar que se han detenido, la copia no continúa y se avisa. Después se borran los archivos en claro y las carpetas temporales que hubiera dejado una copia interrumpida (también por un cierre forzado o un apagón, cuando no pudo actuar la limpieza de emergencia), se eliminan las carpetas de copias que no llegaron a completarse (o se marcan con `COPIA-NO-VALIDA.txt` si tienen algún archivo cifrado) y se borran los contenedores de restauración abandonados. Un único bloqueo del sistema operativo (una tubería con nombre de Windows) impide que se ejecuten a la vez dos operaciones que vuelcan, restauran, rotan o limpian (copia, copia diaria, `--verify`, `--sweep`, `--prune`, `--mirror`); Windows lo libera solo cuando el proceso termina de cualquier forma (también un cierre forzado o un apagón), así que nunca queda un bloqueo abandonado. Los contenedores de restauración llevan una etiqueta con el proceso que los creó: la limpieza solo borra los de procesos que ya no existen. Los restos junto a una copia íntegra no la invalidan: se limpian y la copia conserva su lugar en la rotación.

**Segunda copia en la nube (preparada, sin conectar)**: si en `%USERPROFILE%\TALLERIA-COPIAS-PRIVADO\config.json` se indica `"espejo": "<carpeta>"`, cada copia válida se duplica allí (solo los archivos cifrados `.enc`, `manifest.json` y, si existe, `CONSERVAR.txt`; nunca datos en claro) comprobando cada archivo por su huella, y el espejo sigue la misma rotación (las protecciones `CONSERVAR.txt` de las copias locales se copian al espejo antes de rotarlo). La carpeta espejo puede ser una carpeta sincronizada con un servicio en la nube (OneDrive, Google Drive…) o un disco externo: las copias van cifradas y la clave no está en ellas. Ejemplo de `config.json`:

```
{
  "copias": "C:\\Users\\<usuario>\\TALLERIA-COPIAS-PRIVADO\\copias",
  "espejo": "C:\\Users\\<usuario>\\OneDrive\\TALLERIA-copias-cifradas"
}
```

**Activación** (cuando se decida):

```
powershell -ExecutionPolicy Bypass -File .\scripts\register-backup-task.ps1              # muestra lo que haría
powershell -ExecutionPolicy Bypass -File .\scripts\register-backup-task.ps1 -Registrar   # registra la tarea (21:00)
```

La tarea se ejecuta con tu usuario y solo con tu sesión iniciada (Docker Desktop y la clave protegida lo necesitan). Si el ordenador está apagado a esa hora, se ejecuta en cuanto sea posible. `-Quitar` la elimina.

## 8. Limitaciones conocidas

- No incluye archivos de Supabase Storage (hoy no hay ninguno) ni la configuración del panel (Auth, claves, URLs).
- Los volcados se hacen en conexiones sucesivas (segundos de diferencia). Un cambio entre ellos se detecta comparando las huellas de antes y de después (salvo el caso teórico de un cambio que se deshaga exactamente antes de la segunda lectura); conviene hacer la copia en un momento sin actividad.
- La comprobación cubre el contenido, la estructura, las secuencias, las funciones, los permisos, RLS, las políticas y los triggers de `public`, `auth` y `storage`; no cubre otros esquemas internos de la plataforma, que Supabase recrea en cada proyecto.
- El contenedor de la comprobación automática usa la imagen local de Supabase, a la que le faltan cosas que un proyecto real sí tiene: crea como roles vacíos los roles de la plataforma que `roles.sql` menciona sin crearlos (p. ej. `supabase_realtime_admin`) y sustituye sus esquemas `auth` y `storage` por los de la copia. Compara la posición de cada columna y no su número interno, porque una tabla restaurada no conserva los huecos de columnas borradas hace tiempo (como en `auth.oauth_clients`).
- La comprobación automática restaura los esquemas `auth` y `storage` desde la propia copia; un proyecto nuevo de Supabase usa el de su versión de Supabase Auth, que podría ser más reciente (Supabase admite datos de versiones anteriores, pero conviene comprobarlo al restaurar).
- La copia hereda la versión de PostgreSQL 17.6 de producción; si Supabase actualiza la versión del proyecto, hay que actualizar la imagen fijada en el script.
