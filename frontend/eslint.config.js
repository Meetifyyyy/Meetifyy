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
      // The mobile build target's output. Same reason as dist/: it is generated,
      // minified and not source. It needs its own entry because the rule above
      // is a literal path rather than a glob over dist*, and linting a minified
      // bundle produces ~80 errors that say nothing about the code that made it.
      'dist-mobile/**',
      'dev-dist/**',
      'node_modules/**',
      'public/**',
      'stats.html',
      // Gitignored local-only dev previews — absent in a clean checkout.
      'src/local/**',
      // The two TypeScript contract files. Linting them would mean adding
      // typescript-eslint — a parser, a plugin and their tree — to check two
      // files that `npm run typecheck` already checks far more strictly than
      // ESLint could. Revisit if `core/` is ever converted wholesale (Phase 10),
      // at which point the parser earns its place.
      '**/*.ts',
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

  /**
   * `@capacitor/*` is confined to one directory, so that replacing Capacitor is
   * a change to `platform/capacitor/` and the mobile UI, and to nothing else.
   * The rule is written now, while the count is zero, because the cheapest time
   * to hold a line is before anything has crossed it.
   */
  {
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/platform/capacitor/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@capacitor/*', '@capacitor-community/*'],
              message:
                'Capacitor may only be imported from src/platform/capacitor/. Everywhere else goes ' +
                'through a platform/contracts.ts interface, injected at the composition root.',
            },
          ],
        },
      ],
    },
  },
  /**
   * ── Architecture boundaries ──────────────────────────────────────────────
   *
   * `src/core/` is the code that more than one client will run: the API
   * contracts, domain rules, validation and the navigation intent model. Today
   * that means the web app; later the Capacitor app; possibly a React Native
   * app after that. What makes it reusable is not where it sits but what it is
   * forbidden to touch, and these are the rules that make "forbidden" mean
   * something a build can check.
   *
   * These are ERRORS, not warnings. The rest of this config is deliberately
   * quiet because a noisy lint gets ignored — but a violation here is not a
   * style opinion, it is `core/` ceasing to be portable, and it is far cheaper
   * to stop at the pull request than to discover it when a second client is
   * being written against it.
   *
   * WHY BUILT-IN RULES RATHER THAN eslint-plugin-boundaries
   * Everything needed right now — no DOM, no build-time env, no imports back
   * into the app — is expressible with rules ESLint already has. The plugin's
   * real value is a many-to-many zone matrix, and there is only one zone to
   * point away from until `src/mobile/` exists. It is worth adding then, with
   * dependency-cruiser alongside it for the graph report; it is not worth a
   * dependency now.
   */
  {
    files: ['src/core/**/*.{js,jsx}'],
    rules: {
      /**
       * No DOM, no browser globals.
       *
       * React Native has none of these, and a Capacitor WebView has versions of
       * them that lie: `location.hostname` inside the app is `localhost`, which
       * is what makes the current API-origin derivation resolve the backend to
       * `https://localhost:4000` on a phone. Anything here that genuinely needs
       * a device capability takes it through `platform/contracts.ts` instead.
       *
       * `fetch` is deliberately NOT restricted: it exists in browsers, in
       * WebViews, in React Native and in Node 22. It is the one piece of
       * platform the transport layer may assume.
       */
      'no-restricted-globals': [
        'error',
        ...[
          'window',
          'document',
          'localStorage',
          'sessionStorage',
          'indexedDB',
          'navigator',
          'location',
          'history',
          'caches',
          'matchMedia',
          'alert',
          'confirm',
          'prompt',
          'IntersectionObserver',
          'ResizeObserver',
          'requestAnimationFrame',
        ].map((name) => ({
          name,
          message:
            `core/ must not touch ${name}: it does not exist in React Native, and inside a ` +
            'WebView it reports the app shell rather than the site. Route it through a ' +
            'platform/ interface, or keep the code in the client that needs it.',
        })),
      ],

      'no-restricted-syntax': [
        'error',
        {
          /**
           * `import.meta.env` is a Vite build-time substitution. Metro does not
           * implement it, so a `core/` module that reads it cannot be bundled
           * for React Native at all — and even on web it silently bakes one
           * build's configuration into code meant to be shared by two clients
           * with different configuration. Configuration is passed in, not read.
           */
          selector: "MemberExpression[object.type='MetaProperty']",
          message:
            'core/ must not read import.meta.env. It is a Vite-only build-time value that ' +
            'Metro cannot provide. Take configuration as an argument at construction instead.',
        },
      ],

      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // The app's own aliases all point into client code.
              group: [
                '@shared/*',
                '@features/*',
                '@layout/*',
                '@stores/*',
                '@styles/*',
                '@assets/*',
                '@config',
                '@config/*',
                '@constants/*',
              ],
              message:
                'core/ must not import client code. Dependencies point INTO core/, never out of it — ' +
                'otherwise core/ drags the web app behind it into any other client.',
            },
            {
              // The same thing by relative path, which is how it would actually
              // happen: a file is moved into core/ and its old imports come too.
              group: [
                '**/shared/**',
                '**/features/**',
                '**/layout/**',
                '**/styles/**',
                '**/local/**',
                '**/platform/web/**',
                '**/platform/capacitor/**',
              ],
              message:
                'core/ must not import client code or a concrete platform implementation. ' +
                'Depend on platform/contracts (types only) and let the composition root inject the rest.',
            },
            {
              group: ['@capacitor/*', 'react-native', 'react-native/*'],
              message:
                'core/ is platform-agnostic. Native APIs belong behind a platform/ interface.',
            },
            {
              group: ['react', 'react-dom', 'react-dom/*', 'react-router', 'react-router-dom'],
              message:
                'core/ holds contracts, domain rules and validation — not components, hooks or routes. ' +
                'React-dependent code belongs in the client that renders it.',
            },
          ],
        },
      ],
    },
  },

];
