import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
let client: SupabaseClient | undefined;
// The secret key bypasses row-level security entirely. The "server-only"
// import above makes any accidental import of this module from client
// code (a 'use client' component, or anything else that ends up in the
// browser bundle) a build error, not just a documented convention.
export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Falta configurar SUPABASE_SECRET_KEY (y NEXT_PUBLIC_SUPABASE_URL) en el entorno del servidor.');
  return client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
