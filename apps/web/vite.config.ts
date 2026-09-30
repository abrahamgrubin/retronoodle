import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  envDir: '../..',
  server: { port: 5173, strictPort: true },
  test: {
    // e2e/ is Playwright's (playwright.config.ts), not Vitest's — both use a *.spec.ts naming
    // convention, and Vitest's default include glob would otherwise try to run it too.
    exclude: ['**/node_modules/**', 'e2e/**'],
  },
});
