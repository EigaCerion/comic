/**
 * Komikpedia — komikpedia.net
 *
 * SENGAJA tanpa preset, dan itu bukan kelalaian.
 *
 * Situs ini bukan tema WordPress komik melainkan aplikasi Next.js: daftar
 * chapternya tidak ada di HTML yang dikirim server sebagai elemen, melainkan di
 * dalam payload <script> yang dipakai React untuk merender halaman di browser.
 * Selector CSS apa pun yang ditulis di sini akan menemukan NOL chapter.
 *
 * Yang membacanya adalah dua jalur generik di mesin ekstraksi:
 * `chaptersFromPayload` (memanen daftar chapter dari payload itu) dan heuristik
 * "container dengan gambar terbanyak" untuk halaman bacanya. Keduanya jalan
 * justru ketika tidak ada selector yang cocok — jadi menambahkan preset di sini
 * akan MEMATIKANNYA.
 */
export default {
  host: 'komikpedia.net',
  nama: 'Komikpedia',
  pola: {
    note: 'Bukan tema wp-manga: situs Next.js, daftar chapter lengkap ada di payload <script>. Dibiarkan memakai heuristik + panen payload.',
  },
};
