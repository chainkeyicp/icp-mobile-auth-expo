import { defineConfig } from 'vite';

export default defineConfig({
  root: 'mobile-auth',
  base: '/mobile-auth/',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
