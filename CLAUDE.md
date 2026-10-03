@AGENTS.md

# TALLERIA

Al empezar o retomar una sesión, lee `TALLERIA_PLAN_MAESTRO_FINAL.md` antes de modificar nada: como mínimo la cabecera, la sección 11 ("Cómo retomar") y el checkpoint actual de la sección 12, que es la fuente de verdad del estado; el resto, cuando haga falta. (No se importa aquí con `@` por su tamaño.)

Reglas del proyecto (detalle en las secciones 5, 8 y 10 del plan):

- Ninguna migración ni cambio en Supabase real sin autorización explícita del usuario para esa operación concreta.
- Nada de commit ni push sin aprobación del usuario.
- No leer ni mostrar secretos (`.env.local`, `TALLERIA_DB_URL`, claves); las consultas de solo lectura con `scripts/db-query.mjs` muestran solo recuentos o metadatos, nunca datos personales.
- Las revisiones de Codex son siempre de solo lectura.
- No ampliar el alcance de un bloque sin preguntar.
- Al cerrar cada bloque, actualizar el checkpoint del plan.
