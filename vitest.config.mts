import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  plugins: [
    {
      name: 'svg-asset-stub',
      transform(_code, id) {
        if (id.endsWith('.svg')) return { code: 'export default 1;', map: null };
      },
    },
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
