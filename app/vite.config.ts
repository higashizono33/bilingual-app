import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // amazon-cognito-identity-jsがNode.jsの`global`を参照するため、ブラウザ向けにglobalThisへ解決する
  define: {
    global: 'globalThis',
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
