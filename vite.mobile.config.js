import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'mobile-shell',
  base: './',
  publicDir: false,
  plugins: [react()],
  build: { outDir: '../mobile-dist', emptyOutDir: true },
  resolve: { alias: { '/caption-fonts': fileURLToPath(new URL('./public/caption-fonts', import.meta.url)) } },
});
