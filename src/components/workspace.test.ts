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

describe('workspace.tsx: ficha de cliente/vehículo', () => {
  // Codex found that a workshop/session change left a previously-open ficha
  // (and its already-fetched data) sitting in state, so it could reappear
  // over a DIFFERENT workshop after switching accounts in the same tab --
  // these pin the fix (closing it everywhere the session/workshop actually
  // changes) at the source level, since there's no component test harness.
  it('load() cierra cualquier ficha abierta al arrancar una sesión/taller nuevo (evita que sobreviva a un cambio de cuenta)', () => {
    const start = source.indexOf('const load = useCallback(async (repo: WorkshopRepository)');
    const end = source.indexOf('}, [reads]);');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(source.slice(start, end)).toMatch(/setEntityDetail\(null\)/);
  });
  it('logout() y la resolución de sesión sin usuario cierran cualquier ficha abierta', () => {
    const logoutStart = source.indexOf('async function logout()');
    const logoutEnd = source.indexOf('catch (err) { setError', logoutStart);
    expect(logoutStart).toBeGreaterThan(-1);
    expect(source.slice(logoutStart, logoutEnd)).toMatch(/setEntityDetail\(null\)/);
    const sessionStart = source.indexOf('async function session()');
    const sessionEnd = source.indexOf("setScreen('auth');", sessionStart);
    expect(sessionStart).toBeGreaterThan(-1);
    expect(source.slice(sessionStart, sessionEnd)).toMatch(/setEntityDetail\(null\)/);
  });
  it('cerrar la ficha invalida cualquier petición pendiente de la anterior (el contador se incrementa incluso al cerrar, no solo al abrir)', () => {
    const start = source.indexOf('const entityDetailSeq = useRef(0);');
    const end = source.indexOf('}, [entityDetail]);');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);
    const seqIndex = block.indexOf('++entityDetailSeq.current');
    const guardIndex = block.indexOf('if (!entityDetail || !repository.current)');
    expect(seqIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(seqIndex); // el contador sube ANTES del return anticipado al cerrar, no después
  });
  it('la ficha es de solo lectura: AppointmentCard se renderiza con actionable={false} dentro del modal de historial', () => {
    const start = source.indexOf('{entityDetail && <Modal');
    const end = source.indexOf('{cancelId && <Modal', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(source.slice(start, end)).toMatch(/actionable=\{false\}/);
  });
});
describe('workspace.tsx: aviso de solicitudes nuevas', () => {
  // The actual freshness logic (two counters, six call sites racing each
  // other) has real behavioral coverage in src/lib/read-coordinator.test.ts,
  // including the exact interleavings an earlier, insufficient version of
  // this fix got wrong. These only pin that each call site is wired to the
  // shared ReadCoordinator instance (`reads`) the way that logic assumes.
  it('execute() nunca dispara el aviso pasivo para la propia acción del usuario (solo un resync silencioso), y marca la mutación con reads.beginMutation()/endMutation()', () => {
    const start = source.indexOf('async function execute(command: Command)');
    const end = source.indexOf('async function refresh()');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const executeBlock = source.slice(start, end);
    expect(executeBlock).toMatch(/checkForNewRequests\(result\.metrics,\s*false\)/);
    expect(executeBlock).not.toMatch(/checkForNewRequests\([^)]*,\s*true\)/);
    expect(executeBlock).toMatch(/reads\.beginMutation\(\)/);
    expect(executeBlock).toMatch(/reads\.endMutation\(\)/);
    // execute() never calls claimRead()/isFresh() for its own result -- it
    // always applies unconditionally, per read-coordinator.ts's contract.
    // (Checked on the code, not comments: a stray mention of reads.isFresh()
    // while explaining *why* is fine and expected.)
    const code = executeBlock.replace(/\/\/.*$/gm, '').replace(/\/\*[^]*?\*\//g, '');
    expect(code).not.toMatch(/reads\.(claimRead|isFresh)\(/);
  });
  it('el poll de fondo comprueba mutationInProgress antes de arrancar y reads.isFresh() después de recibir la respuesta', () => {
    const start = source.indexOf('async function poll()');
    const end = source.indexOf('const interval = setInterval');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const pollBlock = source.slice(start, end);
    const guardIndex = pollBlock.indexOf('reads.mutationInProgress');
    const claimIndex = pollBlock.indexOf('reads.claimRead()');
    const awaitIndex = pollBlock.indexOf('await withTimeout(repo.peekMetrics()');
    const checkIndex = pollBlock.indexOf('reads.isFresh(claim)');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(claimIndex).toBeGreaterThan(guardIndex);
    expect(awaitIndex).toBeGreaterThan(claimIndex);
    expect(checkIndex).toBeGreaterThan(awaitIndex);
  });
  it('load(), refresh(), la carga de página y el sync demo reclaman y comprueban frescura como cualquier lectura ordinaria; resetDemo() invalida las lecturas pendientes tras restablecer', () => {
    const resetDemoBlock = source.slice(source.indexOf('async function resetDemo()'), source.indexOf('async function resetDemo()') + 800);
    expect(resetDemoBlock).toMatch(/reads\.invalidatePendingReads\(\)/);
    for (const fn of ['const load = useCallback(async (repo: WorkshopRepository)', 'async function refresh()', 'const sync = ()']) {
      const start = source.indexOf(fn);
      expect(start).toBeGreaterThan(-1);
      const block = source.slice(start, start + 1400);
      expect(block).toMatch(/reads\.claimRead\(\)/);
      expect(block).toMatch(/reads\.isFresh\(claim\)/);
    }
  });
  it('el efecto de carga por página reclama una lectura y comprueba su frescura antes de aplicar las métricas', () => {
    const start = source.indexOf("if (screen !== 'app' || !repository.current || page === 'team') return;");
    const end = source.indexOf('async function execute(command: Command)');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);
    const claimIndex = block.indexOf('reads.claimRead()');
    const awaitIndex = block.indexOf('.load(query).then(');
    const checkIndex = block.indexOf('reads.isFresh(metricsClaim)');
    expect(claimIndex).toBeGreaterThan(-1);
    expect(awaitIndex).toBeGreaterThan(claimIndex);
    expect(checkIndex).toBeGreaterThan(awaitIndex);
  });
});
