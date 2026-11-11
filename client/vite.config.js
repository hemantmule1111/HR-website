import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// VITE_BASE is the folder the site is served from (for example /hr/ for https://example.com/hr/). Default: the domain root.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: {
    // /documentation is served by the API server (a plain HTML page, not part of the React app).
    proxy: { '/api': 'http://localhost:4000', '^/documentation$': 'http://localhost:4000' },
  },
})
