import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'examples/**', 'test/fixtures/**', 'coverage/**', 'docs/**', 'bench/tasks/**', 'bench/.venv*/**', 'eval/**', 'bench/.work/**', '.site-dist/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  { files: ['site/**/*.js'], languageOptions: { globals: globals.browser } },
  { files: ['scripts/**/*.mjs'], languageOptions: { globals: globals.node } },
  { files: ['scripts/site/worker.js'], languageOptions: { globals: globals.serviceworker } },
);
