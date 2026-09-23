// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Build output, test coverage, runtime uploads and gitignored scratch.
    // Linting dist/ lints src/ a second time as compiled JS: none of those
    // files is in a tsconfig, so the type-aware parser builds a separate
    // program for each one, and 596 of them exhaust the heap.
    ignores: [
      'eslint.config.mjs',
      'dist/**',
      'coverage/**',
      'uploads/**',
      'scratch/**',
    ],
  },
  {
    linterOptions: {
      // A disable comment that no longer suppresses anything is a stale
      // claim about the code next to it.
      reportUnusedDisableDirectives: 'error',
    },
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // The five no-unsafe-* rules report where an `any` is used; this one
      // reports where it is written. With it off, one `any` in a service
      // surfaced as dozens of violations in its callers and never at the
      // source. Existing sites are recorded in eslint-suppressions.json.
      '@typescript-eslint/no-explicit-any': 'error',
      // Underscore marks a binding that exists for its position, not its
      // value: a caught error we deliberately ignore, an argument a signature
      // requires, a destructured key pulled out only to leave it behind. The
      // rule cannot tell those from an oversight, so the prefix says which.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  {
    // Shell scripts outside the app. No tsconfig the project service reads
    // includes them, so they get their own program (tsconfig.tooling.json).
    files: [
      'scripts/**/*.{ts,js}',
      'prisma/*.ts',
      'render-templates.ts',
      'send-all-mailpit.ts',
    ],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./tsconfig.tooling.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Jest matchers name a method without calling it — `expect(service.find)`
    // asks about the mock attached to that property and never invokes it, so
    // the lost `this` the rule warns about cannot happen. Enforced everywhere
    // that does call its methods.
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', '**/testing/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
