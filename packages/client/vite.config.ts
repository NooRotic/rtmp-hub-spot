import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const devPort = parseInt(env.VITE_DEV_PORT || '4443', 10);
  const signalingTarget = env.VITE_SIGNALING_SERVER_URL || 'https://localhost:4001';

  return {
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
      port: devPort,
      host: true,
      proxy: {
        '/socket.io': {
          target: signalingTarget,
          changeOrigin: true,
          secure: false,
          ws: true,
        },
      },
    }
  };
});
