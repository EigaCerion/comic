/*
 * Hitungan rentang chapter untuk panel "Simpan ke HP".
 *
 * Dipisahkan dari SimpanKeHP.jsx bukan demi kerapian: isi berkas ini adalah
 * satu-satunya bagian fitur itu yang bisa diperiksa tanpa perangkat Android.
 * Panelnya sendiri hanya dirender di build APK (IS_APP), jadi selama logikanya
 * duduk di dalam komponen, "apakah 'Ch 300-360' benar-benar memilih 61 chapter"
 * hanya bisa dijawab dengan memasang APK. Sebagai modul JS biasa, ia bisa
 * dijalankan langsung oleh Node — lihat apps/api/scripts/test-rentang.js.
 *
 * Semua fungsi di sini murni: tidak membaca Redux, tidak menyentuh penyimpanan,
 * dan tidak mengantre apa pun.
 */

/** Chapter yang berkasnya sudah ada di server, jadi benar-benar bisa disalin. */
export const bisaDisimpan = (chapter) => Boolean(chapter?.isDownloaded) && (chapter?.totalPages ?? 0) > 0;

/**
 * Chapter yang layak disimpan, urut dari nomor terkecil.
 *
 * Diurutkan naik, bukan turun seperti daftar di layar: rentang "dari–sampai"
 * dibaca manusia dari kecil ke besar, dan chapter pertama yang diantre harus
 * yang terendah supaya unduhan berjalan searah dengan urutan baca.
 */
export const daftarLayak = (chapters = []) =>
  chapters.filter(bisaDisimpan).sort((a, b) => a.number - b.number);

/**
 * Chapter di dalam rentang nomor, batas ikut terhitung (inklusif).
 *
 * Batasnya ditukar sendiri kalau terbalik. Kotak angka membiarkan siapa pun
 * mengetik "dari 90 sampai 30" — sering karena mengubah satu sisi saja setelah
 * memakai tombol cepat — dan menjawabnya dengan nol chapter akan terbaca seperti
 * koleksi yang kosong, bukan seperti angka yang perlu ditukar.
 */
export const dalamRentang = (berurutan = [], dari, sampai) => {
  const bawah = Math.min(dari, sampai);
  const atas = Math.max(dari, sampai);
  return berurutan.filter((chapter) => chapter.number >= bawah && chapter.number <= atas);
};

/**
 * Pisahkan yang perlu diunduh dari yang sudah ada di HP.
 *
 * `sudahDiHp` diberi sebagai fungsi, bukan daftar id: pemanggilnya membaca indeks
 * offline yang berubah selama panel terbuka (unduhan lain bisa selesai sementara
 * orangnya masih memilih), dan menyalinnya jadi daftar lebih dulu membuat
 * hitungan di layar membeku pada keadaan saat panel dibuka.
 */
export const pisahkanCalon = (dalam = [], sudahDiHp = () => false) => {
  const calon = dalam.filter((chapter) => !sudahDiHp(chapter));
  return { calon, sudahAda: dalam.length - calon.length };
};

/**
 * Rentang untuk tombol cepat "N berikutnya", dihitung dari titik lanjut baca.
 *
 * `mulaiDariNomor` tidak harus ada di daftar: chapter yang sedang dibaca bisa
 * saja belum terunduh (dibaca langsung dari server), jadi yang dicari adalah
 * chapter tersedia PERTAMA yang nomornya tidak lebih kecil darinya. Kalau titik
 * itu sudah melewati chapter terakhir, yang diambil N terakhir yang ada —
 * mengembalikan rentang kosong akan membuat tombolnya terasa mati.
 */
export const rentangCepat = (berurutan = [], mulaiDariNomor, jumlah) => {
  if (berurutan.length === 0 || jumlah <= 0) return null;

  const mulai = berurutan.findIndex((chapter) => chapter.number >= mulaiDariNomor);
  const awal = mulai >= 0 ? mulai : Math.max(berurutan.length - jumlah, 0);
  const potongan = berurutan.slice(awal, awal + jumlah);
  if (potongan.length === 0) return null;

  return { dari: potongan[0].number, sampai: potongan[potongan.length - 1].number };
};
