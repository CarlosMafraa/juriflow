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
      '@juriflow/movement-normalizer': resolve('./packages/movement-normalizer/src/index.ts'),
      '@juriflow/collector-engine/testing': resolve('./packages/collector-engine/src/testing/index.ts'),
      '@juriflow/collector-engine': resolve('./packages/collector-engine/src/index.ts'),
      '@juriflow/adapter-datajud/testing': resolve('./packages/adapter-datajud/src/testing/index.ts'),
      '@juriflow/adapter-datajud': resolve('./packages/adapter-datajud/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/*.spec.ts'],
    environment: 'node',
    clearMocks: true,
  },
});
