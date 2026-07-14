import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'logo-192.png', 'logo-512.png', 'logo-192-maskable.png', 'logo-512-maskable.png'],
      manifest: {
        name: "Meetifyy",
        short_name: "Meetifyy",
        description: "Meetifyy — your vibe, your tribe, your spotlight. Connect with like-minded people, join communities, and build your network.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#ffffff",
        theme_color: "#7c3aed",
        categories: ["social", "communication"],
        icons: [
          {
            src: "/logo-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "/logo-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "/logo-192-maskable.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable"
          },
          {
            src: "/logo-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 10485760, // 10 MiB limit
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,jpg,jpeg,webp}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-framer': ['framer-motion'],
          'vendor-emoji': ['emoji-mart', '@emoji-mart/data', '@emoji-mart/react'],
          'vendor-html2canvas': ['html2canvas'],
          'vendor-icons': ['lucide-react', '@heroicons/react']
        }
      }
    },
    chunkSizeWarningLimit: 600
  },
  resolve: {
    alias: {
      // ── canonical new paths ──────────────────────────────────────
      '@shared':   path.resolve(__dirname, 'src/shared'),
      '@layout':   path.resolve(__dirname, 'src/layout'),
      '@features': path.resolve(__dirname, 'src/features'),
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
  server: {
    port: 3000,
    open: true,
    host: true,
    allowedHosts: ['.trycloudflare.com'],
  },
});
