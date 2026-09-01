import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.VITE_API_PROXY || 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    // host: true -> bind ke 0.0.0.0 supaya bisa dibuka dari HP di Wi-Fi yang sama.
    host: process.env.VITE_HOST === 'false' ? 'localhost' : true,
    // /api dan /media di-proxy ke Express, jadi frontend cukup pakai path relatif
    // (tidak ada masalah CORS, dan URL gambar dari API bisa dipakai apa adanya).
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/media': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          redux: ['@reduxjs/toolkit', 'react-redux'],
        },
      },
    },
  },
});
