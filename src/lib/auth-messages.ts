import { isAuthError, isAuthRetryableFetchError, isAuthWeakPasswordError } from '@supabase/supabase-js';

// Spanish messages for Supabase Auth errors on the login screen and the
// password-reset form. Production sends Auth email through Supabase's
// built-in service, which refuses addresses outside the organization: a
// sign-up only tries to send for an address that has no confirmed account
// yet, and a recovery only for one that has an account. So for sign-up,
// resend and recovery, what reaches the screen must not depend on whether
// the address has an account: every server answer collapses into the same
// neutral text as success. Supabase's own API still answers differently
// (the browser calls it directly; nothing here can change that) -- this
// only keeps the app from adding an oracle of its own on top.
//
// Only two cases are told apart: a network failure before reaching the
// server (status 0 -- not about any account), and an error that isn't from
// Supabase Auth at all (missing configuration), whose own message is kept.

/** New passwords: at least the minimum the Supabase project enforces (the
 * plan's Auth policy: 12) and at most 72 bytes of UTF-8, bcrypt's limit,
 * which Supabase Auth rejects above. Logging in has no minimum -- older
 * accounts may have shorter passwords from before the policy. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 72;

/** Checked before calling Supabase: the input's maxLength counts UTF-16
 * units, not bytes, so "ñ" or an accented letter (2 bytes each) can pass it
 * and still be rejected by the server -- and on sign-up that rejection
 * would otherwise collapse into SIGNUP_SENT, promising an email that never
 * comes. Depends only on the password, never on any account. */
export function newPasswordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_LENGTH) return `La contraseña es demasiado larga: usa como máximo ${PASSWORD_MAX_LENGTH} caracteres (las letras con tilde y la «ñ» cuentan doble).`;
  return null;
}

export const CONNECTION_ERROR = 'No se ha podido conectar. Comprueba tu conexión y vuelve a intentarlo.';
export const SIGNUP_SENT = 'Si los datos son correctos, te hemos enviado un correo para confirmar la cuenta. Revisa tu bandeja de entrada (y la carpeta de spam) antes de iniciar sesión; si no te llega en unos minutos, vuelve a intentarlo más tarde.';
export const RESEND_SENT = 'Si la cuenta está pendiente de confirmar, te hemos enviado un nuevo correo. Revisa tu bandeja de entrada (y la carpeta de spam).';

const isOffline = (err: unknown) => isAuthRetryableFetchError(err) && err.status === 0;
const notFromAuth = (err: unknown, fallback: string) => err instanceof Error ? err.message : fallback;

export function weakPasswordMessage(reasons: readonly string[] = []): string {
  const parts = [`tener al menos ${PASSWORD_MIN_LENGTH} caracteres`];
  if (reasons.includes('characters')) parts.push('combinar distintos tipos de caracteres (letras, números y símbolos)');
  if (reasons.includes('pwned')) parts.push('no aparecer en filtraciones conocidas');
  return `La contraseña no es lo bastante segura: debe ${parts.join(', ')}.`;
}

/** Sign-up: success and every server error share SIGNUP_SENT, except a
 * weak password -- the form already enforces the minimum length, so this
 * only shows when the project's rules go beyond it. */
export function signUpErrorMessage(err: unknown): string {
  if (!isAuthError(err)) return notFromAuth(err, 'No se ha podido crear la cuenta.');
  if (isOffline(err)) return CONNECTION_ERROR;
  if (isAuthWeakPasswordError(err)) return weakPasswordMessage(err.reasons);
  return SIGNUP_SENT;
}

/** Login answers the same for an unknown address and a wrong password
 * already (invalid_credentials); its rate limit is per client, not per
 * account. email_not_confirmed is handled by the screen itself. */
export function signInErrorMessage(err: unknown): string {
  if (!isAuthError(err)) return notFromAuth(err, 'No se ha podido iniciar sesión.');
  if (isOffline(err)) return CONNECTION_ERROR;
  if (err.code === 'invalid_credentials') return 'Correo o contraseña incorrectos.';
  if (err.code === 'over_request_rate_limit' || err.status === 429) return 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.';
  return 'No se ha podido iniciar sesión. Inténtalo de nuevo en unos minutos.';
}

export function resendErrorMessage(err: unknown): string {
  if (!isAuthError(err)) return notFromAuth(err, 'No se ha podido reenviar el correo.');
  if (isOffline(err)) return CONNECTION_ERROR;
  return RESEND_SENT;
}

/** Recovery: null means "show the same 'if an account exists' screen as
 * success"; a string is an error to show on the form instead. */
export function recoveryErrorMessage(err: unknown): string | null {
  if (!isAuthError(err)) return notFromAuth(err, 'No se ha podido enviar el correo de recuperación.');
  if (isOffline(err)) return CONNECTION_ERROR;
  return null;
}

/** Setting a new password from a recovery link: the user is already
 * authenticated by that link, so there's nothing to hide here. */
export function passwordUpdateErrorMessage(err: unknown): string {
  if (!isAuthError(err)) return notFromAuth(err, 'No se ha podido actualizar la contraseña.');
  if (isOffline(err)) return CONNECTION_ERROR;
  if (isAuthWeakPasswordError(err)) return weakPasswordMessage(err.reasons);
  if (err.code === 'same_password') return 'La nueva contraseña debe ser distinta de la anterior.';
  if (err.name === 'AuthSessionMissingError' || err.code === 'session_not_found' || err.code === 'session_expired') return 'El enlace de recuperación ha caducado. Vuelve a solicitar uno.';
  return 'No se ha podido actualizar la contraseña. Inténtalo de nuevo en unos minutos.';
}
