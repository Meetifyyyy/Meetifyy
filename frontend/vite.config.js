import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import fs from 'fs';
import { visualizer } from 'rollup-plugin-visualizer';

const BUILD_TIME = Date.now();

function versionBuildPlugin() {
  return {
    name: 'version-build-plugin',
    buildStart() {
      const versionData = JSON.stringify({ version: BUILD_TIME, buildTime: new Date(BUILD_TIME).toISOString() });
      const publicDir = path.resolve(__dirname, 'public');
      if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
      }
      fs.writeFileSync(path.join(publicDir, 'version.json'), versionData);
    }
  };
}

export default defineConfig(({ mode }) => {
  // Dev-server settings are environment values too, so a developer running the
  // backend on a different port or host changes .env.local, not this file.
  const env = loadEnv(mode, __dirname, '');
  const devServerPort = Number.parseInt(env.VITE_DEV_SERVER_PORT || '3000', 10);
  const devApiTarget = env.VITE_DEV_API_PROXY_TARGET || `http://127.0.0.1:${env.VITE_API_LOCAL_PORT || '4000'}`;

  return {
  define: {
    __APP_BUILD_TIME__: BUILD_TIME
  },
  plugins: [
    versionBuildPlugin(),
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.png', 'logo-192.png', 'logo-512.png', 'logo-192-maskable.png', 'logo-512-maskable.png'],
      manifest: {
        name: "Meetifyy",
        short_name: "Meetifyy",
        description: "Meetifyy — your vibe, your tribe, your spotlight. Connect with like-minded people, join communities, and build your network.",
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
        globPatterns: ['**/*.{js,css,html,png,webp,svg,woff2}'],
        // The iOS startup images are read by Safari at launch, one per device,
        // straight from the network or the HTTP cache — never through the
        // worker. Precaching all fifteen would add ~1.2 MB to every install to
        // hold fourteen images that device will never request.
        globIgnores: ['**/version.json', '**/stats.html', 'splash/**'],
      },
    }),
    visualizer({ open: false, filename: 'stats.html', gzipSize: true, brotliSize: true })
  ],
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
          'vendor-emoji': ['emoji-mart', '@emoji-mart/data', '@emoji-mart/react'],
          'vendor-icons': ['lucide-react', '@heroicons/react'],
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
      'lucide-react',
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
