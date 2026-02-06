// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Asegúrate de que el proxy esté configurado correctamente
      '/api': {
        target: 'http://localhost:3001', // Tu backend
        changeOrigin: true,
        secure: false,
      }
    }
  }
})