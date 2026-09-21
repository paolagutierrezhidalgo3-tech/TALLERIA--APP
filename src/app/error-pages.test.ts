import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Same constraint as workspace.test.ts: no React render harness here, so
// these pin the branded 404/error pages at the source level (they exist,
// use the app's existing .onboarding/.card styling, and offer a real way
// out — a link home or a retry — instead of Next.js's bare default pages).
describe('páginas 404 y de error con diseño TALLERIA', () => {
  it('not-found.tsx enlaza de vuelta al inicio con el estilo de la app', () => {
    const source = readFileSync('src/app/not-found.tsx', 'utf8');
    expect(source).toMatch(/className="onboarding"/);
    expect(source).toMatch(/href="\/"/);
  });
  it('error.tsx ofrece un botón de reintento y registra el error', () => {
    const source = readFileSync('src/app/error.tsx', 'utf8');
    expect(source).toMatch(/'use client'/);
    expect(source).toMatch(/className="onboarding"/);
    expect(source).toMatch(/onClick=\{\(\) => reset\(\)\}/);
    expect(source).toMatch(/console\.error\(error\)/);
  });
  it('global-error.tsx cubre un fallo del layout raíz con su propio html/body y reintento', () => {
    const source = readFileSync('src/app/global-error.tsx', 'utf8');
    expect(source).toMatch(/'use client'/);
    expect(source).toMatch(/<html/);
    expect(source).toMatch(/onClick=\{\(\) => reset\(\)\}/);
  });
});
