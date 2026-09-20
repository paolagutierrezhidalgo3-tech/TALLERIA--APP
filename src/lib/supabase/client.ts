import { createClient, type SupabaseClient } from '@supabase/supabase-js';
let client: SupabaseClient | undefined;
export const isSupabaseMode = process.env.NEXT_PUBLIC_DATA_MODE === 'supabase';
export function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Falta configurar la URL y la clave pública de Supabase. Consulta el README.');
  return client ??= createClient(url, key);
}
