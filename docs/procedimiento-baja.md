# Procedimiento para solicitar la baja de una cuenta o de un taller

> Versión provisional del 11 de octubre de 2026. **No hay borrado automático**: cada baja la ejecuta una persona de la administración, a mano y con las comprobaciones de este documento. Requisito técnico previo: las migraciones 019 (borrado de cuentas) y 020 (anonimización) aplicadas en producción; sin ellas, el borrado de una cuenta que haya aceptado o enviado una invitación falla. Política aplicable: `docs/politica-conservacion-datos.md`.

## 1. Cómo se solicita

- **Canal:** correo electrónico a la dirección de contacto de quien opera TALLERIA (pendiente: `OPERATOR_CONTACT_EMAIL`).
- **Quién puede pedirlo:**
  - la propia persona, para la baja de su cuenta;
  - el propietario del taller, para el cierre del taller (y, si quiere, la baja de su cuenta);
  - el propietario puede retirar a una persona del equipo desde la propia aplicación (Equipo), sin borrar su cuenta; borrar la cuenta lo pide la persona.
- **Verificación de identidad:** la solicitud debe llegar desde el correo de la cuenta. Si no, se responde a ese correo pidiendo confirmación y no se actúa hasta recibirla.
- **Clientes de un taller:** quien pida que se borren sus datos como cliente debe dirigirse al taller, que es el responsable y puede anonimizarlo desde la aplicación; si escribe a TALLERIA, se le remite al taller y se avisa al taller.
- **Plazo de respuesta:** provisionalmente, un mes como máximo (pendiente de revisión profesional).

## 2. Baja de una persona del taller (staff)

1. Confirmar la identidad (apartado 1).
2. Comprobación previa, solo lectura (`node scripts/db-query.mjs`, solo recuentos y metadatos): que la cuenta existe y que **no** es propietaria de ningún taller.
3. Borrar la cuenta en el panel de Supabase (Authentication, Users) con el **borrado normal**. Nunca el borrado "suave" (soft delete).
4. Verificación, solo lectura: la cuenta ya no existe; no queda ninguna pertenencia suya; ningún registro de invitaciones ni de auditoría conserva su correo.
5. Responder a la persona confirmando la baja e indicando qué se conserva (el hecho de su incorporación y sus acciones en el registro del taller, sin su correo) y los registros técnicos de proveedores.
6. Anotar la baja (fecha, tipo, comprobaciones hechas) sin datos personales más allá de los necesarios.

## 3. Cierre de un taller y baja del propietario

1. Confirmar la identidad del propietario (apartado 1) y que quiere cerrar el taller con **todos** sus datos. Es irreversible: pedir una segunda confirmación por escrito.
2. Si hay datos con obligación legal de conservación o el taller pide una exportación, prepararla antes (pendiente de decidir el formato; hoy no existe exportación en la aplicación).
3. Comprobación previa, solo lectura: el taller, su propietario, el número de miembros y de registros que se eliminarán.
4. Cerrar el taller: borrar la fila del taller, lo que elimina en cascada clientes, vehículos, solicitudes, conversaciones, citas, recursos, horarios, invitaciones, miembros, auditoría e intentos de la recepción pública. Es una operación sobre la base de datos de producción: requiere autorización expresa para esa operación concreta, como cualquier cambio en Supabase real.
5. Borrar después la cuenta del propietario (y las de los miembros que lo hayan pedido) como en el apartado 2. Las cuentas de los miembros que no pidieron la baja siguen existiendo, sin taller.
6. Verificación, solo lectura: no queda ningún dato del taller; la cuenta ya no existe.
7. Responder y anotar como en el apartado 2.

## 4. Qué no hacer

- No borrar la cuenta de un propietario sin cerrar antes su taller: la base de datos lo impide y Supabase responde con un error genérico ("Database error deleting user").
- No usar el borrado "suave" de Supabase Auth.
- No borrar datos en producción sin la autorización expresa de la responsable del proyecto para esa operación.
- No mostrar ni copiar datos personales al hacer las comprobaciones: solo recuentos y metadatos.
