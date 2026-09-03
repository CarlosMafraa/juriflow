import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolve = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Roda os testes contra o código-fonte dos pacotes, sem exigir build prévio.
      '@juriflow/shared-types': resolve('./packages/shared-types/src/index.ts'),
      '@juriflow/domain': resolve('./packages/domain/src/index.ts'),
      '@juriflow/collectors-core': resolve('./packages/collectors-core/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/*.spec.ts'],
    environment: 'node',
    clearMocks: true,
  },
});
