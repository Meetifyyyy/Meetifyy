import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // The dev-server port is an environment value too, so a developer can move it
  // in .env.local rather than editing this file.
  const env = loadEnv(mode, __dirname, '')
  const devServerPort = Number.parseInt(env.VITE_DEV_SERVER_PORT || '5174', 10)

  return {
    plugins: [react()],
    clearScreen: false,
    server: {
      host: true,
      port: devServerPort,
    },
  }
})
