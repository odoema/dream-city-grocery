import { defineConfig } from 'vite';

// Relative base so the same build works on GitHub Pages project sites,
// custom domains and sub-folders without changes (white-label friendly).
export default defineConfig({
  base: './',
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 }
});
