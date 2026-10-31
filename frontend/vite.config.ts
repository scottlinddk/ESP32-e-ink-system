import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE_URL || 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: process.env.VITE_SOURCEMAP === 'true',
    rolldownOptions: {
      output: {
        codeSplitting: {
          includeDependenciesRecursively: true,
          groups: [
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|react-router-dom)[\\/]/ },
            { name: 'vendor-clerk', test: /node_modules[\\/]@clerk[\\/]clerk-react[\\/]/ },
            { name: 'vendor-query', test: /node_modules[\\/]@tanstack[\\/]react-query[\\/]/ },
            { name: 'vendor-grid', test: /node_modules[\\/]react-grid-layout[\\/]/ },
          ],
        },
      },
    },
  },
});
