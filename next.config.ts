import type { NextConfig } from 'next';
const config: NextConfig = {
  // Thread workers also support constrained local Windows environments.
  experimental: { workerThreads: true, cpus: 2, useTypeScriptCli: false },
};
export default config;
