import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [
    react(),
    basicSsl()
  ],
  define: {
    global: 'window',
    'process.env': {},
    'process.nextTick': '(fn) => setTimeout(fn, 0)',
  },
  server: {
    port: 4443,
    host: true,
    https: true,
  }
});
