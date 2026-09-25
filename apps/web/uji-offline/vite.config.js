import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/*
 * Konfigurasi khusus pengujian lapisan offline.
 *
 * Dua hal yang dikerjakannya, dan keduanya tidak bisa dilakukan dari Node biasa:
 *
 * 1. Plugin Capacitor ditukar dengan tiruan di memori. Alias-nya dipasang di
 *    resolve, bukan lewat parameter, supaya penukarannya berlaku juga untuk
 *    impor dinamis yang ada di DALAM kode produksi (penyimpanan.js memanggil
 *    import('@capacitor/filesystem') di dalam fungsi).
 *
 * 2. mode 'android' — tanpa itu IS_APP bernilai false dan seluruh lapisan
 *    offline yang sedang diuji justru dibuang oleh pemangkasan Rollup.
 */
const di = (jalur) => fileURLToPath(new URL(jalur, import.meta.url));

export default defineConfig({
  root: di('.'),
  // Aset dirujuk relatif, bukan dari akar: halaman ini dilayani dari sebuah
  // subfolder oleh server sementara di pandu.mjs, dan jalur absolut '/assets/…'
  // membuat skrip modulnya tidak pernah ditemukan.
  base: './',
  resolve: {
    alias: {
      '@capacitor/filesystem': di('./tiruan-filesystem.js'),
      '@capacitor/preferences': di('./tiruan-preferences.js'),
    },
  },
  build: {
    outDir: di('./dist'),
    emptyOutDir: true,
  },
});
