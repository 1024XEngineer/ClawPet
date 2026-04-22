import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendTarget = process.env.GOCLAW_BACKEND_URL || 'http://127.0.0.1:18790'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 3002,
    strictPort: true,
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/pico': {
        target: backendTarget,
        changeOrigin: true,
        ws: true,
      },
      '/pet/': {
        target: backendTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        settings: 'settings.html',
      },
    },
  },
})
