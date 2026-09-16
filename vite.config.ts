import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'esnext',
  },
  optimizeDeps: {
    exclude: ['@novnc/novnc'],
    esbuildOptions: {
      target: 'esnext',
    },
  },
  esbuild: {
    target: 'esnext',
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
