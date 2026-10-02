import { hosts } from './situs/index.js';

/*
 * Tabel pola situs sumber — sekarang hanya pembungkus.
 *
 * Isinya dulu satu objek raksasa berisi delapan situs sekaligus. Sekarang tiap
 * situs punya berkasnya sendiri di packages/sumber/situs/, lengkap dengan
 * penjelasan keanehannya masing-masing, dan situs/index.js yang merangkainya.
 * Yang tersisa di sini cuma dua hal: nomor versi, dan bentuk yang sudah
 * terlanjur dipakai di banyak tempat.
 *
 * ── Kenapa tetap ada berkas ini ───────────────────────────────────────────
 *
 * Bentuk `{ versi, hosts }` adalah KONTRAK, bukan sekadar susunan:
 *   - apps/web/src/sumber/pola.js membandingkan `versi` miliknya dengan milik
 *     server rumah, dan memasang yang lebih baru lewat pasangTabelPola();
 *   - GET /api/sumber/pola (apps/api/src/routes/sumber.js) menyajikan objek ini
 *     apa adanya lewat jaringan ke setiap HP;
 *   - pasangTabelPola() menolak tabel yang tidak punya `hosts` dan `versi`.
 * Mengubah bentuknya berarti APK yang sudah beredar berhenti bisa menerima
 * perbaikan selector.
 *
 * ── Kenapa JS, bukan JSON ─────────────────────────────────────────────────
 *
 * Berkas ini harus diimpor dengan cara yang SAMA dari server (Node) dan dari
 * aplikasi Android (bundel Vite). Node menuntut import attributes untuk JSON
 * ("with { type: 'json' }"), Vite tidak mengenalnya, dan membaca berkas lewat
 * node:fs tidak mungkin di browser. Modul JS biasa adalah satu-satunya bentuk
 * yang dimengerti keduanya tanpa syarat tambahan.
 *
 * Konsekuensinya: ini KODE, bukan data. Dulu selectors.json yang rusak hanya
 * membuat extractor turun ke heuristik; sekarang satu koma yang hilang di salah
 * satu berkas situs adalah SyntaxError yang membuat server tidak menyala sama
 * sekali. Jalankan `npm run precheck` setelah menyunting.
 *
 * ── Aturan `versi` ────────────────────────────────────────────────────────
 *
 * Naikkan setiap kali ISI selector berubah — selector ditambah, diperbaiki,
 * situs baru didaftarkan, situs lama dimatikan. Tanpa itu, HP yang sudah
 * menyimpan tabel lama tidak punya alasan untuk mengambil yang baru, dan
 * perbaikannya tidak pernah sampai ke siapa pun.
 *
 * TIDAK perlu dinaikkan untuk perubahan yang tidak mengubah satu nilai pun
 * yang dibaca extractor — seperti pemecahan berkas ini sendiri, atau komentar
 * yang diperbaiki. Menaikkannya di situ hanya membuat setiap HP mengunduh
 * ulang tabel yang isinya persis sama.
 *
 * ── Yang tetap terlarang ──────────────────────────────────────────────────
 *
 * Memutasi objek ini langsung (Object.assign ke selectors.hosts). Tabelnya satu
 * modul untuk seumur proses, jadi mutasi seperti itu mencemari tabel bawaan APK
 * tanpa jejak dan tanpa jalan pulang. pasangTabelPola() menukar RUJUKANNYA,
 * bukan isinya, justru supaya tabel bawaan masih utuh saat tabel dari server
 * ternyata yang rusak.
 */
export default {
  versi: 4,
  hosts,
};
