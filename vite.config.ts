import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

// vite preview sends the same security headers as the deployment (vercel.json),
// so a CSP violation in the production bundle shows up locally, not after deploy.
const deployHeaders = Object.fromEntries(
  (JSON.parse(readFileSync('vercel.json', 'utf8')).headers[0].headers as Array<{ key: string; value: string }>)
    .filter((h) => h.key !== 'Strict-Transport-Security')
    .map((h) => [h.key, h.value]),
);

export default defineConfig({
  plugins: [react()],
  preview: { headers: deployHeaders },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react')) return 'react';
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
