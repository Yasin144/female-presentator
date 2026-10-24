import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  if (!['salary', 'udhaar'].includes(mode)) throw new Error('OTA builds require --mode salary or --mode udhaar.');
  const udhaar = mode === 'udhaar';
  const bundleName = udhaar ? 'udhaar-bundle-1.0.11' : 'app-bundle-8.2.34';
  return {
    root,
    base: './',
    publicDir: false,
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    plugins: [react()],
    resolve: {
      alias: { '/caption-fonts': fileURLToPath(new URL('./public/caption-fonts', import.meta.url)) },
    },
    build: {
      target: 'es2018',
      outDir: `review/ota-release/${udhaar ? 'ota-udhaar' : 'ota'}`,
      emptyOutDir: true,
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      cssCodeSplit: false,
      lib: {
        entry: `ota-shell/${mode}.jsx`,
        name: udhaar ? 'PattanUdhaarOta' : 'PattanSalaryOta',
        formats: ['iife'],
        fileName: () => `${bundleName}.js`,
        cssFileName: bundleName,
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
          ...(udhaar ? { banner: 'window.__UDHAAR_ONLY_APK__ = true;' } : {}),
        },
      },
    },
  };
});
