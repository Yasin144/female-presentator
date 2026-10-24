import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { otaReleaseFor } from './ota-release.config.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  const release = otaReleaseFor(mode);
  const udhaar = mode === 'udhaar';
  const bundleName = release.bundleName;
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
      outDir: `review/ota-build/${mode}`,
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
