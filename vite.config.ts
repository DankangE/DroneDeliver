import { defineConfig } from 'vite';

const port = Number(process.env.PORT ?? 5173);

export default defineConfig({
  server: { host: 'localhost', port },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
  preview: { host: 'localhost', port: Number(process.env.PREVIEW_PORT ?? process.env.PORT ?? 4173) },
});
