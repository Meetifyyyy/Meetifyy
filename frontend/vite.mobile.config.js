/**
 * The mobile build target.
 *
 * Its job is defined as much by what it leaves out as by what it does, and each
 * omission is the structural half of a guard that would otherwise be a runtime
 * check somebody could get wrong.
 *
 *   NO vite-plugin-pwa. This is how blocker B4 is closed. The web gate for the
 *   service worker is a runtime condition, and it has already failed open once
 *   — `config/index.js` documents at length how a `VITE_APP_ENV` comparison
 *   registered a worker on the development deployment. A build that never
 *   contains the plugin cannot regress that way. It matters because a caching
 *   worker in a WebView can serve its copy of the DEPLOYED SITE instead of the
 *   app the store reviewed, and because iOS has no service worker support at
 *   all. CI greps `dist-mobile/` to prove it stayed out.
 *
 *   NO patchCspHashPlugin. That plugin rewrites `vercel.json` — two tracked
 *   files — from inside `closeBundle`. It is web-deploy configuration, and a
 *   mobile build touching it would be a mobile change altering the website's
 *   security headers. This is issue B11 confined rather than fixed.
 *
 *   NO SEO prerender, robots, sitemap or version stamp. Nothing crawls an app
 *   bundle, and there is no deployment for a version gate to compare against.
 *
 *   NO visualizer. It writes `stats.html` at a fixed path that the web build
 *   also writes, so running both would leave whichever ran last.
 *
 *   NO framer-motion chunk. Twelve files import it and nine of them are the
 *   marketing landing page, which mobile does not render. Omitting the manual
 *   chunk does not by itself exclude the library — nothing importing it is the
 *   thing that does — but it stops an empty vendor chunk being emitted, and it
 *   makes the intent visible if an import ever creeps in.
 *
 * `base` is '/', not './'. Capacitor serves `webDir` from the origin root, and
 * relative asset paths break a client-side router: from `/messages/abc`,
 * `./assets/x.js` resolves to `/messages/assets/x.js`.
 */
import { defineConfig } from 'vite';
import path from 'path';
import fs from 'node:fs';
import react from '@vitejs/plugin-react';
import { sharedAliases, sharedCss, sharedOnWarn } from './vite.shared.js';

/**
 * Renames the built `index.mobile.html` to `index.html`.
 *
 * Vite names an HTML output after its input, and Capacitor's `webDir` is served
 * with `index.html` as the document root. Renaming the source file instead
 * would put two `index.html` files in the package and make which-config-builds-
 * which a matter of remembering.
 */
function emitAsIndexHtml() {
  return {
    name: 'meetifyy-mobile-index-name',
    apply: 'build',
    // On disk in `closeBundle`, not by rewriting `bundle` in `generateBundle`:
    // Vite emits the HTML document outside the normal Rollup asset graph, so
    // renaming the entry there silently does nothing — which is exactly what it
    // did on the first attempt, leaving `index.mobile.html` in the output and a
    // Capacitor shell that would have found no document at all.
    closeBundle() {
      const out = path.resolve(__dirname, 'dist-mobile');
      const built = path.join(out, 'index.mobile.html');
      if (!fs.existsSync(built)) {
        throw new Error('[mobile] index.mobile.html was not emitted — the entry name changed?');
      }
      fs.renameSync(built, path.join(out, 'index.html'));
    },
  };
}

/**
 * Drops the assets in `public/` that exist only for the website.
 *
 * Vite copies `publicDir` wholesale, which is right for the web build and wrong
 * here: the fifteen iOS PWA splash screens alone are 1.14 MB, and they exist so
 * Safari can draw a launch image for an installed web app. A native app's
 * splash is drawn by the platform from its own assets, so every one of those
 * bytes is carried to no purpose — against a budget where the whole bundle is
 * supposed to fit in a few megabytes.
 *
 * `robots.txt` and `version.json` go for the same reason: nothing crawls an app
 * bundle, and there is no deployment for a version gate to compare against.
 *
 * Deliberately an allowlist of things to REMOVE rather than of things to keep.
 * A new asset added to `public/` should appear in the app by default and be
 * excluded on purpose; the reverse would mean a missing image nobody can
 * explain.
 */
function dropWebOnlyPublicAssets() {
  const WEB_ONLY = [/^splash\//, /^robots\.txt$/, /^version\.json$/, /^og\//];
  return {
    name: 'meetifyy-mobile-drop-web-assets',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (WEB_ONLY.some((re) => re.test(fileName))) delete bundle[fileName];
      }
    },
    closeBundle() {
      // publicDir files are copied outside the bundle graph, so they have to be
      // removed from disk rather than from `bundle`.
      const out = path.resolve(__dirname, 'dist-mobile');
      for (const rel of ['splash', 'robots.txt', 'version.json', 'og']) {
        fs.rmSync(path.join(out, rel), { recursive: true, force: true });
      }
    },
  };
}

export default defineConfig({
  /**
   * Marks this bundle as the mobile client.
   *
   * `shared/api/apiClient.js` reads it (through `config.client`) to choose the
   * native API origin instead of the browser one — without which every request
   * inside the WebView resolves to `localhost:4000`, because the web
   * implementation derives the backend host from `window.location`.
   *
   * Set here rather than in an env file so it cannot be forgotten: a mobile
   * build that did not carry it would look completely normal and fail only on
   * a device.
   */
  define: {
    'import.meta.env.VITE_CLIENT': JSON.stringify('mobile'),
  },

  /**
   * Absolute, and set explicitly rather than left to Vite's default.
   *
   * It is already '/' by default, but the choice is load-bearing enough to be
   * visible: relative paths would break a client-side router, because from
   * `/messages/abc` an asset at `./assets/x.js` resolves to
   * `/messages/assets/x.js`. Capacitor serves `webDir` from the origin root, so
   * absolute is both correct and what the router needs.
   */
  base: '/',

  plugins: [react(), emitAsIndexHtml(), dropWebOnlyPublicAssets()],

  css: sharedCss,

  resolve: {
    alias: sharedAliases(__dirname),
  },

  build: {
    outDir: 'dist-mobile',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'index.mobile.html'),
      onwarn: sharedOnWarn,
      output: {
        manualChunks: {
          // Mirrors the web config, minus `vendor-framer`. framer-motion is
          // imported by twelve files and nine of them are the landing page,
          // which the app replaces with its own opening screen — so the chunk
          // would be near-empty here. Omitting it does not by itself exclude
          // the library; not importing it does.
          'vendor-react': ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query', '@tanstack/react-virtual'],
          'vendor-emoji': ['emoji-mart', '@emoji-mart/react'],
          'vendor-icons': ['@hugeicons/react', '@hugeicons/core-free-icons', '@heroicons/react'],
          'vendor-zustand': ['zustand', 'immer'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },

  optimizeDeps: {
    include: [
      'react', 'react-dom', 'react-router-dom', '@tanstack/react-query',
      'zustand', 'immer', 'socket.io-client',
    ],
  },

  clearScreen: false,
});
