import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    global: 'window',
    'process.env': {},
    'process.nextTick': '(fn) => setTimeout(fn, 0)',
  },
  server: {
    port: 4000,
    host: true,
  }
});
