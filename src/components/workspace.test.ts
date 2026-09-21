import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// There is no React component test harness in this project (no jsdom /
// testing-library, vitest runs in 'node'), so these pin the wiring at the
// source level rather than rendering it. See src/lib/domain.test.ts for the
// actual behavioral coverage of isWorkshopEmpty() itself.
const source = readFileSync('src/components/workspace.tsx', 'utf8');

describe('workspace.tsx: arranque de un taller vacío', () => {
  it('el dashboard muestra GettingStarted en vez de las métricas cuando el taller está vacío', () => {
    expect(source).toMatch(/isWorkshopEmpty\(state\)\s*\?\s*<GettingStarted/);
  });
});

describe('workspace.tsx: menú lateral móvil', () => {
  it('cierra con Escape y mantiene el foco dentro del menú mientras está abierto (trampa de tabulación)', () => {
    const start = source.indexOf("<aside ref={sidebarRef}");
    const end = source.indexOf('<div className="main-shell">');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const asideBlock = source.slice(start, end);
    expect(asideBlock).toMatch(/e\.key === 'Escape'/);
    expect(asideBlock).toMatch(/e\.key === 'Tab'/);
    expect(asideBlock).toMatch(/role=\{mobile \? 'dialog' : undefined\}/);
  });
  it('mueve el foco al primer elemento del menú al abrirlo y lo devuelve al botón al cerrarlo', () => {
    expect(source).toMatch(/menuButton\?\.focus\(\)/);
    expect(source).toMatch(/sidebarRef\.current\?\.querySelector[^]*?\.focus\(\)/);
  });
});
