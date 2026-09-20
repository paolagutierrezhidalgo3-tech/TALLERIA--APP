/** Canonical contact numbers. National input currently defaults to Spain.
 * Other countries must use an explicit +/00 calling code. No line-ownership check.
 * Keep the contract and shared fixtures aligned with public.normalize_phone. */
export function normalizePhone(input: string, country = 'ES'): string {
  const value = input.trim();
  if (!value || value.length > 32 || !/^[+0-9 ().-]+$/.test(value)) throw new Error('Introduce un teléfono válido, sin extensiones.');
  let phone = value.replace(/[ ().-]/g, '');
  if (phone.startsWith('00')) phone = '+' + phone.slice(2);
  if (!phone.startsWith('+')) {
    if (country !== 'ES') throw new Error('Incluye el prefijo internacional con +.');
    if (!/^[6-9][0-9]{8}$/.test(phone)) throw new Error('El teléfono español debe tener 9 cifras y empezar por 6, 7, 8 o 9.');
    phone = '+34' + phone;
  }
  if (!/^\+[1-9][0-9]{6,14}$/.test(phone)) throw new Error('Introduce un teléfono internacional válido (máximo 15 cifras).');
  if (phone.startsWith('+34') && !/^\+34[6-9][0-9]{8}$/.test(phone)) throw new Error('El teléfono español debe tener 9 cifras y empezar por 6, 7, 8 o 9.');
  return phone;
}
export function tryNormalizePhone(input: string): string | null {
  try { return normalizePhone(input); } catch { return null; }
}
