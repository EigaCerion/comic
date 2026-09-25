import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.VITE_API_PROXY || 'http://localhost:3000';

// Satu sumber kebenaran untuk versi: package.json di folder ini. Angka yang sama
// dibaca build-android.ps1 untuk menyetel versionName/versionCode APK dan untuk
// menamai berkasnya, jadi versi yang dilihat aplikasi tidak pernah bisa berbeda
// dari versi APK-nya. Dibaca dari berkas, bukan diimpor: `import pkg from
// './package.json'` menyeret seluruh isi package.json ke dalam bundel.
const versiPaket = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

// mode 'android' = bundel yang dibungkus Capacitor. Ia keluar ke folder lain
// supaya `cap sync` tidak pernah menyentuh dist/ — folder itu yang disajikan
// server rumah yang sedang berjalan, dan menimpanya berarti mengganti UI semua
// orang di jaringan dengan bundel yang mengarah ke alamat server tersimpan.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Disuntik di KEDUA mode. Kalau define ini dibatasi ke mode android,
  // `__VERSI_APL__` menjadi identifier bebas di bundel web — aman hanya selama
  // Rollup berhasil membuang setiap berkas yang menyebutnya, dan kegagalannya
  // berupa ReferenceError di halaman orang lain. Itu bukan lagi soal teoretis:
  // selain platform/pembaruan.js (yang tidak pernah ikut bundel web), footer di
  // components/Layout/AppLayout.jsx sekarang membacanya juga, dan berkas itu
  // memang ikut kedua bundel.
  define: { __VERSI_APL__: JSON.stringify(versiPaket) },
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
    outDir: mode === 'android' ? 'dist-android' : 'dist',
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
}));
