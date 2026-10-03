import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import config from '../../next.config';
import { SECURITY_HEADERS } from './security';

const header = (key: string) => SECURITY_HEADERS.find(h => h.key === key)?.value;

describe('cabeceras de seguridad', () => {
  it('next.config aplica exactamente las 5 cabeceras a todas las rutas', async () => {
    const rules = await config.headers!();
    expect(rules).toEqual([{ source: '/:path*', headers: [...SECURITY_HEADERS] }]);
    expect(SECURITY_HEADERS.map(h => h.key)).toEqual(['X-Frame-Options', 'Content-Security-Policy', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']);
  });
  it('solo el mismo origen puede incrustar la app (no DENY: la revisión móvil usa un iframe del mismo origen)', () => {
    expect(header('X-Frame-Options')).toBe('SAMEORIGIN');
    expect(header('Content-Security-Policy')).toContain("frame-ancestors 'self'");
  });
  it('la CSP no es completa: no restringe scripts, estilos ni conexiones (Supabase y Sentry)', () => {
    expect(header('Content-Security-Policy')).toBe("frame-ancestors 'self'; base-uri 'self'; object-src 'none'");
    expect(header('Content-Security-Policy')).not.toMatch(/default-src|script-src|style-src|connect-src/);
  });
  it('el resto de valores', () => {
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(header('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()');
  });
  it('no restringe el portapapeles: «Copiar enlace» usa navigator.clipboard', () => {
    expect(header('Permissions-Policy')).not.toContain('clipboard');
    expect(readFileSync('src/components/editors.tsx', 'utf8')).toContain('navigator.clipboard.writeText');
  });
});

describe('versión de Next.js', () => {
  // Stable releases only: a canary/prerelease such as 16.3.8-canary.0 is
  // not guaranteed to carry the fixes, so any suffix fails.
  const stableAtLeast = (version: string, min: [number, number, number]) => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (!m) return false;
    const v = [Number(m[1]), Number(m[2]), Number(m[3])];
    for (let i = 0; i < 3; i++) if (v[i] !== min[i]) return v[i] > min[i];
    return true;
  };
  it('la comprobación exige una versión estable: rechaza canary y prerelease', () => {
    expect(stableAtLeast('16.3.8', [16, 3, 8])).toBe(true);
    expect(stableAtLeast('16.3.10', [16, 3, 8])).toBe(true);
    expect(stableAtLeast('16.4.0', [16, 3, 8])).toBe(true);
    expect(stableAtLeast('17.0.0', [16, 3, 8])).toBe(true);
    expect(stableAtLeast('16.3.7', [16, 3, 8])).toBe(false);
    expect(stableAtLeast('16.2.99', [16, 3, 8])).toBe(false);
    expect(stableAtLeast('16.3.8-canary.0', [16, 3, 8])).toBe(false);
    expect(stableAtLeast('16.4.0-canary.58', [16, 3, 8])).toBe(false);
    expect(stableAtLeast('16.3.8-rc.1', [16, 3, 8])).toBe(false);
  });
  it('es una versión estable 16.3.8 o posterior (corrige GHSA-vcvr-r3jv-pc5j y los avisos de 16.3.8)', () => {
    const version = JSON.parse(readFileSync('node_modules/next/package.json', 'utf8')).version;
    expect(stableAtLeast(version, [16, 3, 8]), 'next instalado: ' + version).toBe(true);
    expect(JSON.parse(readFileSync('package.json', 'utf8')).dependencies.next).toBe('^16.3.8');
  });
});
