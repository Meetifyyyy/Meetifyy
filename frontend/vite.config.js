import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import fs from 'fs';
import { visualizer } from 'rollup-plugin-visualizer';
import { postcssHoverMedia } from './scripts/postcss-hover-media.js';
import { isProductionAppEnv } from './src/config/deploymentEnv.js';

/**
 * Emits a self-destroying `sw.js` for every non-production build.
 *
 * Simply not shipping a worker is not enough. A browser that already installed
 * the dev PWA keeps its existing worker forever unless it can fetch a NEW
 * /sw.js and see that it differs — a 404 leaves the old worker installed and
 * still serving the cached app shell offline, which is exactly the Cloudflare
 * Access bypass this fixes. So the dev build must serve a real script at the
 * same URL whose only job is to tear the installation down.
 *
 * IMPORTANT: browsers refuse to update a worker whose script request is
 * redirected, so Cloudflare Access must be given a Bypass rule for `/sw.js`
 * on the dev hostname — otherwise the Access 302 blocks delivery of this
 * tombstone and stale installs can never be reached. `/sw.js` carries no user
 * data, so exempting only that exact path is safe.
 */
/**
 * Stamps the build's version into index.html.
 *
 * The launch gate runs in an inline script, before any bundle has loaded, so it
 * needs the version synchronously — it cannot import it. Replacing a
 * placeholder in the HTML is what makes the running page able to state its own
 * identity at the moment it starts.
 *
 * Reads the same `public/version.json` that `scripts/generate-version.mjs`
 * writes immediately before the build, so the page and the file it later
 * fetches are stamped from one source and cannot disagree about what this build
 * is. If that file is missing (someone ran `vite build` directly), the
 * placeholder is replaced with an empty string, which the gate treats as
 * "unknown" and skips — failing open rather than reload-looping every client.
 */
function stampBuildVersionPlugin() {
  let version = '';
  return {
    name: 'meetifyy-stamp-build-version',
    apply: 'build',
    buildStart() {
      try {
        const raw = fs.readFileSync(
          path.resolve(process.cwd(), 'public/version.json'),
          'utf8'
        );
        version = JSON.parse(raw).version || '';
      } catch {
        version = '';
      }
    },
    transformIndexHtml(html) {
      return html.replace(/__MEETIFYY_BUILD_VERSION__/g, version);
    },
  };
}

/**
 * Removes the development-hostname bootstrap from production builds.
 *
 * index.html carries a small script that forwards the dev project's generated
 * `*.vercel.app` URL to dev.meetifyy.app. On the production host that condition
 * can never be true, so in a production build it is dead code whose only effect
 * is to write "dev.meetifyy.app" into every document the public site serves.
 *
 * The requirement it violates is absolute: no production artefact may name a
 * non-production host. A script string is not a crawlable link and Google will
 * not follow it, so this is hygiene rather than an active leak, but it is the
 * kind of exception that gets copied into somewhere it does matter.
 */
/**
 * Removes the dev server's CSP meta tag from production builds.
 *
 * See the block it targets in index.html. In short: the deployed policy is the
 * header in vercel.json and it is strictly tighter than the meta tag, so
 * dropping the tag narrows the effective policy rather than widening it, and
 * stops the public site publishing localhost origins in every document.
 */
function stripDevCspPlugin() {
  return {
    name: 'meetifyy-strip-dev-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        /[ \t]*<!-- DEV-CSP:START -->[\s\S]*?<!-- DEV-CSP:END -->\n?/g,
        '',
      );
    },
  };
}

function stripDevHostGuardPlugin() {
  return {
    name: 'meetifyy-strip-dev-host-guard',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        /[ \t]*<!-- DEV-HOST-GUARD:START -->[\s\S]*?<!-- DEV-HOST-GUARD:END -->\n?/g,
        '',
      );
    },
  };
}

function tombstoneServiceWorkerPlugin() {
  const source = `// Non-production build: remove the old installation only after
// its open clients have naturally closed. Deliberately no skipWaiting or client
// navigation: development deployments must not interrupt active sessions either.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
    await self.registration.unregister();
  })());
});
`;
  return {
    name: 'tombstone-service-worker',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
      console.log('[pwa] non-production build → emitted self-unregistering sw.js');
    },
  };
}

export default defineConfig(({ mode }) => {
  // Dev-server settings are environment values too, so a developer running the
  // backend on a different port or host changes .env.local, not this file.
  const env = loadEnv(mode, __dirname, '');
  const devServerPort = Number.parseInt(env.VITE_DEV_SERVER_PORT || '3000', 10);
  const devApiTarget = env.VITE_DEV_API_PROXY_TARGET || `http://127.0.0.1:${env.VITE_API_LOCAL_PORT || '4000'}`;

  // The real PWA service worker is built for PRODUCTION ONLY, and this is
  // opt-in: anything that is not exactly "production" gets the tombstone worker
  // instead, so a missing or misspelled VITE_APP_ENV fails to the safe side.
  //
  // A legacy caching worker on the development deployment is an access-control
  // hole because its cached shell can bypass Cloudflare Access entirely.
  const isProductionApp = isProductionAppEnv(env.VITE_APP_ENV);

  return {
  plugins: [
    react(),
    stampBuildVersionPlugin(),
    // Production only: see the plugin's own note.
    ...(isProductionApp ? [stripDevHostGuardPlugin(), stripDevCspPlugin()] : []),
    ...(isProductionApp ? [VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectRegister: false,
      includeAssets: ['favicon.png', 'logo-192.png', 'logo-512.png', 'logo-192-maskable.png', 'logo-512-maskable.png'],
      manifest: {
        name: "Meetifyy",
        short_name: "Meetifyy",
        description: "Meetifyy brings students together around what they actually care about. Join communities, find events on campus, and meet people worth knowing.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        // Android composes the splash itself from exactly three things: this
        // colour, the 512 icon, and `name`. #FDFDFD is the logo tile's own
        // background — matching it exactly is what stops the tile showing as a
        // faint square outline, so the mark reads as floating on the screen.
        // Kept in step with LAUNCH_BG in scripts/generate-pwa-assets.mjs.
        background_color: "#FDFDFD",
        // Was #7c3aed, a purple the app uses nowhere. This tints the status bar
        // and the Android task-switcher card, so the installed app was badged
        // in a colour that appears in no other surface. Matches
        // --color-primary now.
        theme_color: "#2563EB",
        categories: ["social", "communication"],
        icons: [
          {
            src: "/logo-192.png?v=3",
            sizes: "192x192",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "/logo-512.png?v=3",
            sizes: "512x512",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "/logo-192-maskable.png?v=3",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable"
          },
          {
            src: "/logo-512-maskable.png?v=3",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      injectManifest: {
        maximumFileSizeToCacheInBytes: 10485760, // 10 MiB limit
        globPatterns: ['**/*.{js,css,png,webp,svg,woff2}'],
        // The iOS startup images are read by Safari at launch, one per device,
        // straight from the network or the HTTP cache — never through the
        // worker. Precaching all fifteen would add ~1.2 MB to every install to
        // hold fourteen images that device will never request.
        globIgnores: ['**/stats.html', 'splash/**'],
      },
    })] : [tombstoneServiceWorkerPlugin()]),
    visualizer({ open: false, filename: 'stats.html', gzipSize: true, brotliSize: true })
  ],
  css: {
    postcss: {
      plugins: [
        postcssHoverMedia({ mediaQuery: '(hover: hover) and (pointer: fine)' })
      ]
    }
  },
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.message?.includes('externalized for browser compatibility') || warning.code === 'MODULE_LEVEL_DIRECTIVE') {
          return;
        }
        warn(warning);
      },
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query', '@tanstack/react-virtual'],
          'vendor-framer': ['framer-motion'],
          // '@emoji-mart/data' is deliberately absent: it is no longer imported
          // as a module at all. It is fetched as a hashed .json asset instead,
          // so it never enters the JS graph and never lands in a chunk.
          'vendor-emoji': ['emoji-mart', '@emoji-mart/react'],
          'vendor-icons': ['@hugeicons/react', '@hugeicons/core-free-icons', '@heroicons/react'],
          'vendor-zustand': ['zustand', 'immer']
        }
      }
    },
    chunkSizeWarningLimit: 600
  },
  resolve: {
    alias: {
      // ── canonical new paths ──────────────────────────────────────
      '@config':   path.resolve(__dirname, 'src/config'),
      '@stores':   path.resolve(__dirname, 'src/shared/stores'),
      '@shared':   path.resolve(__dirname, 'src/shared'),
      '@layout':   path.resolve(__dirname, 'src/layout'),
      '@features': path.resolve(__dirname, 'src/features'),
      '@data/communities': path.resolve(__dirname, 'src/features/communities/data/communities'),
      '@data/messages': path.resolve(__dirname, 'src/features/messages/data/messages'),
      '@data':     path.resolve(__dirname, 'src/data'),
      '@styles':   path.resolve(__dirname, 'src/styles'),
      '@constants': path.resolve(__dirname, 'src/constants'),
      '@assets':   path.resolve(__dirname, 'src/assets'),

      // ── bridge aliases (old paths → new locations) ───────────────
      // shared layer
      '@/context':            path.resolve(__dirname, 'src/shared/context'),
      '@/hooks':              path.resolve(__dirname, 'src/shared/hooks'),
      '@/utils':              path.resolve(__dirname, 'src/shared/utils'),

      // shared components (from common/)
      '@/components/common':  path.resolve(__dirname, 'src/shared/components'),

      // layout shell
      '@/components/layout':  path.resolve(__dirname, 'src/layout'),

      // feature component groups
      '@/components/messages': path.resolve(__dirname, 'src/features/messages/components'),
      '@/components/chat':     path.resolve(__dirname, 'src/features/messages/components/previews'),
      '@/components/feed':     path.resolve(__dirname, 'src/features/feed/components'),
      '@/components/profile':  path.resolve(__dirname, 'src/features/profile/components'),
      '@/components/communities': path.resolve(__dirname, 'src/features/communities/components'),
      '@/components/crew':     path.resolve(__dirname, 'src/features/crew/components'),
      '@/components/search':   path.resolve(__dirname, 'src/features/search/components'),
      '@/components/ui':       path.resolve(__dirname, 'src/shared/components'),

      // pages → features
      '@/pages': path.resolve(__dirname, 'src/features'),
      '@/constants': path.resolve(__dirname, 'src/constants'),
      '@/assets': path.resolve(__dirname, 'src/assets'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      '@tanstack/react-query',
      'framer-motion',
      '@hugeicons/react',
      '@hugeicons/core-free-icons',
      'zustand',
      'immer',
      'socket.io-client',
      '@supabase/supabase-js',
    ],
  },
  clearScreen: false,
  server: {
    port: devServerPort,
    open: true,
    host: true,
    allowedHosts: true,
    warmup: {
      clientFiles: [
        './src/App.jsx',
        './src/shared/context/AuthContext.jsx',
        './src/features/feed/pages/FeedRoute.jsx',
        './src/features/messages/components/layout/MessagesLayout.jsx',
      ],
    },
    proxy: {
      '/api': {
        target: devApiTarget,
        changeOrigin: true,
        secure: false,
      },
      '/health': {
        target: devApiTarget,
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: devApiTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  };
});
