/** Configuration guard, not JWT verification. Never log the supplied key. */
export function assertPublicSupabaseKey(key: string): void {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return;
  if (key.startsWith('sb_secret_')) throw new Error('La clave de Supabase es privada. Usa una clave publishable; nunca service_role.');
  try {
    const parts = key.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.role === 'anon' && typeof payload.iss === 'string') return;
    }
  } catch { /* Fail closed for unknown formats. */ }
  throw new Error('La clave pública de Supabase no es válida. Usa publishable o la clave anon; nunca service_role.');
}
export function databaseMessage(error: { code?: string; message?: string }): string {
  if (error.code === 'P0001' || error.code === '42501' && error.message?.startsWith('No tienes')) return error.message ?? 'Operación no permitida.';
  if (error.code === '23505') return 'Ya existe un registro con esos datos. Actualiza la vista y revísalos.';
  if (error.code === '23503' || error.code === '40001' || error.code === '40P01') return 'Los datos han cambiado. Actualiza la vista e inténtalo de nuevo.';
  return 'No se ha podido completar la operación. Comprueba la conexión y vuelve a intentarlo.';
}
