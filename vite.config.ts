import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Browser-only app: fetches Polymarket Gamma directly (CORS is `*`). No server.
// `base` is relative so it works under a GitHub Pages sub-path.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: { environment: 'node', globals: true },
});
