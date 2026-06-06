import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@esp32-eink/types': path.resolve(__dirname, '../types/src/index.ts'),
    },
  },
  test: {
    globals: true,
  },
});
