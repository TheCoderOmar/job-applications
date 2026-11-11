import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // APP_PORT (set by start.bat) moves the web app; PORT moves the API and this proxy with it.
    port: Number(process.env.APP_PORT ?? 5173),
    proxy: { '/api': `http://localhost:${process.env.PORT ?? 3001}` },
  },
});
