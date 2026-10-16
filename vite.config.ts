import { defineConfig } from 'vite';

// Served from https://<user>.github.io/electro/ on GitHub Pages.
export default defineConfig({
  base: '/electro/',
  build: { target: 'es2022' },
});
