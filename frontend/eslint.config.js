import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import jsxA11y from 'eslint-plugin-jsx-a11y';

/**
 * Lint config for the web app.
 *
 * The point of this file is `no-undef`. Three modules shipped calling an API
 * object they never imported — usersApi in useMessageActions (which is why
 * blocking silently never reached the server), groupApi in InviteModal, and
 * activitiesApi in ActivityDetailPage. Vite resolves none of that at build
 * time, so each one only failed once a user hit the code path, and one of them
 * failed invisibly inside an unhandled promise rejection.
 *
 * Everything else is tuned deliberately quiet. A lint run that prints hundreds
 * of stylistic complaints on an existing codebase gets ignored, and then the
 * one rule that matters gets ignored with it. Correctness rules are errors;
 * hygiene is a warning; style is off.
 */
export default [
  {
    ignores: [
      'dist/**',
      'dev-dist/**',
      'node_modules/**',
      'public/**',
      'stats.html',
      // Gitignored local-only dev previews — absent in a clean checkout.
      'src/local/**',
    ],
  },

  js.configs.recommended,

  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      // Registered with no rules enabled. The codebase already carries
      // `eslint-disable jsx-a11y/...` comments, and a disable directive naming
      // a rule ESLint has never heard of is itself an error — so the plugin has
      // to be loaded for those lines to resolve, even while we opt out of
      // enforcing accessibility rules for now.
      'jsx-a11y': jsxA11y,
    },
    rules: {
      // ── The rules this config exists for ────────────────────────────────
      'no-undef': 'error',
      // Counts identifiers used only inside JSX, without which every imported
      // component looks unused and no-unused-vars becomes pure noise.
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'off', // React 17+ automatic JSX runtime
      'react/react-in-jsx-scope': 'off',

      // ── Correctness ────────────────────────────────────────────────────
      'react-hooks/rules-of-hooks': 'error',

      // ── Hygiene: real signal, but not worth blocking a build over ──────
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-vars': [
        'warn',
        {
          args: 'none',
          varsIgnorePattern: '^_',
          // `catch (_)` is used throughout for deliberately ignored errors.
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'react-refresh/only-export-components': 'off',
    },
  },

  // Node-context files: build scripts and config run outside the browser.
  {
    files: ['*.config.js', 'scripts/**/*.{js,mjs}', 'vite.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Service worker: its own global scope.
  {
    files: ['src/sw.js', 'src/**/*worker*.js'],
    languageOptions: {
      globals: { ...globals.serviceworker, ...globals.browser },
    },
  },
];
