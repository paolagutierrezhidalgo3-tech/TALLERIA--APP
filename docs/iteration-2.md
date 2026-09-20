# Segunda iteración: decisiones y operación

## Actualizar sin perder la primera iteración

Aplicar las migraciones en orden: 202609200001_initial.sql, 202609200002_capacity_security.sql y 202609200003_paged_workspace.sql y 202609200004_search_versions.sql. Si 001 ya está aplicada, ejecutar las pendientes: 002, 003 y 004. No ejecutar de nuevo la inicial ni reemplazar tablas. Hacer una copia de seguridad antes de migrar datos reales y verificar en un proyecto de pruebas.

002 asigna un «Puesto principal» a cada taller y a sus citas anteriores. Fusiona clientes cuyos teléfonos representan el mismo número: conserva el UUID menor, reasigna vehículos y solicitudes y guarda los campos originales del duplicado en audit_events.metadata.original_customer, visible solo al owner. Los teléfonos antiguos que no se puedan interpretar se conservan con phone_e164 nulo y se señalan para revisión manual. No se inventa un número ni se descarta el cliente.

La demo migra talleria.demo.v1 a talleria.demo.v2; conserva intacta la clave v1 como respaldo. Para datos demo se puede restablecer desde la interfaz. Los datos demo solo están en ese navegador y los roles simulados no son una frontera de seguridad.

## Teléfonos

phone.ts y normalize_phone en PostgreSQL aplican las mismas reglas: número nacional español de nueve cifras que empieza por 6, 7, 8 o 9; prefijo por defecto +34; 00 se convierte en +; se eliminan espacios, guiones, puntos y paréntesis. Se almacena la forma E.164 (+ y hasta 15 cifras), que es la clave de deduplicación por taller.

Se admiten otros países mediante prefijo internacional explícito. La función recibe país por defecto para poder ampliar reglas nacionales posteriormente. Esta validación comprueba formato, no la asignación del número ni que la línea exista. No admite extensiones. Números sin + de otros países requieren un prefijo explícito. La matrícula existente del mismo cliente puede actualizar marca/modelo con los datos revisados de recepción; no cambia de propietario. PostgreSQL registra los valores anteriores de esa corrección.

## Capacidad

Cada cita ocupa un recurso activo: puesto, mecánico o elevador. Un recurso admite una cita simultánea. Recursos distintos pueden tener citas a la misma hora. El owner añade, renombra y desactiva recursos en Configuración; límite MVP de 50, al menos uno activo. Para desactivar uno, sus citas programadas deben reasignarse o cerrarse primero. No se eliminan recursos para preservar el histórico.

Una cita todavía reserva un único recurso, no varios recursos combinados. No hay turnos individuales, vacaciones ni cálculo automático de disponibilidad según horario. El horario del taller sigue siendo informativo. La fila del taller se bloquea durante cada comando: serializa escrituras cortas y evita carreras en solapamientos y unicidad. PostgreSQL es la autoridad, incluso si el navegador tiene datos antiguos.

## Autorización y escritura

owner: toda operación normal, configuración y recursos; acceso de lectura a auditoría. staff: solicitudes, clientes, vehículos, conversaciones y citas; sin configuración, recursos ni auditoría administrativa. execute_command comprueba auth.uid(), membresía y rol antes de ejecutar. La interfaz oculta administración al staff y la base de datos la rechaza aunque llame directamente a RPC.

Se mantienen RLS, claves compuestas por taller, escrituras directas revocadas, funciones de escritura SECURITY DEFINER con search_path vacío y RPC de lectura SECURITY INVOKER. Versiones optimistas en clientes, vehículos, recursos y taller evitan sobrescribir ediciones obsoletas. Errores de unicidad, referencias, campos o carreras se traducen a mensajes controlados. El adaptador no intenta validar unicidad ni capacidad con una página parcial.

La gestión de invitaciones queda pendiente. Para probar staff real: crear/confirmar una cuenta Auth sin crearle un taller; un administrador de confianza añade su UUID a workshop_members con el workshop_id correcto y role='staff', desde SQL Editor. No dar al cliente permisos para insertar membresías. El onboarding crea owners; cada cuenta sigue perteneciendo a un único taller. Un futuro comando de invitación debe reservarse a owner y verificar identidad de destinatario.

## Carga y límites

workspace_snapshot devuelve 25 raíces por página, relaciones necesarias y métricas agregadas de todo el taller. El dashboard carga ocho solicitudes y ocho citas próximas. Las búsquedas se ejecutan en PostgreSQL antes de paginar; los selectores consultan lookup_options (20 resultados), así que permiten encontrar registros fuera de la página actual. Los recursos están acotados a 50 y se muestran las últimas 20 acciones de auditoría. Cada escritura realiza una RPC de comando y una de refresco, sin precarga completa.

Paginación por offset ordenada con UUID de desempate; no ofrece una instantánea congelada entre páginas si entran registros nuevos. Los agregados y búsquedas por texto aún pueden recorrer filas del taller: para volúmenes muy grandes, evolucionar a cursores, búsqueda indexada y métricas materializadas. La demo conserva la colección local completa pero proyecta las mismas páginas y usa Web Locks cuando está disponible.

audit_events registra taller, usuario, acción, entidad y fecha; las migraciones usan usuario nulo. Registros persistentes no se pueden modificar desde clientes. No es un registro de cumplimiento inmutable frente a administradores de la base. Demo conserva hasta 1.000 eventos y PostgreSQL no purga automáticamente; definir retención antes de producción.

Se limitan a 100 escrituras exitosas por usuario/taller/minuto y 15 recepciones/minuto, dentro de la transacción y sin servicio externo. Reintentos idempotentes no suman operaciones. El payload máximo es 64 KiB. Estos límites reducen repetición, pero no cuentan intentos fallidos (rollback) ni limitan tráfico de red/lectura. No son una protección completa contra ataques; antes de abrir un canal público se necesitarán límites en el servidor/gateway, firma de eventos y controles del proveedor.

## Claves y despliegue

Configurar NEXT_PUBLIC_DATA_MODE=supabase, NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. La clave debe ser publishable o JWT anon legado. Un guard en next.config.ts y en el cliente rechaza sb_secret y JWT service_role antes de compilar o crear el cliente. Es una comprobación de configuración, no verificación criptográfica; no imprime la clave.

Configurar Site URL y URLs de redirección en Supabase Auth para el dominio real; confirmar correo e iniciar sesión. Aplicar migraciones antes de activar el modo real. En Vercel importar el mismo repositorio, instalar con pnpm install --frozen-lockfile, compilar con pnpm build, añadir las tres variables y volver a desplegar cuando cambien. No se requiere service_role, Storage, n8n ni proveedor IA para esta iteración.

Next 16.3.5 instalado sí reconoce experimental.useTypeScriptCli: se conserva false junto con workerThreads/cpus porque el verificador en un subproceso falla por permisos en este entorno Windows. No es una opción inválida en esta versión; además se ejecuta typecheck de forma explícita. Revisarlo al actualizar Next.

## Verificación y pendientes

Pruebas de dominio y PostgreSQL/PGlite cubren equivalencia de teléfonos, migración con datos previos, referencias, recursos simultáneos, versiones obsoletas, permisos, RLS, paginación, auditoría e idempotencia/límites. Ejecutar pnpm typecheck, pnpm lint, pnpm test y pnpm build. Probar el flujo conversacional y el cambio de roles demo, la confirmación de cancelación y el móvil.

Falta validar las migraciones y el flujo Auth sobre un Supabase real (PGlite no reemplaza esa validación), provisionar Vercel, recuperación de contraseña, invitaciones, política de retención/consentimiento, realtime y calendario avanzado. No se añaden WhatsApp, telefonía, n8n, Stripe ni IA real. ReceptionProvider permanece desacoplado.

## Cierre de auditoría: búsqueda y concurrencia

Aplicar también `202609200004_search_versions.sql` después de 003. No modifica datos de negocio previos: añade versión 1 a solicitudes y citas existentes y actualiza las funciones de búsqueda y escritura. La demo actualiza su formato a versión 3 conservando la clave local y todos los registros.

Las listas de clientes, vehículos, solicitudes y conversaciones y los selectores de clientes/solicitudes normalizan consulta y texto mediante minúsculas, Unicode NFD y eliminación de marcas combinantes U+0300–U+036F. Así leon/León, garcia/García y martin/Martín coinciden, también con acentos Unicode descompuestos. No cambia el texto guardado ni las reglas de identidad de clientes/vehículos. No requiere extensiones de PostgreSQL.

Los comandos status necesitan la versión leída de la solicitud. appointment necesita request_version y, si reprograma una cita existente, version de esa cita. appointment_status necesita ambas versiones. PostgreSQL comprueba las versiones bajo el bloqueo transaccional existente del taller; la modificación de cita y solicitud incrementa ambas versiones dentro de la misma transacción. Una versión omitida u obsoleta se rechaza con un mensaje de negocio; no se guarda parcialmente ni se añade auditoría de éxito. Crear una cita también rechaza una solicitud obsoleta. Los reintentos de recepción siguen siendo idempotentes.

Los formularios y la confirmación de cancelación conservan la versión del registro que abrió el usuario. Ante un conflicto, «Actualizar datos» vuelve a consultar la vista y cierra el formulario obsoleto; el usuario puede abrirlo de nuevo para revisar y guardar. No hay reintento automático que sobrescriba cambios ajenos. Los selectores remotos incluyen la versión elegida aunque la solicitud esté fuera de la página cargada.

Las nuevas pruebas simulan dos usuarios con la misma versión y verifican que el segundo guardado se rechaza, que las versiones de cita/solicitud se incrementan juntas y que se puede guardar después de refrescar. También comprueban las búsquedas de listas y selectores en demo y PostgreSQL. No se conecta ningún servicio real en este cierre.
