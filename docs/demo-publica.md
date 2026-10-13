# Demo pública (Netlify, plan gratuito)

- **Enlace:** https://talleria-demo.netlify.app
- **Proyecto:** `talleria-demo`, en el equipo de Netlify de la usuaria, plan gratuito, sin método de pago guardado. Publicado el 13 de octubre de 2026.
- **Qué es:** la app en **modo demo**. Los datos son ficticios y viven solo en el navegador de cada visitante. No hay Supabase, claves, correo ni IA de pago: el asistente es el simulado, por reglas, y lo indica en pantalla.
- **Visibilidad:** pública, porque Netlify protege por defecto los proyectos nuevos con el inicio de sesión del equipo.
- **Producción:** no la toca. Producción sigue en Vercel (`talleria-app.vercel.app`) con su CI.

## Por qué Netlify y no Vercel

El plan Hobby de Vercel es solo para uso personal y no comercial, y una demo para vender TALLERIA lo incumpliría en la misma cuenta que producción. El acuerdo del plan gratuito de Netlify no excluye el uso comercial. Al agotar los créditos mensuales, el sitio se pausa sin cobrar. Cada publicación consume unos 15 de los 300 créditos mensuales.

## Cómo se publica (sin tocar el repositorio)

Se publica desde una copia limpia del repositorio, sin `.env.local` y sin `TALLERIA_DB_URL` en el entorno:

1. `git worktree add --detach <carpeta-temporal> HEAD`.
2. En esa copia:
   - añadir `nodeLinker: hoisted` a `pnpm-workspace.yaml`, porque en Windows el adaptador de Next de Netlify no puede crear los enlaces simbólicos de pnpm;
   - `pnpm install`;
   - `pnpm add -D @netlify/plugin-nextjs@5.16.0`;
   - crear este `netlify.toml`:

   ```toml
   [build]
     command = "pnpm build"
     publish = ".next"
   [build.environment]
     NEXT_PUBLIC_DATA_MODE = "demo"
     NODE_VERSION = "22"
   [[plugins]]
     package = "@netlify/plugin-nextjs"
   [[headers]]
     for = "/*"
     [headers.values]
       X-Robots-Tag = "noindex, nofollow"
   ```

3. `env -u TALLERIA_DB_URL npx netlify-cli@27.10.1 deploy --build --prod --site <id de talleria-demo>`. La CLI ya está autorizada en este equipo; el acceso se puede revocar en Netlify, en *User settings → Applications*.
4. Comprobar:
   - que el resultado no contiene identificadores de proyecto ni claves;
   - que `/`, `/r/taller-motor-norte`, `/terminos` y el aviso legal responden 200;
   - que `/api/receptionist` responde `{"fallback":true}`;
   - el recorrido en el navegador.

## Pendiente

- La cabecera `X-Robots-Tag` no aparece en las páginas que genera el servidor de Next (sí en los archivos estáticos). Si hace falta que la demo no se indexe en absoluto, hay que añadirla en la configuración de cabeceras de Next solo para el modo demo.
- Republicar después de cada cambio que se quiera enseñar (no se publica sola en cada push, para ahorrar créditos).
