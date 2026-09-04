// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    // The Angular app owns its own lint config (angular-eslint).
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.angular/**',
      '**/coverage/**',
      'apps/web/**',
      'supabase/**',
      'scripts/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': [
        'warn',
        { allowExpressions: true, allowHigherOrderFunctions: true },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  prettier,
);
