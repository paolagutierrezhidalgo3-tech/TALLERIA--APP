import { describe, expect, it } from 'vitest';
import { ReadCoordinator } from './read-coordinator';

describe('ReadCoordinator', () => {
  it('una lectura que empieza y termina sola, sin nada concurrente, es fresca', () => {
    const rc = new ReadCoordinator();
    const claim = rc.claimRead();
    expect(rc.isFresh(claim)).toBe(true);
  });

  it('una mutación que empieza Y TERMINA por completo durante la espera de una lectura la invalida, aunque el flag ya haya vuelto a estar libre (repro de Codex, hallazgo B1)', () => {
    const rc = new ReadCoordinator();
    const claim = rc.claimRead(); // el poll empieza
    rc.beginMutation(); // execute() empieza
    rc.endMutation(); // execute() termina antes de que el poll reciba respuesta
    expect(rc.mutationInProgress).toBe(false); // el flag ya volvió a false...
    expect(rc.isFresh(claim)).toBe(false); // ...pero la lectura del poll sigue invalidada
  });

  it('dos lecturas ordinarias solapadas: la que empezó después invalida a la que empezó antes, gane quien gane la carrera de respuesta (repro de Codex, hallazgo B2)', () => {
    const rc = new ReadCoordinator();
    const claimA = rc.claimRead(); // poll disparado por el intervalo
    const claimB = rc.claimRead(); // poll disparado por visibilitychange, casi a la vez
    // B resuelve primero (o después, da igual: lo que importa es el orden de inicio)
    expect(rc.isFresh(claimB)).toBe(true);
    expect(rc.isFresh(claimA)).toBe(false);
  });

  it('una lectura que empezó antes de otra pero resuelve después queda invalidada por la más reciente (repro de Codex, hallazgo B3)', () => {
    const rc = new ReadCoordinator();
    const claimRefresh = rc.claimRead(); // refresh() empieza, se retrasa
    const claimPoll = rc.claimRead(); // el poll empieza después, resuelve antes
    expect(rc.isFresh(claimPoll)).toBe(true);
    expect(rc.isFresh(claimRefresh)).toBe(false); // aunque resuelva después, no debe retroceder el valor ya aplicado
  });

  it('una lectura que empieza antes de una mutación y resuelve mientras esta sigue en curso queda invalidada', () => {
    const rc = new ReadCoordinator();
    const claim = rc.claimRead();
    rc.beginMutation();
    expect(rc.isFresh(claim)).toBe(false);
  });

  it('una lectura que empieza DURANTE una mutación ya en curso y resuelve después de que esa misma mutación termine queda invalidada (repro de Codex, ronda 4)', () => {
    // Ni mutationGenerationAtStart (no cambia: es la MISMA mutación en curso
    // en todo momento) ni el flag `mutating` en el instante de comprobar
    // (ya volvió a false) detectan este caso por sí solos -- hace falta
    // recordar en la propia reclamación si ya había una mutación en curso.
    const rc = new ReadCoordinator();
    rc.beginMutation();
    const claim = rc.claimRead();
    rc.endMutation();
    expect(rc.isFresh(claim)).toBe(false);
  });

  it('tras terminar una mutación, una lectura que empieza después sí es fresca', () => {
    const rc = new ReadCoordinator();
    rc.beginMutation();
    rc.endMutation();
    const claim = rc.claimRead();
    expect(rc.isFresh(claim)).toBe(true);
  });

  it('invalidatePendingReads (usado por load()/resetDemo()) invalida cualquier lectura ya reclamada, aunque no haya ninguna mutación de por medio', () => {
    const rc = new ReadCoordinator();
    const claim = rc.claimRead();
    rc.invalidatePendingReads();
    expect(rc.isFresh(claim)).toBe(false);
    const freshClaim = rc.claimRead();
    expect(rc.isFresh(freshClaim)).toBe(true);
  });
});
