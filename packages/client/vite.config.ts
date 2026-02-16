import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    react(),
    basicSsl(),
    nodePolyfills({
      include: ['events', 'util', 'process', 'buffer'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
  define: {
    'process.env': {},
  },
  server: {
    port: 4443,
    host: true,
    proxy: {
      '/socket.io': {
        target: 'https://localhost:4001',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  }
});
