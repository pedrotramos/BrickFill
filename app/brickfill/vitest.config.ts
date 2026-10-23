import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './client/src') } },
  test: {
    include: ['client/src/**/*.test.ts', 'server/**/*.test.ts'],
    environment: 'node',
  },
});
