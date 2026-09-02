import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const root = path.resolve(import.meta.dirname, '../..');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@config': path.resolve(root, 'src/config'),
      '@stores': path.resolve(root, 'src/shared/stores'),
      '@shared': path.resolve(root, 'src/shared'),
      '@layout': path.resolve(root, 'src/layout'),
      '@features': path.resolve(root, 'src/features'),
      '@styles': path.resolve(root, 'src/styles'),
      '@constants': path.resolve(root, 'src/constants'),
      '@assets': path.resolve(root, 'src/assets'),
      '@': path.resolve(root, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [path.resolve(root, 'src/__perf__/setup.js')],
    include: [path.resolve(root, 'src/__perf__/**/*.perf.jsx')],
    css: false,
  },
});
