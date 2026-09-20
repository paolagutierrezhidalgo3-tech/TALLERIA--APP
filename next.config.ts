import type { NextConfig } from 'next';
import { assertPublicSupabaseKey } from './src/lib/security';
if (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) assertPublicSupabaseKey(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const config: NextConfig = {
  // Thread workers also support constrained local Windows environments.
  experimental: { workerThreads: true, cpus: 2, useTypeScriptCli: false },
};
export default config;
