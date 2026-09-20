import { defineConfig } from 'vitest/config';
import ts from 'typescript';
export default defineConfig({
  esbuild: false, resolve: { preserveSymlinks: true },
  plugins: [{
    name: 'typescript-in-process',
    enforce: 'pre',
    transform(source, id) {
      if (!id.includes('node_modules') && /\.tsx?$/.test(id)) {
        return ts.transpileModule(source, {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, sourceMap: true },
          fileName: id,
        }).outputText;
      }
    },
  }],
  test: { environment: 'node', pool: 'threads', maxWorkers: 1, include: ['src/**/*.test.ts'], testTimeout: 30000, hookTimeout: 60000 },
});
