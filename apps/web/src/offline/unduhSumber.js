import { ASLI_NATIF } from '../platform/index.js';
import { alamatGambarSah, ambilHalamanChapter, headerGambar, kandidatGambar } from '../sumber/ambil.js';
import { siapkanPola } from '../sumber/pola.js';
import {
  daftarkanChapter,
  hapusBerkas,
  idSumber,
  jalurBerkas,
  pastikanFolder,
  tulisBlob,
  tulisChapterJson,
  ukuranBerkas,
  uriBerkas,
} from './penyimpanan.js';
import { dariSumber } from './idSumber.js';

/**
 * Menyimpan satu chapter LANGSUNG dari situs sumber ke penyimpanan HP — tanpa
 * server rumah, tanpa akun, tanpa izin apa pun.
 *
 * Inilah jawaban atas ketimpangan yang paling lama bertahan di aplikasi ini:
 * tombol unduh di layar Situs Sumber memanggil /api/imports/url, yang dijaga
 * kemampuan `kelola_koleksi` — jadi orang yang cuma memasang APK-nya tidak
 * pernah bisa memakainya, padahal seluruh gunanya aplikasi ini adalah membawa
 * komik di dalam HP.
 *
 * Berkas ini adalah kembaran unduh.js untuk jalur sumber, dan aturan mainnya
 * ditiru baris demi baris — bukan karena rapi, tapi karena setiap aturan di sana
 * lahir dari kerusakan yang sudah pernah terjadi:
 *
 * 1. Berkas yang sudah ada dan tidak kosong DILEWATI, supaya "batal lalu simpan
 *    lagi" melanjutkan alih-alih mengulang dari nol.
 * 2. chapter.json ditulis LEBIH DULU, katalog menyusul. Katalog adalah satu-
 *    satunya penanda "lengkap"; urutan terbalik membuat chapter yang prosesnya
 *    dibunuh di sela-selanya tampil di rak tanpa daftar halaman.
 * 3. Satu kegagalan menghentikan seluruh pekerja chapter itu, supaya tidak ada
 *    dua penulis di satu jalur berkas saat antreannya dinyalakan lagi.
 *
 * Yang BERBEDA dari jalur server, dan semuanya karena pihak seberangnya bukan
 * server rumah melainkan situs asing:
 *
 * - Gambar disimpan APA ADANYA, tanpa kompresi ulang. Kompresi itu hidup di
 *   sisi server (sharp), dan menirunya di WebView berarti memuat seluruh gambar
 *   ke memori JS — persis hal yang membuat unduhan panjang membunuh aplikasi.
 * - Ukuran halaman TIDAK diketahui sebelum diunduh, jadi berkas yang gagal di
 *   tengah jalan dibuang (hapusBerkas). Kalau dibiarkan, berkas separuh lolos
 *   sebagai "ada dan tidak kosong" pada percobaan berikutnya, dan chapternya
 *   masuk katalog sebagai lengkap dengan satu halaman rusak.
 * - Referer WAJIB dipasang di tiap permintaan gambar (lihat headerGambar).
 * - Sampul yang gagal diunduh TIDAK menggagalkan chapternya.
 */

/** Sama dengan unduh.js: tiga sekaligus per chapter, satu chapter pada satu waktu. */
const BATAS_SERENTAK = 3;

/**
 * Batas waktu per gambar di sisi native.
 *
 * readTimeout dihitung ulang setiap potongan data masuk (lihat definitions.d.ts
 * plugin file-transfer), jadi angka ini adalah "berapa lama boleh MACET", bukan
 * "berapa lama boleh mengunduh". Strip webtoon 8 MB di jaringan seluler lambat
 * tetap lolos; yang dibunuh hanya sambungan yang benar-benar berhenti mengalir.
 */
const BATAS_SAMBUNG_MS = 20_000;
const BATAS_MACET_MS = 45_000;

/**
 * Penanda pembatalan, dan sengaja MILIK BERKAS INI sendiri.
 *
 * unduh.js punya penandanya sendiri dengan nama yang sama. Menjadikannya satu
 * nilai bersama berarti salah satu berkas harus mengimpornya dari yang lain,
 * dan karena unduh.js-lah yang memanggil berkas ini, impornya melingkar: pada
 * evaluasi modul pertama salah satu sisi masih TDZ. Pompa di unduh.js tidak
 * membedakannya — ia sudah memperlakukan SETIAP lemparan sebagai pembatalan
 * selama penanda batalnya menyala.
 */
const DIBATALKAN = Symbol('dibatalkan');

/**
 * Ekstensi diambil dari URL gambarnya.
 *
 * Wajib, karena jalur ini menyimpan byte dari situs sumber apa adanya: berkas
 * JPEG yang dinamai .webp akan ditolak sebagian pengurai gambar, dan yang
 * terlihat di reader adalah halaman kosong tanpa satu pun galat. Kembarannya di
 * unduh.js sengaja tidak diimpor — lihat alasan lingkaran modul di atas.
 *
 * Kuerinya dibuang lebih dulu (?w=1200&v=3 bukan bagian nama berkas), dan yang
 * tidak dikenali jatuh ke .jpg — bukan .webp: gambar komik yang belum diproses
 * siapa pun jauh lebih sering JPEG.
 */
const ekstensiGambar = (url) => {
  const tanpaKueri = String(url ?? '').split(/[?#]/)[0];
  const nama = tanpaKueri.slice(tanpaKueri.lastIndexOf('/') + 1);
  const cocok = nama.match(/\.([A-Za-z0-9]{2,5})$/);
  const ekstensi = cocok ? cocok[1].toLowerCase() : '';
  return /^(webp|jpg|jpeg|png|avif|gif|bmp)$/.test(ekstensi) ? ekstensi : 'jpg';
};

/** 001.webp, 002.jpg, … — nomor urut, bukan nama dari situsnya. */
const namaHalaman = (nomor, url) => `${String(nomor).padStart(3, '0')}.${ekstensiGambar(url)}`;

/**
 * Turunkan satu gambar, mencoba host cadangan kalau yang utama menolak.
 *
 * Di perangkat sungguhan lewat @capacitor/file-transfer: ia menulis langsung ke
 * disk dari sisi native, dan DownloadFileOptions mewarisi HttpOptions sehingga
 * `headers` benar-benar terpasang di permintaannya. Jalur fetch di bawahnya
 * hanya untuk build android yang dibuka di browser desktop; untuk situs sumber
 * sungguhan ia akan berhenti di CORS (dan Referer maupun User-Agent ada di
 * daftar header terlarang milik fetch, jadi diam-diam dibuang) — yang tetap
 * berguna adalah seluruh alur di sekelilingnya bisa dijalankan tanpa HP.
 */
const turunkanGambar = async (kandidat, chapterId, nama, headers, penjaga) => {
  const jalur = jalurBerkas(chapterId, nama);
  let terakhir = null;

  for (const alamat of kandidat) {
    try {
      if (ASLI_NATIF) {
        const tujuan = uriBerkas(chapterId, nama);
        if (!tujuan) throw new Error('Folder penyimpanan aplikasi tidak bisa dibuka');
        const { FileTransfer } = await import('@capacitor/file-transfer');
        await FileTransfer.downloadFile({
          url: alamat,
          path: tujuan,
          method: 'GET',
          headers,
          connectTimeout: BATAS_SAMBUNG_MS,
          readTimeout: BATAS_MACET_MS,
        });
      } else {
        const res = await fetch(alamat, { cache: 'no-store', signal: penjaga.signal });
        if (!res.ok) {
          const galat = new Error(`HTTP ${res.status}`);
          // Dilekatkan, bukan cuma ditulis di pesan: galatJaringan() di unduh.js
          // memakainya untuk membedakan "situsnya menjawab, gambar ini memang
          // tidak ada" dari "tidak ada jaringan" — dan yang kedua menahan
          // SELURUH antrean alih-alih membuang satu chapter.
          galat.status = res.status;
          throw galat;
        }
        await tulisBlob(jalur, await res.blob());
      }
      return;
    } catch (galat) {
      terakhir = galat;
      // Berkas separuh dibuang sebelum alamat berikutnya dicoba. Tanpa ini,
      // percobaan kedua melihat berkas "ada dan tidak kosong" dan melewatinya.
      await hapusBerkas(jalur);
    }
  }

  throw terakhir ?? new Error(`Tidak ada alamat gambar yang sah untuk ${nama}`);
};

/**
 * Bentuk jawaban GET /api/chapters/:id untuk chapter yang tidak pernah lewat
 * server mana pun.
 *
 * bacaLokal.js menyebarkan objek ini APA ADANYA ke Reader (`{...simpanan.server,
 * pages, prev, next}`), jadi setiap bidang yang dibaca Reader dan ReaderControls
 * harus ada di sini. Yang benar-benar dipakai keduanya: id, comicId, number,
 * title, comic.title, comic.slug, dan lastPageRead/readAt (dipakai lanjutDari
 * untuk memilih antara posisi baca lokal dan milik server).
 *
 * `comic.slug` adalah satu-satunya yang perlu dijelaskan. ReaderHeader
 * menautkannya ke /comic/<slug> sebagai tombol Kembali, dan komik sumber tidak
 * punya halaman itu — /comic/:slug hidup dari koleksi server rumah dan akan
 * menjawab "tidak ditemukan" untuk komik yang memang tidak ada di sana. Karena
 * ReaderControls tidak boleh disentuh, yang dibengkokkan adalah NILAINYA:
 * "sumber/<comicId>" membuat tautan itu jadi /comic/sumber/<comicId>, sebuah
 * rute tersendiri di App.jsx yang mengantar ke rak "Tersimpan di HP". Tombol
 * Kembali tetap hidup, dan ia mendarat di satu-satunya layar yang pasti bisa
 * dibuka tanpa server.
 */
const bentukServer = ({ chapterId, comicId, nomor, judulChapter, judulKomik, jumlahHalaman, sumber }) => ({
  id: chapterId,
  comicId,
  number: nomor,
  title: judulChapter ?? null,
  totalPages: jumlahHalaman,
  // Belum pernah dibaca menurut server — karena tidak ada server yang pernah
  // tahu chapter ini. Keduanya WAJIB ada dan bernilai null, bukan tidak ada:
  // lanjutDari() membandingkannya dengan posisi baca lokal, dan `undefined`
  // membuat perbandingan waktunya menghasilkan NaN.
  lastPageRead: null,
  readAt: null,
  pages: [],
  prev: null,
  next: null,
  comic: {
    id: comicId,
    slug: `sumber/${comicId}`,
    title: judulKomik,
    // Sampulnya ada di HP, bukan di URL mana pun yang bisa dipakai reader.
    coverUrl: null,
  },
  // Asal-usulnya dibawa serta supaya layar rak bisa menawarkan jalan kembali ke
  // halaman serinya, dan supaya pemetaan id bisa dibangun ulang dari folder
  // kalau index.json hilang (lihat pemetaanDariChapter).
  sumber,
});

/**
 * Siapkan baris antrean untuk sekumpulan chapter dari satu seri sumber.
 *
 * Id lokalnya dialokasikan DI SINI, sebelum apa pun diunduh, karena tiga hal
 * memerlukannya lebih dulu: nama folder, dedup antrean di unduhanSlice (yang
 * berkunci chapterId), dan tombol per chapter yang menanyakan status unduhannya.
 *
 * Alokasinya berurutan, bukan Promise.all. idSumber() sendiri sudah aman
 * dipanggil berbarengan — ia lewat rantai ubahIndeks — tapi setiap alokasi
 * menulis index.json, dan 25 penulisan yang saling menyusul lebih pelan
 * daripada 25 yang berbaris rapi.
 */
export const siapkanAntrianSumber = async ({ host, urlSeri, judulKomik, urlSampul, chapters }) => {
  const daftar = [];
  for (const chapter of chapters) {
    const { comicId, chapterId } = await idSumber({
      host,
      urlSeri,
      nomor: chapter.nomor,
      urlChapter: chapter.url,
    });
    daftar.push({
      chapterId,
      comicId,
      nomor: chapter.nomor,
      judulKomik,
      slugKomik: `sumber/${comicId}`,
      // Keberadaan blok ini yang membuat pompa() memilih jalur sumber.
      sumber: {
        host,
        urlSeri,
        urlChapter: chapter.url,
        judulChapter: chapter.judul ?? null,
        urlSampul: urlSampul ?? null,
      },
    });
  }
  return daftar;
};

/**
 * Simpan satu chapter sumber beserta sampul serinya.
 *
 * @param {object} antrian baris antrean dari siapkanAntrianSumber()
 * @param {{ saatMaju?: (selesai:number, total:number) => void, batal?: () => boolean }} opsi
 */
export const simpanChapterSumber = async (antrian, { saatMaju, batal } = {}) => {
  const { chapterId, comicId, nomor, judulKomik, sumber } = antrian;
  if (!sumber?.urlChapter) throw new Error('Baris antrean sumber tanpa alamat chapter');
  if (!dariSumber(chapterId)) throw new Error(`Id ${chapterId} bukan id lokal untuk entri sumber`);

  // Pembatalan dibuat LENGKET, sama seperti di unduh.js: `batal` menunjuk
  // keadaan yang di-null-kan lalu diisi ulang untuk chapter BERIKUTNYA tanpa
  // satu await di antaranya, jadi pekerja yang baru bangun dari I/O-nya akan
  // membaca pembatalan yang salah dan melanjutkan chapter yang sudah
  // ditinggalkan — menghabiskan kuota sambil merusak penghitung kemajuan
  // chapter yang sedang jalan.
  let berhenti = false;
  const dibatalkan = () => {
    if (!berhenti && batal?.()) berhenti = true;
    return berhenti;
  };
  const periksaBatal = () => {
    if (dibatalkan()) throw DIBATALKAN;
  };

  // Tabel pola dipastikan terpasang di sini juga, bukan hanya di layar Sumber.
  // Antrean bisa dinyalakan lagi oleh pemulihan jaringan tanpa layar itu pernah
  // dipasang ulang, dan membaca halaman chapter dengan selector bawaan yang
  // sudah kedaluwarsa menghasilkan "tidak ada gambar" yang menuduh situsnya.
  await siapkanPola();

  const halamanSumber = await ambilHalamanChapter(sumber.urlChapter);
  periksaBatal();

  const gambar = (halamanSumber.imageUrls ?? []).filter((url) => alamatGambarSah(url));
  if (gambar.length === 0) {
    throw new Error(
      `Tidak ada gambar terbaca di ${sumber.urlChapter} — kemungkinan situsnya berganti tema, ` +
        'atau halaman ini memuat pembacanya lewat skrip',
    );
  }

  await pastikanFolder(chapterId);

  const header = headerGambar(halamanSumber.urlAkhir ?? sumber.urlChapter);
  const cadangan = halamanSumber.hostFallbacks ?? {};

  const halaman = gambar.map((url, i) => ({
    number: i + 1,
    berkas: namaHalaman(i + 1, url),
    kandidat: kandidatGambar(url, cadangan),
  }));

  // Sampul ikut diunduh, seperti jalur server: seluruh gunanya rak /offline
  // adalah bisa dipakai saat tidak ada jaringan sama sekali, dan sampul yang
  // masih menunjuk CDN situs sumber jadi kotak kosong di sana.
  const sampul = sumber.urlSampul
    ? { berkas: `sampul.${ekstensiGambar(sumber.urlSampul)}`, kandidat: kandidatGambar(sumber.urlSampul, cadangan) }
    : null;

  const tugas = [...halaman];
  if (sampul) tugas.push({ number: 0, berkas: sampul.berkas, kandidat: sampul.kandidat, bolehGagal: true });

  const total = tugas.length;
  let selesai = 0;
  let bytes = 0;
  let sampulAda = false;
  saatMaju?.(0, total);

  const penjaga = new AbortController();
  let indeks = 0;

  const pekerja = async () => {
    for (;;) {
      if (dibatalkan()) {
        penjaga.abort();
        throw DIBATALKAN;
      }
      const tugasKu = tugas[indeks];
      indeks += 1;
      if (!tugasKu) return;

      try {
        const jalur = jalurBerkas(chapterId, tugasKu.berkas);
        let ada = await ukuranBerkas(jalur);

        // Situs sumber tidak menyebutkan ukuran halaman di mana pun, jadi
        // "ada dan tidak kosong" adalah satu-satunya syarat yang bisa dipakai.
        // Yang menambalnya: berkas yang gagal di tengah jalan dibuang di
        // turunkanGambar, jadi yang tersisa di disk hanya berkas utuh.
        if (ada === null || ada <= 0) {
          await turunkanGambar(tugasKu.kandidat, chapterId, tugasKu.berkas, header, penjaga);
          ada = await ukuranBerkas(jalur);
        }

        bytes += ada ?? 0;
        if (tugasKu.number === 0) sampulAda = true;
        selesai += 1;
        saatMaju?.(selesai, total);
      } catch (galat) {
        /*
         * Sampul yang gagal tidak menggagalkan chapternya.
         *
         * Bedanya dengan jalur server bukan kelonggaran: sampul di sana datang
         * dari server rumah yang sama dengan halamannya, jadi kalau sampulnya
         * gagal, halamannya juga pasti gagal. Di sini sampul datang dari CDN
         * yang berbeda dari CDN halaman, dan sebagian menolak permintaan gambar
         * sampul dengan 403 sementara halaman chapternya dilayani normal.
         * Membuang 40 halaman yang sudah terunduh karena satu sampul adalah
         * kerugian yang tidak sebanding dengan kartu tanpa gambar di rak.
         */
        if (tugasKu.bolehGagal) {
          selesai += 1;
          saatMaju?.(selesai, total);
          continue;
        }
        // Kegagalan satu pekerja menghentikan dua lainnya. Kalau tidak, pompa()
        // bisa menahan chapter ini sementara dua pekerja masih menulis, lalu
        // menyalakannya lagi dari indeks 0 — dua penulis di satu jalur berkas.
        berhenti = true;
        throw galat;
      }
    }
  };

  // allSettled, bukan all: Promise.all kembali begitu satu pekerja menolak dan
  // membiarkan dua lainnya hidup terus di dalam for(;;)-nya.
  const hasil = await Promise.allSettled(Array.from({ length: Math.min(BATAS_SERENTAK, total) }, pekerja));
  const ditolak = hasil.filter((satu) => satu.status === 'rejected').map((satu) => satu.reason);
  if (ditolak.length > 0) {
    // Yang dilaporkan adalah kegagalan SUNGGUHAN, bukan DIBATALKAN milik pekerja
    // yang cuma ikut berhenti — pompa() memperlakukan pembatalan sebagai "beres"
    // dan akan mengeluarkan chapter ini dari antrean tanpa pesan galat.
    throw ditolak.find((alasan) => alasan !== DIBATALKAN) ?? DIBATALKAN;
  }
  periksaBatal();

  const namaSampul = sampulAda ? sampul.berkas : null;

  const entriChapter = {
    id: chapterId,
    comicId,
    nomor,
    judul: sumber.judulChapter ?? null,
    jumlahHalaman: halaman.length,
    bytes,
    disimpanPada: new Date().toISOString(),
    punyaSampul: Boolean(namaSampul),
    namaSampul,
    // Ikut disimpan di baris katalog, bukan hanya di chapter.json: pemetaan id
    // dibangun ulang dari baris-baris inilah kalau index.json rusak.
    sumber: { host: sumber.host, urlSeri: sumber.urlSeri, urlChapter: sumber.urlChapter },
  };

  const entriKomik = {
    id: comicId,
    slug: `sumber/${comicId}`,
    judul: judulKomik,
    sumber: { host: sumber.host, urlSeri: sumber.urlSeri },
  };
  /*
   * `sampul` hanya DISERTAKAN kalau sampulnya benar-benar ada.
   *
   * daftarkanChapter menggabungkan entri komik dengan `{...lama, ...baru}`, jadi
   * menyertakan `sampul: null` berarti chapter kedua yang sampulnya gagal
   * MENGHAPUS sampul yang sudah didapat chapter pertama — dan kartu komiknya di
   * rak berubah jadi kotak kosong tanpa ada yang tahu kenapa.
   */
  if (namaSampul) entriKomik.sampul = `${chapterId}/${namaSampul}`;

  // chapter.json lebih dulu, katalog paling akhir. Urutan terbalik membuat
  // chapter yang prosesnya terbunuh di sela-selanya tampil di rak padahal
  // daftar halamannya belum ada.
  await tulisChapterJson(chapterId, {
    versi: 1,
    chapter: entriChapter,
    komik: entriKomik,
    server: bentukServer({
      chapterId,
      comicId,
      nomor,
      judulChapter: sumber.judulChapter,
      judulKomik,
      jumlahHalaman: halaman.length,
      sumber: { host: sumber.host, urlSeri: sumber.urlSeri, urlChapter: sumber.urlChapter },
    }),
    halaman: halaman.map(({ number, berkas }) => ({ number, berkas, size: 0 })),
  });

  await daftarkanChapter({ komik: entriKomik, chapter: entriChapter });
  return entriChapter;
};
