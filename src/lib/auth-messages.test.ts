import { readFileSync } from 'node:fs';
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError, AuthWeakPasswordError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  CONNECTION_ERROR, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, RESEND_SENT, SIGNUP_SENT,
  newPasswordProblem, passwordUpdateErrorMessage, recoveryErrorMessage, resendErrorMessage, signInErrorMessage, signUpErrorMessage, weakPasswordMessage,
} from './auth-messages';

// Every server answer whose presence depends on whether the address has an
// account (or on the built-in mail service refusing it) -- these must all
// look exactly like success on sign-up, resend and recovery.
const accountDependent = [
  new AuthApiError('User already registered', 422, 'user_already_exists'),
  new AuthApiError('Email exists', 422, 'email_exists'),
  new AuthApiError('Email address not authorized', 400, 'email_address_not_authorized'),
  new AuthApiError('Email address "x" is invalid', 400, 'email_address_invalid'),
  new AuthApiError('Error sending confirmation email', 500, 'unexpected_failure'),
  new AuthApiError('Error sending recovery email', 500, undefined as unknown as string),
  new AuthApiError('email rate limit exceeded', 429, 'over_email_send_rate_limit'),
  new AuthApiError('For security purposes, you can only request this after 60 seconds.', 429, 'over_request_rate_limit'),
  new AuthRetryableFetchError('Gateway Timeout', 504),
];
const offline = new AuthRetryableFetchError('Failed to fetch', 0);

describe('mensajes de Auth sin revelar si una cuenta existe', () => {
  it('alta: toda respuesta del servidor muestra el mismo texto que el éxito', () => {
    for (const err of accountDependent) expect(signUpErrorMessage(err)).toBe(SIGNUP_SENT);
    expect(SIGNUP_SENT).not.toMatch(/cuenta creada/i);
  });
  it('reenvío: toda respuesta del servidor muestra el mismo texto que el éxito', () => {
    for (const err of accountDependent) expect(resendErrorMessage(err)).toBe(RESEND_SENT);
  });
  it('recuperación: toda respuesta del servidor lleva a la misma pantalla que el éxito', () => {
    for (const err of accountDependent) expect(recoveryErrorMessage(err)).toBeNull();
  });
  it('solo el fallo de red (estado 0) se distingue, y no depende de ninguna cuenta', () => {
    expect(signUpErrorMessage(offline)).toBe(CONNECTION_ERROR);
    expect(resendErrorMessage(offline)).toBe(CONNECTION_ERROR);
    expect(recoveryErrorMessage(offline)).toBe(CONNECTION_ERROR);
    expect(signInErrorMessage(offline)).toBe(CONNECTION_ERROR);
    expect(passwordUpdateErrorMessage(offline)).toBe(CONNECTION_ERROR);
  });
  it('un error ajeno a Supabase Auth (configuración) conserva su propio mensaje', () => {
    const config = new Error('Falta configurar la URL y la clave pública de Supabase. Consulta el README.');
    for (const fn of [signUpErrorMessage, signInErrorMessage, resendErrorMessage, recoveryErrorMessage, passwordUpdateErrorMessage]) expect(fn(config)).toBe(config.message);
  });
  it('ningún mensaje deja pasar el texto en inglés de Supabase', () => {
    for (const err of [...accountDependent, new AuthApiError('Invalid login credentials', 400, 'invalid_credentials')]) {
      for (const text of [signUpErrorMessage(err), signInErrorMessage(err), resendErrorMessage(err), recoveryErrorMessage(err) ?? '', passwordUpdateErrorMessage(err)]) expect(text).not.toContain(err.message);
    }
  });
});

describe('inicio de sesión', () => {
  it('traduce credenciales incorrectas y el límite de intentos', () => {
    expect(signInErrorMessage(new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'))).toBe('Correo o contraseña incorrectos.');
    expect(signInErrorMessage(new AuthApiError('Request rate limit reached', 429, 'over_request_rate_limit'))).toMatch(/^Demasiados intentos/);
    expect(signInErrorMessage(new AuthApiError('Too many requests', 429, undefined as unknown as string))).toMatch(/^Demasiados intentos/);
    expect(signInErrorMessage(new AuthApiError('boom', 500, 'unexpected_failure'))).toMatch(/^No se ha podido iniciar sesión/);
  });
});

describe('contraseñas', () => {
  it('la longitud mínima es la de la política del plan y la máxima la de bcrypt', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(PASSWORD_MAX_LENGTH).toBe(72);
  });
  it('comprueba la longitud en bytes UTF-8 como Supabase, no en caracteres del campo', () => {
    expect(newPasswordProblem('a'.repeat(11))).toMatch(/al menos 12/);
    expect(newPasswordProblem('a'.repeat(12))).toBeNull();
    expect(newPasswordProblem('a'.repeat(72))).toBeNull();
    expect(newPasswordProblem('a'.repeat(73))).toMatch(/demasiado larga/);
    // 40 «ñ» pass the input's maxLength={72} (40 UTF-16 units) but are 80 bytes.
    expect(newPasswordProblem('ñ'.repeat(40))).toMatch(/demasiado larga/);
    expect(newPasswordProblem('ñ'.repeat(36))).toBeNull();
    expect(newPasswordProblem('ñ'.repeat(37))).toMatch(/demasiado larga/);
    expect(newPasswordProblem('contraseña-segura-1')).toBeNull();
  });
  it('explica qué falta según los motivos de Supabase', () => {
    expect(weakPasswordMessage()).toBe('La contraseña no es lo bastante segura: debe tener al menos 12 caracteres.');
    expect(weakPasswordMessage(['length', 'characters'])).toContain('combinar distintos tipos de caracteres');
    expect(weakPasswordMessage(['pwned'])).toContain('no aparecer en filtraciones conocidas');
    expect(signUpErrorMessage(new AuthWeakPasswordError('Password should contain...', 422, ['characters']))).toBe(weakPasswordMessage(['characters']));
  });
  it('al fijar una contraseña nueva distingue débil, repetida y enlace caducado', () => {
    expect(passwordUpdateErrorMessage(new AuthWeakPasswordError('weak', 422, ['length']))).toBe(weakPasswordMessage(['length']));
    expect(passwordUpdateErrorMessage(new AuthApiError('New password should be different from the old password.', 422, 'same_password'))).toBe('La nueva contraseña debe ser distinta de la anterior.');
    expect(passwordUpdateErrorMessage(new AuthSessionMissingError())).toMatch(/caducado/);
    expect(passwordUpdateErrorMessage(new AuthApiError('Session not found', 403, 'session_not_found'))).toMatch(/caducado/);
  });
});

// Source-level checks (no React render harness here; see terms.test.ts).
const code = (path: string) => readFileSync(path, 'utf8').replace(/\s+/g, '');

describe('pantalla de acceso', () => {
  const source = code('src/components/auth-screen.tsx');
  it('no muestra nunca el mensaje de error de Supabase tal cual', () => {
    expect(source).not.toContain('err.message');
    expect(source).toContain('setMessage(register?signUpErrorMessage(err):signInErrorMessage(err))');
    expect(source).toContain('if(register)setMessage(SIGNUP_SENT);');
    expect(source).toContain('setMessage(RESEND_SENT);}catch(err){setMessage(resendErrorMessage(err));}');
  });
  it('la recuperación acaba en la misma pantalla con éxito o con error del servidor', () => {
    expect(source).toContain('constfailure=recoveryErrorMessage(err);if(failure)setMessage(failure);elsesetForgotSent(true);');
  });
  it('la longitud mínima solo se exige al crear la contraseña, no al iniciar sesión', () => {
    expect(source).toContain('minLength={register?PASSWORD_MIN_LENGTH:undefined}maxLength={register?PASSWORD_MAX_LENGTH:128}');
    expect(source).not.toMatch(/minLength=\{\d+\}/);
  });
  it('rechaza una contraseña nueva inválida antes de llamar a Supabase, solo al registrarse', () => {
    expect(source).toContain('constproblem=register?newPasswordProblem(password):null;if(problem){setMessage(problem);setUnconfirmedEmail(\'\');return;}setBusy(true);');
    expect(source.indexOf('newPasswordProblem(password)')).toBeLessThan(source.indexOf('auth.signUp('));
  });
});

describe('formulario de nueva contraseña', () => {
  const source = code('src/components/workspace.tsx');
  it('usa la misma longitud mínima y traduce los errores', () => {
    expect(source.match(/minLength=\{PASSWORD_MIN_LENGTH\}maxLength=\{PASSWORD_MAX_LENGTH\}autoComplete="new-password"/g)).toHaveLength(2);
    expect(source).toContain('if(updateError)thrownewError(passwordUpdateErrorMessage(updateError));');
    expect(source).toContain('constproblem=newPasswordProblem(password);if(problem)thrownewError(problem);const{error:updateError}=awaitgetSupabase().auth.updateUser({password});');
    expect(source).not.toMatch(/type="password"minLength=\{8\}/);
  });
});
