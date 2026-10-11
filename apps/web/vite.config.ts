import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vitest/config';

const require = createRequire(import.meta.url);

/**
 * RN-035: @ricky0123/vad-web (Silero VAD) and its onnxruntime-web dependency ship their model and
 * WASM binaries as plain files in their own package, not as importable JS modules — Vite has
 * nothing to bundle, so without this they're simply missing at runtime (speechDetection.ts points
 * `baseAssetPath`/`onnxWASMBasePath` at the public/ copies this makes, not at node_modules).
 * Copied from node_modules rather than committed to the repo: `silero_vad_v5.onnx` and
 * onnxruntime-web's WASM binaries are large (2MB/14MB) and already pinned by pnpm-lock.yaml —
 * committing a second copy would just be repo bloat that can drift from the installed version.
 */
function copyVadAssets(): Plugin {
  return {
    name: 'copy-vad-assets',
    config() {
      // Both packages' `exports` fields only expose their main JS entry, not arbitrary subpaths
      // (e.g. `onnxruntime-web/package.json` 404s under Node's exports resolution) — resolving
      // the entry itself and taking its directory works for both regardless of each package's own
      // `main` path shape.
      const vadDist = dirname(require.resolve('@ricky0123/vad-web'));
      const ortDist = dirname(require.resolve('onnxruntime-web'));
      const publicVad = join(import.meta.dirname, 'public/vad');
      const publicOrt = join(import.meta.dirname, 'public/ort');
      mkdirSync(publicVad, { recursive: true });
      mkdirSync(publicOrt, { recursive: true });

      for (const file of ['silero_vad_v5.onnx', 'vad.worklet.bundle.min.js']) {
        const dest = join(publicVad, file);
        if (!existsSync(dest)) copyFileSync(join(vadDist, file), dest);
      }
      for (const file of [
        'ort-wasm-simd-threaded.wasm',
        'ort-wasm-simd-threaded.jsep.wasm',
        'ort-wasm-simd-threaded.asyncify.wasm',
      ]) {
        const dest = join(publicOrt, file);
        if (!existsSync(dest)) copyFileSync(join(ortDist, file), dest);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyVadAssets()],
  envDir: '../..',
  server: { port: 5173, strictPort: true },
  test: {
    // e2e/ is Playwright's (playwright.config.ts), not Vitest's — both use a *.spec.ts naming
    // convention, and Vitest's default include glob would otherwise try to run it too.
    exclude: ['**/node_modules/**', 'e2e/**'],
  },
});
