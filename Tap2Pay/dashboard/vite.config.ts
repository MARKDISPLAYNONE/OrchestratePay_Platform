import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // In development, proxy /api requests to the backend so CORS is not an issue.
    // In production, serve both from the same domain (e.g. nginx) or set VITE_API_BASE.
    proxy: {
      '/api': 'http://localhost:3000'
    }
  }
})
