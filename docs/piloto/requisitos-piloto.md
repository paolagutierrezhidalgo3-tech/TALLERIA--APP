# Requisitos antes de un piloto real con 5 talleres

Estado: 13 de octubre de 2026. **B = bloqueante** (sin esto no se empieza con datos reales). **R = recomendable**.

## Técnicos

| # | Requisito | Tipo | Estado / qué falta | ¿Coste? |
| --- | --- | --- | --- | --- |
| T1 | **Correo de Auth propio (SMTP)** para que los talleres puedan darse de alta, confirmar el correo y recuperar la contraseña | B | Hoy el correo integrado de Supabase solo entrega a la organización. Hace falta un dominio y un proveedor de correo (bloque E del plan de seguridad). | Probable (dominio, unos 10–15 €/año; proveedor con plan gratuito limitado) |
| T2 | **Migración 022 en producción** (reserva por el cliente) | B | Probada en TEST; requiere autorización y copia de seguridad previa. | No |
| T3 | **Migraciones 019 y 020 en producción** (borrado de cuentas y anonimización), necesarias para el procedimiento de baja | B | Preparadas y probadas en TEST; requieren autorización. | No |
| T4 | **Datos legales por taller** en el aviso legal de cada recepción | B | Hoy se configuran por despliegue (`LEGAL_TAX_ID`, `LEGAL_CONTACT_EMAIL`), pensado para un taller por despliegue. Para 5 talleres en el mismo despliegue hay que guardarlos por taller (requiere una migración) o hacer un despliegue por taller. | No (en tiempo) |
| T5 | **Alojamiento compatible con uso comercial** | B | Producción está en Vercel Hobby, que solo permite uso personal y no comercial. Opciones: Vercel Pro, o mover producción a un plan gratuito que lo permita (por ejemplo Netlify, ya probado con la demo). | Vercel Pro: de pago. Netlify: gratis con límites. |
| T6 | **Plan de base de datos** | R | Supabase Free pausa los proyectos inactivos y tiene límites. Revisar sus condiciones para uso comercial y el riesgo de pausa durante el piloto. | Posible (Supabase Pro) |
| T7 | **Copias de seguridad que no dependan del portátil** | R | Las copias diarias funcionan y se verifican, pero solo se hacen con el ordenador encendido (la del 12 de octubre se retrasó una hora porque estaba en reposo). Falta un espejo en la nube (OneDrive preparado, sin conectar). | No |
| T8 | **Avisos por correo al taller** de solicitudes nuevas | R | Hoy en modo de pruebas de Resend (solo llega a la cuenta propietaria). Necesita el dominio de T1. | Con T1 |
| T9 | **CAPTCHA** en alta, acceso y recuperación (bloque D) | R | Turnstile de Cloudflare, gratuito; requiere una cuenta. | No |
| T10 | **Contacto y soporte** visibles para el taller | R | Teléfono o correo de soporte y `NEXT_PUBLIC_DEMO_CONTACT_EMAIL` en la demo. | No |

## Legales

| # | Requisito | Tipo | Qué falta |
| --- | --- | --- | --- |
| L1 | **Identidad de quien opera TALLERIA** (autónoma o sociedad) | B | Alta en Hacienda y en Seguridad Social cuando se vaya a cobrar. Los datos `OPERATOR_*` de los términos están vacíos a propósito hasta entonces. |
| L2 | **Términos de servicio revisados** por un profesional | B | `/terminos` existe, pero está pendiente de datos del operador y de revisión. |
| L3 | **Contrato de encargo del tratamiento** (art. 28 RGPD) con cada taller | B | TALLERIA es encargada y el taller responsable de los datos de sus clientes. Falta el modelo de contrato firmado por taller. |
| L4 | **Aviso legal y privacidad de cada taller** | B | Con su razón social, NIF y contacto (depende de T4). |
| L5 | **Registro de actividades de tratamiento** como encargada | B | Documento interno. |
| L6 | **Subencargados y transferencias internacionales** | B | Confirmar la región y las garantías de Vercel o Netlify, Supabase, Sentry y Resend, y listarlos en el contrato (L3). |
| L7 | **Comunicaciones comerciales (LSSI)** | B para la campaña | Primer contacto por teléfono o en persona; correo o WhatsApp solo con consentimiento (ver `mensajes-contacto.md`). |
| L8 | **Facturación** de los 29 €/mes | Después del piloto | Facturas con IVA y método de cobro; no hace falta durante los 14 días gratis. |
| L9 | **Política de conservación y baja** aplicada | R | Hay una política provisional (`docs/politica-conservacion-datos.md`) y un procedimiento de baja; confirmar plazos. |

## Orden recomendado

1. Decisiones de la usuaria: identidad del operador (L1), alojamiento (T5), dominio y correo (T1).
2. Técnico sin coste: T2 y T3 (con autorización y copia previa), T4.
3. Legal: L2, L3, L4, L5 y L6, con un asesor.
4. Contactar a los talleres (L7) en paralelo, fijando las fechas de inicio del piloto **después** de los puntos 1–3.
