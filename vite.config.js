import { defineConfig } from 'vite';

// Relative base so the build works from any static host (GitHub Pages, itch.io, …).
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1500 },
});
