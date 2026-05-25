import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '^/(indicadores|conceptos|resultados|health)': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        bypass(req) {
          // Only bypass page navigations (browser requests HTML), not API calls (fetch/AJAX).
          // API calls from the SPA use headers like Accept: application/json.
          const accept = req.headers.accept ?? '';
          const isPageNavigation = accept.includes('text/html');

          // SPA page routes that share the API namespace
          const spaRoutes = [
            '/indicadores/nuevo',
            '/resultados',
          ];
          const isEditRoute = /^\/indicadores\/[^/]+\/editar$/.test(req.url ?? '');

          if (isPageNavigation && (spaRoutes.includes(req.url ?? '') || isEditRoute)) {
            return '/index.html';
          }
        },
      },
    },
  },
})
