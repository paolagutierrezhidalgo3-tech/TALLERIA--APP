import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TERMS_VERSION, termsAcceptanceMetadata } from './terms';

// Source-level checks (same constraint as error-pages.test.ts: no React
// render harness here). Code is compared with all whitespace removed and
// prose with whitespace collapsed, so reformatting or CRLF/LF line endings
// don't break them -- only real changes to the wiring or the wording do.
const read = (path: string) => readFileSync(path, 'utf8');
const code = (path: string) => read(path).replace(/\s+/g, '');
const prose = (path: string) => read(path).replace(/\s+/g, ' ');

describe('aceptación de los términos de servicio', () => {
  it('guarda la versión y el momento de la aceptación', () => {
    const now = new Date('2026-10-01T09:30:00Z');
    expect(termsAcceptanceMetadata(now)).toEqual({ terms_version: TERMS_VERSION, terms_accepted_at: '2026-10-01T09:30:00.000Z' });
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(termsAcceptanceMetadata())).toEqual(['terms_version', 'terms_accepted_at']);
  });
});

describe('alta del taller con aceptación de términos', () => {
  const source = code('src/components/auth-screen.tsx');
  it('solo el registro envía los metadatos de aceptación', () => {
    expect(source).toMatch(/register\?awaitauth\.signUp\(\{[^;]*data:termsAcceptanceMetadata\(\)[^;]*\}\):awaitauth\.signInWithPassword\(credentials\)/);
    expect(source.match(/termsAcceptanceMetadata\(\)/g)).toHaveLength(1);
  });
  it('la casilla es obligatoria, controlada y solo aparece al registrarse', () => {
    const input = source.match(/\{register&&<labelclassName="checkbox-field"><input(.*?)\/>/)?.[1] ?? '';
    for (const attr of ['type="checkbox"', 'required', 'checked={termsAccepted}', 'onChange={e=>setTermsAccepted(e.target.checked)}']) expect(input).toContain(attr);
    expect(source).toContain('<ahref="/terminos"target="_blank"rel="noopener noreferrer">'.replace(/\s/g, ''));
    expect(source).toContain('disabled={busy||(register&&!termsAccepted)}');
    expect(source).toMatch(/if\(register&&!termsAccepted\)\{setMessage\([^)]*\);return;\}/);
    expect(source).toContain('setRegister(!register);setTermsAccepted(false);');
  });
});

describe('página /terminos', () => {
  it('muestra la versión vigente y avisa mientras falten los datos del operador', () => {
    const source = code('src/app/terminos/page.tsx');
    expect(source).toContain("import{TERMS_VERSION}from'@/lib/terms'");
    expect(source).toContain('Versión{TERMS_VERSION}');
    for (const name of ['OPERATOR_NAME', 'OPERATOR_TAX_ID', 'OPERATOR_CONTACT_EMAIL']) expect(source).toContain('process.env.' + name);
    expect(source).toContain('{missing&&<pclassName="noticeerror"role="alert">');
    expect(source).not.toContain('NEXT_PUBLIC_OPERATOR');
  });
  it('describe el encargo con exactitud: equipo incluido, anonimización parcial y sin baja automática', () => {
    const text = prose('src/app/terminos/page.tsx');
    expect(text).toContain('encargado del tratamiento');
    expect(text).toContain('invitaciones que envíes');
    expect(text).toContain('el texto de sus conversaciones y solicitudes puede conservarse');
    expect(text).not.toContain('para atender su derecho de supresión');
    for (const provider of ['Supabase', 'Vercel', 'Resend', 'Sentry']) expect(text).toContain(provider);
    expect(text).toContain('la aplicación todavía no permite hacerlo por tu cuenta');
  });
});

describe('aviso legal de la recepción pública', () => {
  it('incluye a Vercel y Sentry sin afirmar su ubicación ni que Sentry esté siempre activo', () => {
    const text = prose('src/app/r/[slug]/aviso-legal/page.tsx');
    expect(text).toContain('se alojan en Vercel');
    expect(text).toContain('puede enviarse a Sentry');
    expect(text).toContain('si está configurado');
    expect(text).toContain('están pendientes de confirmar');
  });
});
