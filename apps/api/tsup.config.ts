import { defineConfig } from 'tsup';

// `noExternal` has no CLI flag — tsup's CLI parser (cac) rejects `--noExternal` outright
// ("Unknown option"), confirmed live on Render's build and reproduced locally. It only exists as
// a config-file option, which is why this needs to be here instead of a bare `tsup ...` command
// in package.json's build script.
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  noExternal: ['@retronoodle/shared', '@retronoodle/worker'],
});
