import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Reads the root .env. Only the dev server sees these; nothing reaches the browser bundle.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '..', '');
  const target = (env.AGENT_URL || 'http://localhost:8787').replace(/\/+$/, '');
  const proxy = { '/agent': target, '/api': target, '/health': target };
  const port = Number(env.FRONTEND_PORT) || 3000;
  return { plugins: [react()], server: { port, proxy }, preview: { port, proxy } };
});
