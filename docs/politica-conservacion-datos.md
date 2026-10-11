# Política provisional de conservación y eliminación de datos

> Versión provisional del 11 de octubre de 2026. **Los plazos legales están pendientes de revisión profesional** y este documento no sustituye a esa revisión, ni a los términos de servicio (`/terminos`) ni al aviso legal de la recepción pública. Criterio decidido por la responsable del proyecto: conservar únicamente los datos necesarios por motivos legales y de auditoría, y anonimizar o eliminar los datos personales cuando corresponda.

## 1. Papeles

- **El taller** es el responsable del tratamiento de los datos de sus clientes (nombre, teléfono, vehículo, conversación de la recepción, citas).
- **Quien opera TALLERIA** es encargado del tratamiento de esos datos por cuenta del taller, y responsable de los datos de las cuentas de acceso (correo de las personas del taller) y de la trazabilidad del servicio. La identidad de quien opera TALLERIA está pendiente (`OPERATOR_*` sin configurar).

## 2. Qué datos hay y cuánto se conservan

| Datos | Dónde | Conservación provisional | Al terminar |
| --- | --- | --- | --- |
| Clientes, vehículos, solicitudes, conversaciones y citas de un taller | Base de datos (tablas del taller) | Mientras el taller use TALLERIA | Se eliminan al cerrar el taller (borrado en cascada). Antes, a petición de un cliente, el taller puede anonimizarlo (función existente de anonimización de clientes) |
| Cuenta de acceso de una persona del taller (correo, contraseña cifrada, sesiones) | Supabase Auth | Mientras la cuenta exista | Se elimina al borrar la cuenta |
| Pertenencia al taller y rol | `workshop_members` | Mientras la persona pertenezca al taller | Se elimina al retirarla del taller o al borrar su cuenta |
| Invitaciones al equipo | `workshop_invitations` | Mientras el taller exista, como registro de quién se incorporó y cuándo | Al borrar la cuenta, su correo se sustituye por un valor ficticio y se conserva el resto del registro (migración 020). Al cerrar el taller, se eliminan |
| Registro de auditoría del taller | `audit_events` | Mientras el taller exista (pendiente de fijar un plazo máximo) | Al borrar una cuenta, su correo se elimina de los eventos y se conserva el identificador interno (seudónimo) y el hecho registrado. Al cerrar el taller, se elimina |
| IPs de la recepción pública | `public_intake_attempts` | Solo lo necesario para el límite de envíos (migración 016) | Se borran con el siguiente envío válido o al cerrar el taller |
| Registros técnicos de proveedores (Supabase, Vercel, Sentry) y correos enviados (Resend) | Infraestructura de cada proveedor | Según la retención de cada proveedor (en los planes gratuitos, días) | No se pueden borrar de forma selectiva; deben figurar en los términos |
| Copias de seguridad | Supabase | El plan gratuito no hace copias automáticas | Si se contrata un plan con copias, lo borrado permanece hasta que caduquen; debe indicarse en los términos |

## 3. Reglas de eliminación y anonimización

1. **Baja de una persona del taller (staff):** se borra su cuenta con el borrado normal de Supabase Auth (nunca el borrado "suave", que no elimina datos). Su pertenencia se elimina; su correo desaparece de las invitaciones y de la auditoría; se conserva el hecho auditado (acción, fecha, taller) con un identificador seudónimo.
2. **Baja del propietario y cierre del taller:** primero se cierra el taller, lo que elimina todos sus datos; después se borra la cuenta. La base de datos impide borrar la cuenta del propietario mientras el taller exista (migración 019), para que nunca quede un taller con datos de clientes sin responsable.
3. **Datos con obligación legal de conservación:** hoy la aplicación no guarda facturas ni otros datos con esa obligación. Si los hubiera, se exportarían antes de cerrar el taller y se conservarían fuera de la aplicación el tiempo que marque la ley.
4. **Clientes del taller:** el derecho de supresión lo atiende el taller con la anonimización de clientes; TALLERIA ayuda si el taller lo pide.
5. **Seudónimos:** el identificador interno de una cuenta borrada se conserva en la auditoría porque, una vez borrada la cuenta, nada en la base de datos lo vincula a una persona y permite ver qué acciones hizo un mismo miembro. Pendiente de confirmar en la revisión profesional.

## 4. Límites conocidos

- Si una persona cambia su correo y después otra cuenta se registra con la dirección antigua, el historial anonimizado de la cuenta borrada no afecta a la cuenta nueva, y viceversa (migración 020).
- Una cuenta borrada antes de existir la migración 020 que solo tuviera invitaciones pendientes no deja rastro fiable para anonimizarla después; el procedimiento de producción comprueba que no hay casos así y aplica las migraciones 019 y 020 juntas.
- Una invitación nueva a la dirección de una cuenta creada en el mismo instante en que se borra esa cuenta se trata como una invitación a una dirección sin cuenta.

## 5. Pendiente de decisión o revisión profesional

1. Plazos legales de conservación (de existir) para cada categoría y plazo máximo de la auditoría del taller.
2. Si conservar el identificador seudónimo en la auditoría es adecuado o hay que eliminarlo también.
3. Plazo para atender las solicitudes de baja (provisionalmente, el máximo de un mes del RGPD).
4. Si se ofrece una exportación de los datos del taller antes del cierre, y en qué formato.
5. Si la baja se podrá pedir desde la propia aplicación o solo por correo.
6. Reflejar esta política en `/terminos` y en el aviso legal, incluida la retención de los proveedores y las copias de seguridad.
