import * as Sentry from '@sentry/nextjs';

// Solo monitorización de errores: sin Session Replay ni trazas de rendimiento.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0,
  });
}
