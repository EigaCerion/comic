/**
 * Webtoons — webtoons.com — DIMATIKAN DENGAN SENGAJA.
 *
 * Bukan situs agregator seperti tetangganya di folder ini, melainkan penerbit
 * resmi yang membayar lisensi karyanya, dan Ketentuan Layanannya melarang
 * pengambilan otomatis. Jadi yang dicatat di sini bukan selector melainkan
 * penolakan.
 *
 * `disabled: true` membuat resolveSourceConfig() MELEMPAR begitu ada URL
 * webtoons.com masuk — ke mana pun ia datang: tempel URL manual, impor seri,
 * maupun antrean unduh. Pesannya diambil dari `note`, jadi yang muncul di layar
 * adalah kalimat di bawah ini, bukan galat teknis yang menyesatkan.
 *
 * Jangan dihapus dari daftar untuk "merapikan": tanpa baris ini host-nya jatuh
 * ke heuristik generik dan justru akan dicoba.
 */
export default {
  host: 'webtoons.com',
  nama: 'Webtoons',
  pola: {
    note: 'Layanan resmi berlisensi; ToS-nya melarang pengambilan otomatis. Tidak disediakan preset.',
    disabled: true,
  },
};
