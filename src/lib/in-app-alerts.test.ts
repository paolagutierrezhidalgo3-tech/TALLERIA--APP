import { describe, expect, it } from 'vitest';
import { newRequestsMessage } from './in-app-alerts';

describe('newRequestsMessage', () => {
  it('no avisa hasta tener una referencia previa (primera carga de la sesión)', () => {
    expect(newRequestsMessage(null, 3)).toBeNull();
  });
  it('no avisa si el recuento actual no llegó (fallo silencioso de un poll)', () => {
    expect(newRequestsMessage(2, undefined)).toBeNull();
  });
  it('no avisa si el recuento se mantiene o baja (el propio taller gestionó solicitudes)', () => {
    expect(newRequestsMessage(3, 3)).toBeNull();
    expect(newRequestsMessage(3, 1)).toBeNull();
  });
  it('avisa en singular cuando llega exactamente una solicitud nueva', () => {
    expect(newRequestsMessage(2, 3)).toBe('Ha llegado una solicitud nueva.');
  });
  it('avisa en plural con el número exacto cuando llegan varias de golpe', () => {
    expect(newRequestsMessage(2, 5)).toBe('Han llegado 3 solicitudes nuevas.');
  });
});
