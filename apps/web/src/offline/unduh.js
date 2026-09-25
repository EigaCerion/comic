import { api } from '../api/apiSlice.js';
import { ASLI_NATIF } from '../platform/index.js';
import { lepasLayar, tahanLayar } from '../platform/jagaLayar.js';
import { urlMedia } from '../platform/server.js';
import store from '../store/index.js';
import { antrekan, beres, buangSatu, gagal, kosongkan, maju, mulai, tunda } from '../store/slices/unduhanSlice.js';
import {
  daftarkanChapter,
  jalurBerkas,
  pastikanFolder,
  tulisBlob,
  tulisChapterJson,
  ukuranBerkas,
  uriBerkas,
} from './penyimpanan.js';
import { siapkanAntrianSumber, simpanChapterSumber } from './unduhSumber.js';

/**
 * Menyalin satu chapter dari server rumah ke penyimpanan HP, dan antrean yang
 * mengurus keduanya — chapter dari server rumah maupun chapter yang diambil
 * langsung dari situs sumber (unduhSumber.js).
 *
 * Tiga hal yang membentuk seluruh berkas ini:
 *
 * 1. Chapter komik bukan satu berkas melainkan 15–60 gambar. Diunduh satu per
 *    satu terasa lama sekali di Wi-Fi rumah; diunduh sekaligus membuat server
 *    yang sama juga sedang melayani pembaca di desktop tersendat. Tiga sekaligus
 *    adalah titik tengah yang sudah dipakai antrean unduh di sisi server.
 * 2. Unduhan PASTI akan terputus (layar dikunci, keluar jangkauan Wi-Fi, ditekan
 *    batal). Jadi berkas yang sudah ada dan ukurannya benar dilewati, dan
 *    chapter baru masuk katalog setelah semuanya lengkap. Yang setengah jalan
 *    tidak pernah terlihat seperti yang utuh.
 * 3. Satu chapter sekaligus, bukan paralel antar chapter. "Simpan 10 chapter"
 *    yang menembak 10×3 permintaan berbarengan membuat server rumah — yang
 *    kadang sedang mengunduh dari situs sumber — kehabisan napas.
 *
 * Antrean di bagian bawah berkas ini melayani DUA jalur. Yang membedakannya
 * hanya satu bidang di baris antrean: `sumber`. Kalau ada, chapternya diambil
 * dari situs sumber lewat unduhSumber.js; kalau tidak, dari server rumah lewat
 * simpanChapter di bawah. Kemajuan, pembatalan, penahanan saat jaringan putus,
 * dan lencana di sidebar melewati jalan yang sama persis untuk keduanya —
 * antrean yang bercabang di lebih dari satu tempat adalah antrean yang cabangnya
 * akan berbeda diam-diam begitu salah satunya diperbaiki.
 *
 * Ketergantungannya SATU ARAH: berkas ini memanggil unduhSumber.js, tidak
 * sebaliknya. Itu yang membuat keduanya boleh saling melengkapi tanpa lingkaran
 * impor — dan itu pula alasan beberapa potongan kecil (ekstensi berkas, penanda
 * pembatalan) sengaja tidak dibagi di antara keduanya.
 */

const BATAS_SERENTAK = 3;

/** Dilempar saat pembatalan, supaya tidak tercatat sebagai kegagalan. */
const DIBATALKAN = Symbol('dibatalkan');

/**
 * Nama berkas diambil dari URL server, bukan dibuat ulang dari nomor halaman.
 *
 * Halaman bernomor sama bisa berbeda ekstensi (webp hasil kompresi vs jpg asli
 * dari impor lama), dan chapter.json menyimpan nama ini apa adanya. Kalau nama
 * dikarang di sini, satu chapter lama akan menunjuk berkas yang tidak pernah
 * ditulis. Query ?v= dibuang: ia penanda versi untuk cache HTTP, bukan bagian
 * nama berkas.
 */
const namaDariUrl = (url, cadangan) => {
  const tanpaKueri = String(url ?? '').split('?')[0];
  const dasar = tanpaKueri.slice(tanpaKueri.lastIndexOf('/') + 1);
  const bersih = dasar.replace(/[^A-Za-z0-9._-]/g, '');
  return bersih || cadangan;
};

const ekstensiDariUrl = (url) => {
  const nama = namaDariUrl(url, '');
  const titik = nama.lastIndexOf('.');
  return titik > 0 ? nama.slice(titik + 1).toLowerCase() : 'webp';
};

/**
 * Turunkan satu berkas ke folder chapter.
 *
 * Di perangkat sungguhan lewat @capacitor/file-transfer: ia menulis langsung ke
 * disk dari lapisan native. Jalur fetch+writeFile harus melewatkan seluruh isi
 * gambar sebagai base64 melalui jembatan JS→native, dan strip webtoon bisa 5 MB
 * sebuah — itulah yang membuat unduhan panjang berakhir dengan aplikasi
 * terbunuh kehabisan memori. Di browser desktop plugin itu tidak punya tempat
 * menulis, jadi di sana dipakai fetch biasa ke IndexedDB lewat Filesystem.
 */
const turunkanBerkas = async (url, chapterId, nama, penjaga) => {
  if (ASLI_NATIF) {
    const tujuan = uriBerkas(chapterId, nama);
    if (!tujuan) throw new Error('Folder penyimpanan aplikasi tidak bisa dibuka');
    const { FileTransfer } = await import('@capacitor/file-transfer');
    await FileTransfer.downloadFile({ url, path: tujuan, method: 'GET' });
    return;
  }

  const res = await fetch(url, { cache: 'no-store', signal: penjaga.signal });
  if (!res.ok) {
    // Statusnya DILEKATKAN, tidak cuma ditulis di pesan. galatJaringan memakainya
    // untuk membedakan "server menjawab, halaman ini memang tidak ada" dari
    // "server tidak terjangkau" — dan yang kedua menahan SELURUH antrean.
    const galat = new Error(`HTTP ${res.status}`);
    galat.status = res.status;
    throw galat;
  }
  await tulisBlob(jalurBerkas(chapterId, nama), await res.blob());
};

/**
 * Simpan satu chapter beserta cover komiknya.
 *
 * @param {number} chapterId
 * @param {{ saatMaju?: (selesai: number, total: number) => void, batal?: () => boolean }} opsi
 */
export const simpanChapter = async (chapterId, { saatMaju, batal } = {}) => {
  /*
   * Pembatalan dibuat LENGKET dan milik panggilan ini, bukan dibaca ulang dari
   * state modul tiap iterasi.
   *
   * `batal` menunjuk `pembatalan`, yang di blok finally pompa() di-null-kan lalu
   * langsung diisi ulang untuk chapter BERIKUTNYA — semuanya sinkron, tanpa satu
   * pun await di antaranya. Pekerja yang masih tertahan di I/O-nya baru bangun
   * jauh sesudah itu, jadi yang dibacanya adalah pembatalan yang baru dan
   * jawabannya false lagi: ia melanjutkan chapter yang sudah ditinggalkan,
   * menghabiskan kuota untuk berkas yang tidak ada yang menunggu, dan setiap
   * berkas yang selesai memanggil saatMaju milik chapter LAMA ke atas penghitung
   * chapter yang sedang jalan — "3/40" tiba-tiba jadi "27/41".
   */
  let berhenti = false;
  const dibatalkan = () => {
    if (!berhenti && batal?.()) berhenti = true;
    return berhenti;
  };
  const periksaBatal = () => {
    if (dibatalkan()) throw DIBATALKAN;
  };

  // Jawaban GET /api/chapters/:id sudah berisi komik, seluruh halaman, dan
  // tetangga prev/next — persis yang dibutuhkan reader nanti saat luring, jadi
  // tidak ada permintaan tambahan yang perlu dibuat.
  const server = await store
    .dispatch(api.endpoints.getChapter.initiate(String(chapterId), { subscribe: false, forceRefetch: true }))
    .unwrap();

  if (!server?.pages?.length) throw new Error('Chapter ini belum punya halaman di server');
  periksaBatal();

  await pastikanFolder(chapterId);

  const halaman = server.pages.map((page, i) => ({
    number: page.number,
    size: page.size ?? 0,
    berkas: namaDariUrl(page.url, `${String(i + 1).padStart(3, '0')}.webp`),
    url: urlMedia(page.url),
  }));

  const namaSampul = server.comic?.coverUrl ? `sampul.${ekstensiDariUrl(server.comic.coverUrl)}` : null;
  const tugas = [...halaman];
  if (namaSampul) {
    // Cover ikut diunduh, bukan diambil dari server saat rak offline dibuka:
    // seluruh gunanya halaman /offline adalah bisa dipakai saat server mati.
    tugas.push({ number: 0, size: 0, berkas: namaSampul, url: urlMedia(server.comic.coverUrl) });
  }

  const total = tugas.length;
  let selesai = 0;
  let bytes = 0;
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

        // Berkas yang sudah ada dan ukurannya cocok dilewati. Itu yang membuat
        // "batal lalu simpan lagi" melanjutkan, bukan mengulang dari nol. Untuk
        // halaman lama yang server tidak tahu ukurannya, adanya berkas tidak
        // kosong sudah dianggap cukup — memaksa unduh ulang semuanya jauh lebih
        // mahal daripada sesekali menyimpan berkas yang ternyata terpotong.
        const cocok = ada !== null && (tugasKu.size > 0 ? ada === tugasKu.size : ada > 0);
        if (!cocok) {
          await turunkanBerkas(tugasKu.url, chapterId, tugasKu.berkas, penjaga);
          ada = await ukuranBerkas(jalur);
        }

        bytes += ada ?? 0;
        selesai += 1;
        saatMaju?.(selesai, total);
      } catch (galat) {
        // Kegagalan satu pekerja harus menghentikan dua lainnya, bukan hanya
        // dirinya sendiri. Kalau tidak, pompa() men-`tunda` chapter ini sementara
        // dua pekerja masih menulis — lalu lanjutkanUnduhan() menyalakan
        // simpanChapter yang sama dari indeks 0 dan dua downloadFile menulis
        // berkas yang PERSIS sama berbarengan. Ukuran hanya diperiksa SEBELUM
        // unduh, jadi hasil tabrakannya lolos dan chapter itu masuk katalog
        // sebagai lengkap padahal satu halamannya rusak.
        //
        // penjaga.abort() sengaja TIDAK dipanggil di sini: kedua pekerja lain
        // akan memanggilnya sendiri begitu putarannya kembali ke atas, dan
        // membatalkan fetch mereka dari sini hanya membuat AbortError ikut
        // masuk ke daftar alasan dan bersaing dengan kegagalan yang sebenarnya.
        berhenti = true;
        throw galat;
      }
    }
  };

  /*
   * allSettled, bukan all: Promise.all kembali begitu SATU pekerja menolak dan
   * membiarkan dua lainnya hidup terus di dalam for(;;)-nya. simpanChapter baru
   * boleh kembali sesudah SEMUA pekerja benar-benar berhenti — tidak ada pekerja
   * yatim, tidak ada saatMaju nyasar, tidak ada dua penulis di satu jalur berkas.
   */
  const hasil = await Promise.allSettled(Array.from({ length: Math.min(BATAS_SERENTAK, total) }, pekerja));
  const ditolak = hasil.filter((satu) => satu.status === 'rejected').map((satu) => satu.reason);
  if (ditolak.length > 0) {
    // Yang dilaporkan adalah kegagalan SUNGGUHAN, bukan DIBATALKAN milik pekerja
    // yang cuma ikut berhenti: pompa() memperlakukan DIBATALKAN sebagai "beres"
    // dan akan mengeluarkan chapter ini dari antrean tanpa satu pun pesan galat.
    throw ditolak.find((alasan) => alasan !== DIBATALKAN) ?? DIBATALKAN;
  }
  periksaBatal();

  const entriChapter = {
    id: server.id,
    comicId: server.comicId,
    nomor: server.number,
    judul: server.title ?? null,
    jumlahHalaman: halaman.length,
    bytes,
    disimpanPada: new Date().toISOString(),
    punyaSampul: Boolean(namaSampul),
    namaSampul,
  };

  const entriKomik = {
    id: server.comic.id,
    slug: server.comic.slug,
    judul: server.comic.title,
    sampul: namaSampul ? `${server.id}/${namaSampul}` : null,
  };

  // chapter.json ditulis SEBELUM katalog, dan katalog menjadi satu-satunya
  // penanda "sudah lengkap". Urutan terbalik akan membuat chapter yang
  // prosesnya terbunuh di sela-sela kedua penulisan tampil di rak offline
  // padahal daftar halamannya belum ada.
  await tulisChapterJson(chapterId, {
    versi: 1,
    chapter: entriChapter,
    komik: entriKomik,
    server,
    halaman: halaman.map(({ number, berkas, size }) => ({ number, berkas, size })),
  });

  await daftarkanChapter({ komik: entriKomik, chapter: entriChapter });
  return entriChapter;
};

/* ── Antrean ────────────────────────────────────────────────────────── */

let berjalan = false;
let pembatalan = null;

/**
 * Status HTTP dari galat, dari mana pun ia datang.
 *
 * Tiga sumber galat di berkas ini menaruhnya di tiga tempat berbeda: RTK Query
 * memasang `status` di akarnya, fetch di sini melekatkannya sendiri, dan
 * @capacitor/file-transfer menyimpannya di `error.data.httpStatus` — definitions.d.ts
 * plugin itu menyatakannya hitam di atas putih, dan objek yang sampai ke JS
 * adalah CapacitorException yang cuma punya message/code/data, tanpa `status`
 * sama sekali. Membaca satu tempat saja berarti dua dari tiga sumber diklasifikasi
 * salah, dan akibatnya jatuh pada SELURUH antrean, bukan satu chapter.
 */
const statusHttp = (galat) => {
  if (typeof galat?.status === 'number') return galat.status;
  if (typeof galat?.data?.httpStatus === 'number') return galat.data.httpStatus;
  return null;
};

/**
 * @param {unknown} galat
 * @param {boolean} dariSitusSumber jalur mana yang gagal
 */
const pesanGalat = (galat, dariSitusSumber = false) => {
  const status = statusHttp(galat);
  /*
   * Jalur sumber menjelaskan dirinya sendiri, dan itu bukan kemalasan.
   *
   * GalatSumber sudah membawa kalimat yang menyebut host, status, dan apakah
   * yang menolak itu robots.txt atau penjaga bot (lihat jelaskanStatus di
   * sumber/ambil.js). Menimpanya dengan "Server menjawab 403" di sini justru
   * membuang satu-satunya keterangan yang membedakan "situsnya memblokir HP ini"
   * dari "chapternya sudah dihapus" — dan menyebut "server rumah" untuk
   * kegagalan yang sama sekali tidak melibatkannya.
   */
  if (dariSitusSumber) {
    if (galat?.message) return galat.message;
    return status !== null ? `Situs sumber menjawab ${status}` : 'Situs sumber tidak terjangkau';
  }
  if (status === 404) return 'Chapter ini sudah tidak ada di server';
  if (status !== null) return `Server menjawab ${status}`;
  return galat?.message || galat?.error || 'Server rumah tidak terjangkau';
};

/**
 * Kegagalan jaringan atau kegagalan permanen?
 *
 * Bedanya menentukan nasib SELURUH antrean, bukan satu chapter. Keluar jangkauan
 * Wi-Fi membuat tiap permintaan gagal seketika; kalau semuanya dianggap gagal
 * permanen, reducer `gagal` membuang chapternya satu per satu dan sepuluh
 * chapter yang barusan diantrekan lenyap dalam hitungan milidetik — dan karena
 * `mulai` mengosongkan galat tiap putaran, yang terlihat cuma pesan untuk yang
 * terakhir. Sesampainya di rumah tidak ada yang melanjutkan, dan tidak ada cara
 * menebak mana saja yang tadi diantre.
 *
 * RTK Query memakai status berupa STRING untuk kegagalan transport
 * ('FETCH_ERROR'); putus Wi-Fi melempar TypeError tanpa status sama sekali.
 * Yang punya status berupa angka (404, 4xx, 5xx) berarti server rumah menjawab —
 * itu memang masalah chapter itu sendiri.
 *
 * Statusnya dibaca lewat statusHttp, bukan langsung dari galat.status. Dulu
 * bukan: satu halaman yang 404 — berkas gambar yang raib di disk server, atau
 * chapter yang di-"Ganti" sehingga nama berkasnya berubah — dibaca sebagai putus
 * jaringan, chapternya ditinggal di KEPALA antrean, dan satu-satunya yang bisa
 * menyalakan pompa lagi adalah lanjutkanUnduhan() dari efek [terhubung] yang
 * tidak pernah berbunyi karena servernya memang tidak pernah putus. Sepuluh
 * chapter yang barusan diantrekan diam selamanya sementara /offline menulis
 * "menunggu server rumah terjangkau lagi" — padahal servernya menyala dan
 * seluruh aplikasi lain berjalan normal.
 */
const galatJaringan = (galat) => galat !== DIBATALKAN && statusHttp(galat) === null;

const pompa = async () => {
  if (berjalan) return;
  berjalan = true;
  // Penjaga layar dipegang bersama reader. Sakelar plugin-nya satu bit untuk
  // seluruh aplikasi, jadi memanggilnya langsung dari sini akan mematikan
  // penjaga milik pembaca yang sedang membuka chapter sambil menunggu.
  tahanLayar();

  try {
    for (;;) {
      const berikut = store.getState().unduhan.antre[0];
      if (!berikut) break;

      store.dispatch(mulai(berikut));
      pembatalan = { chapterId: berikut.chapterId, batal: false };

      // SATU bidang yang memutuskan seluruh percabangan jalur di berkas ini.
      // Dibaca sekali ke variabel, bukan ditanyakan ulang di setiap tempat yang
      // membutuhkannya: `berikut` berasal dari store dan bisa saja diganti
      // benda lain di tengah await, dan dua pemeriksaan yang menjawab berbeda
      // berarti chapternya diunduh lewat satu jalur lalu galatnya dijelaskan
      // sebagai jalur yang lain.
      const jalurSumber = Boolean(berikut.sumber);

      let tertahan = false;
      try {
        await (jalurSumber
          ? simpanChapterSumber(berikut, {
              saatMaju: (selesai, total) => store.dispatch(maju({ selesai, total })),
              batal: () => pembatalan?.batal === true,
            })
          : simpanChapter(berikut.chapterId, {
              saatMaju: (selesai, total) => store.dispatch(maju({ selesai, total })),
              batal: () => pembatalan?.batal === true,
            }));
        store.dispatch(beres(berikut.chapterId));
      } catch (galat) {
        if (galat === DIBATALKAN) store.dispatch(beres(berikut.chapterId));
        else if (galatJaringan(galat)) {
          // Chapternya dibiarkan di kepala antrean dan putarannya berhenti di
          // sini. Meneruskan hanya membuang seluruh sisa antrean ke kegagalan
          // yang sudah pasti sama — dan menghapus jejak apa saja yang tadi
          // diantre. Dilanjutkan lagi oleh lanjutkanUnduhan() begitu jaringan
          // kembali: server rumah terjangkau, atau — untuk jalur sumber, yang
          // tidak pernah menyentuh server rumah — jaringan HP-nya sendiri
          // tersambung lagi. Keduanya dipicu dari CangkangAndroid.
          tertahan = true;
          store.dispatch(tunda({ chapterId: berikut.chapterId, pesan: pesanGalat(galat, jalurSumber) }));
        } else store.dispatch(gagal({ chapterId: berikut.chapterId, pesan: pesanGalat(galat, jalurSumber) }));
      } finally {
        pembatalan = null;
      }

      if (tertahan) break;
    }
  } finally {
    berjalan = false;
    lepasLayar();
  }
};

export const antrekanChapter = (daftar) => {
  store.dispatch(antrekan(daftar));
  pompa();
};

/**
 * Antrekan chapter yang diambil LANGSUNG dari situs sumber.
 *
 * Bedanya dengan antrekanChapter hanya satu langkah di depan: id lokal tiap
 * chapter harus dialokasikan lebih dulu (siapkanAntrianSumber), karena antrean
 * di unduhanSlice berkunci chapterId — tanpa id, dedup "sudah diantre atau
 * belum" tidak punya apa pun untuk dibandingkan, dan menekan tombolnya dua kali
 * melahirkan dua unduhan untuk chapter yang sama.
 *
 * Alokasinya menulis index.json, jadi fungsi ini async sementara kembarannya
 * tidak. Pemanggilnya menunggu — bukan karena hasilnya dibutuhkan, tapi supaya
 * tombolnya bisa menampilkan "Menyiapkan…" alih-alih tampak tidak bereaksi
 * selama dua puluh lima penulisan berturut-turut.
 *
 * @returns {Promise<Array>} baris antrean yang jadi, untuk dihitung pemanggilnya
 */
export const antrekanChapterSumber = async (spek) => {
  const daftar = await siapkanAntrianSumber(spek);
  if (daftar.length === 0) return daftar;
  store.dispatch(antrekan(daftar));
  pompa();
  return daftar;
};

/**
 * Jalankan lagi antrean yang tertahan karena jaringan.
 *
 * Dipanggil dari CangkangAndroid begitu server rumah terjangkau lagi. Aman
 * dipanggil kapan saja: pompa() sendiri menolak kalau sudah berjalan, dan
 * antrean kosong tidak menyalakan apa pun.
 */
export const lanjutkanUnduhan = () => {
  if (store.getState().unduhan.antre.length > 0) pompa();
};

/**
 * Batalkan satu chapter, baik yang sedang berjalan maupun yang masih menunggu.
 *
 * Berkas yang sudah terunduh sengaja TIDAK dihapus: chapter itu belum masuk
 * katalog jadi tidak terlihat sebagai tersimpan, dan kalau orangnya menekan
 * simpan lagi nanti, yang sudah ada akan dilewati. Membuang berkasnya berarti
 * membuang pekerjaan yang sudah dibayar kuotanya.
 */
export const batalkanUnduhan = (chapterId) => {
  if (pembatalan?.chapterId === chapterId) pembatalan.batal = true;
  else {
    store.dispatch(buangSatu(chapterId));
    // Yang barusan dibuang bisa saja KEPALA antrean yang sedang tertahan, dan
    // pompa() sudah berhenti sejak `tunda` menyimpannya di sana. Tanpa panggilan
    // ini, membuang chapter yang macet tidak menjalankan sisanya: sembilan
    // chapter di belakangnya tetap diam sampai jaringan kebetulan terlihat putus
    // lalu tersambung lagi.
    pompa();
  }
};

export const kosongkanAntrean = () => {
  if (pembatalan) pembatalan.batal = true;
  store.dispatch(kosongkan());
};
