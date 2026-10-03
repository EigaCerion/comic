import { useEffect, useSyncExternalStore } from 'react';
import { ASLI_NATIF, IS_APP } from './index.js';

/**
 * Cek pembaruan aplikasi lewat halaman rilis GitHub.
 *
 * APK-nya dibagikan sebagai berkas di https://github.com/EigaCerion/comic/releases
 * dan dipasang dengan sideload. Artinya tidak ada Play Store yang memberi tahu
 * siapa pun bahwa ada versi baru: tanpa berkas ini, satu-satunya cara orang tahu
 * adalah kalau pemiliknya mengabari satu per satu. Yang dikerjakan di sini cuma
 * MEMBERITAHU dan membuka tautan unduhannya; pemasangannya tetap dikerjakan
 * Android.
 *
 * Seluruh berkas ini hanya hidup di build android. Di bundel web ia tidak
 * pernah ikut: pemanggilnya ada di balik `IS_APP`, dan plugin Capacitor hanya
 * disentuh lewat import() di dalam cabang yang sudah runtuh jadi `false`.
 */

/*
 * Repositorinya ditulis sebagai dua potong, bukan satu URL panjang, karena
 * dipakai dua kali dengan arti berbeda: alamat API yang DIMINTA, dan awalan
 * jalur yang WAJIB dipenuhi URL unduhan yang dijawab. Menyalin nama repo ke dua
 * tempat berarti suatu hari yang satu berubah dan yang lain diam-diam tidak.
 */
const PEMILIK = 'EigaCerion';
const REPO = 'comic';
const URL_RILIS = `https://api.github.com/repos/${PEMILIK}/${REPO}/releases/latest`;
const AWALAN_UNDUH = `/${PEMILIK}/${REPO}/releases/download/`.toLowerCase();

/**
 * Kunci Preferences. Bernama lengkap dengan awalan "naruread:" seperti tetangga
 * sebelahnya (naruread:alamat-server, naruread:token-sesi, naruread:posisi-baca)
 * — penyimpanan ini satu ruang nama untuk seluruh aplikasi.
 */
export const KUNCI_PEMBARUAN = 'naruread:pembaruan';
export const KUNCI_ABAIKAN = 'naruread:pembaruan-diabaikan';
/*
 * Versi yang unduhannya SUDAH pernah dibuka di browser.
 *
 * Kunci tersendiri, bukan satu bidang di dalam KUNCI_PEMBARUAN, karena
 * tulisSimpanan() menimpa seluruh isi kunci itu setiap kali pemeriksaan
 * berhasil — sama persis dengan alasan KUNCI_ABAIKAN berdiri sendiri.
 *
 * Yang disimpan nomor versinya, bukan bendera: petunjuk pemasangan harus
 * kembali hilang begitu ada rilis yang lebih baru lagi.
 */
export const KUNCI_UNDUH = 'naruread:pembaruan-diunduh';

/**
 * Nomor pekerjaan DownloadManager yang sedang dilacak, beserta versinya.
 *
 * Kunci TERSENDIRI, bukan menumpang KUNCI_UNDUH: nilai di sana sudah terlanjur
 * berupa nomor versi apa adanya di pemasangan yang ada sekarang, dan mengubah
 * bentuknya berarti aplikasi lama membaca JSON sebagai nomor versi.
 */
export const KUNCI_UNDUHAN = 'naruread:pembaruan-unduhan';

const SEHARI_MS = 24 * 60 * 60 * 1000;

/**
 * Batas waktu permintaan sendiri, bukan menunggu jaringan menyerah.
 *
 * Alasannya sama seperti di terhubung.js: HP yang terhubung Wi-Fi tanpa
 * internet (hotspot captive, atau router yang gatewaynya mati) tidak menolak
 * koneksi — paketnya hilang dan permintaannya menggantung sampai batas waktu
 * TCP. Tombol "Cek pembaruan" yang berputar setengah menit terbaca sebagai
 * aplikasi macet.
 */
const BATAS_AMBIL_MS = 10000;

/** Catatan rilis dipotong: isinya teks bebas dari internet, bukan tata letak. */
const BATAS_CATATAN = 1200;

/*
 * Versi yang ikut dibundel saat `vite build --mode android` berjalan, disuntik
 * vite.config.js dari apps/web/package.json — sumber kebenaran yang SAMA dengan
 * yang dipakai build-android.ps1 untuk menyetel versionName APK. Dipakai hanya
 * sebagai cadangan kalau App.getInfo() tidak bisa dipanggil (build android yang
 * dibuka di browser desktop; plugin @capacitor/app melempar "Not implemented on
 * web" di sana). typeof dipakai supaya berkas ini tidak meledak kalau suatu
 * saat dibundel tanpa define itu. Namanya didaftarkan sebagai global di
 * .eslintrc.json — ia memang tidak pernah dideklarasikan di mana pun dalam
 * kode, karena vite.config.js yang menggantinya jadi literal saat build.
 */
const VERSI_BUNDEL = typeof __VERSI_APL__ === 'string' ? __VERSI_APL__ : null;

/* ── Versi ──────────────────────────────────────────────────────────── */

/**
 * Hanya major.minor.patch, dengan "v" di depan boleh ada.
 *
 * Sengaja ketat. Yang masuk ke sini datang dari internet (nama berkas dan
 * tag di jawaban GitHub), dan satu-satunya bentuk yang benar-benar dihasilkan
 * build-android.ps1 adalah tiga angka. Bentuk lain lebih baik dianggap "tidak
 * tahu" daripada ditebak — menebak salah berarti memberi tahu orang ada
 * pembaruan yang tidak ada.
 */
const POLA_VERSI = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/;

export const uraiVersi = (teks) => {
  const cocok = POLA_VERSI.exec(String(teks ?? '').trim());
  if (!cocok) return null;
  return [Number(cocok[1]), Number(cocok[2]), Number(cocok[3])];
};

/**
 * Bandingkan dua versi ANGKA PER ANGKA, bukan sebagai teks.
 *
 * Perbandingan teks adalah jebakan yang pasti datang: '0.10.0' < '0.9.0' kalau
 * dibandingkan sebagai string, jadi rilis kesepuluh justru terbaca lebih tua
 * daripada yang kesembilan dan tidak seorang pun diberi tahu.
 *
 * @returns {number|null} 1 kalau a lebih baru, -1 kalau lebih tua, 0 kalau
 *   sama, dan null kalau salah satunya tidak terbaca — null berarti "tidak
 *   tahu", dan pemanggilnya WAJIB diam, bukan menebak.
 */
export const bandingVersi = (a, b) => {
  const kiri = uraiVersi(a);
  const kanan = uraiVersi(b);
  if (!kiri || !kanan) return null;
  for (let i = 0; i < 3; i += 1) {
    if (kiri[i] !== kanan[i]) return kiri[i] > kanan[i] ? 1 : -1;
  }
  return 0;
};

/* ── Membaca jawaban GitHub ─────────────────────────────────────────── */

/**
 * URL unduhan berasal dari JSON milik orang lain, jadi diperiksa sebelum
 * ditawarkan.
 *
 * Yang dibuka tombol "Unduh" adalah intent Android: apa pun yang ada di sana
 * akan dijalankan penanganan bawaan sistem. Jawaban GitHub hari ini memang
 * selalu https://github.com/<pemilik>/<repo>/releases/download/…, tapi yang
 * membuat itu aman bukan kebiasaannya — melainkan pemeriksaan ini. Akun yang
 * dibajak, proxy yang menyuntik, atau sekadar repo yang salah ketik cukup untuk
 * mengubah tombol ini menjadi pemasang APK dari mana saja.
 */
const urlUnduhAman = (mentah) => {
  let url;
  try {
    url = new URL(String(mentah ?? ''));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.hostname.toLowerCase() !== 'github.com') return null;
  if (!url.pathname.toLowerCase().startsWith(AWALAN_UNDUH)) return null;
  return url.toString();
};

/**
 * Nama berkas yang aman dipakai sebagai nama berkas di folder Download.
 *
 * Diperiksa dengan disiplin yang sama seperti urlUnduhAman: nilainya berasal
 * dari jawaban JSON milik GitHub ATAU dari Preferences yang bisa disunting di
 * perangkat yang di-root, dan ia diteruskan ke DownloadManager sebagai nama
 * berkas. Pemeriksaan kembarannya ada di UnduhSistem.java — pemeriksaan yang
 * hanya hidup di satu lapisan bukan pemeriksaan.
 */
const namaBerkasAman = (mentah) => {
  const nama = String(mentah ?? '').trim();
  if (!nama || nama.length > 120) return null;
  if (nama.includes('/') || nama.includes('\\') || nama.includes('..')) return null;
  return POLA_ASET.test(nama) ? nama : null;
};

/**
 * Nama berkas aset: NaruReader-<versi>.apk
 *
 * INILAH sumber versi yang bisa dipercaya di repositori ini, bukan tag-nya.
 * Pemiliknya mengunggah APK baru ke tag TETAP bernama "APK" — tag yang sama
 * dipakai ulang tiap rilis — dan nama rilisnya teks bebas ("NaruReader-apk").
 * Satu-satunya bidang yang berubah bersama binernya adalah nama berkas aset,
 * karena build-android.ps1 yang menuliskannya langsung dari package.json. Kalau
 * versi dibaca dari tag, setiap unggahan berikutnya tetap terbaca "APK" dan
 * tidak ada pembaruan yang pernah terdeteksi.
 */
const POLA_ASET = /^NaruReader-(\d{1,6}\.\d{1,6}\.\d{1,6})\.apk$/i;

const asetTerbaru = (rilis) => {
  const daftar = Array.isArray(rilis?.assets) ? rilis.assets : [];
  let terbaik = null;
  for (const aset of daftar) {
    const cocok = POLA_ASET.exec(String(aset?.name ?? '').trim());
    if (!cocok) continue;
    const url = urlUnduhAman(aset?.browser_download_url);
    if (!url) continue;
    // Satu rilis boleh memuat beberapa APK (unggahan lama yang belum dibuang).
    // Yang dipakai versi tertingginya, bukan yang pertama ditemukan: urutan
    // assets di jawaban GitHub adalah urutan unggah, bukan urutan versi.
    if (!terbaik || bandingVersi(cocok[1], terbaik.versi) === 1) {
      // ukuran dipakai untuk MEMBUKTIKAN unduhannya utuh, bukan sekadar hiasan
      // di layar. Unduhan yang terputus lalu dilanjutkan bisa menghasilkan
      // berkas yang panjangnya tepat tapi isinya rusak; yang tidak pernah bisa
      // adalah panjang yang MELESET. Jadi ukuran yang tidak cocok sudah pasti
      // berkas rusak, dan itu yang ditahan sebelum orangnya diminta memasang.
      const ukuran = Number(aset?.size);
      terbaik = { versi: cocok[1], url, nama: aset.name, ukuran: Number.isFinite(ukuran) && ukuran > 0 ? ukuran : 0 };
    }
  }
  return terbaik;
};

/**
 * Peras jawaban GitHub jadi bentuk yang dipakai aplikasi, atau null.
 *
 * null berarti "jawabannya ada tapi tidak bisa dipakai" — dan pemanggilnya
 * memperlakukan itu persis seperti kegagalan jaringan: jawaban tersimpan yang
 * lama dipertahankan, tidak ada yang diubah jadi "sudah versi terbaru".
 */
const bacaRilis = (rilis) => {
  if (!rilis || typeof rilis !== 'object') return null;
  // /releases/latest memang sudah melewatkan draft dan pra-rilis, tetapi ini
  // JSON dari internet: kalau bidangnya ada dan bernilai true, dipatuhi.
  if (rilis.draft === true || rilis.prerelease === true) return null;

  const aset = asetTerbaru(rilis);

  // Tag hanya dipakai kalau tidak ada aset yang namanya berbentuk versi DAN
  // tagnya sendiri terbaca sebagai versi. Di repo ini tagnya "APK", jadi jalur
  // ini tidak pernah terpakai sekarang — ia ada untuk hari ketika pemiliknya
  // beralih ke tag bernomor (v0.2.0) dan lupa menamai asetnya.
  const versi = aset?.versi ?? (uraiVersi(rilis.tag_name) ? String(rilis.tag_name).trim().replace(/^v/, '') : null);
  if (!versi) return null;

  const catatan = typeof rilis.body === 'string' ? rilis.body.trim() : '';

  return {
    versi,
    urlUnduh: aset?.url ?? null,
    namaBerkas: aset?.nama ?? null,
    ukuranUnduh: aset?.ukuran ?? 0,
    nama: typeof rilis.name === 'string' ? rilis.name.trim().slice(0, 120) : null,
    catatan: catatan ? catatan.slice(0, BATAS_CATATAN) : null,
  };
};

/* ── Jaringan ───────────────────────────────────────────────────────── */

const KEPALA = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

/**
 * Ambil jawaban GitHub — lewat CapacitorHttp di perangkat, fetch di browser.
 *
 * CapacitorHttp dipakai di perangkat karena permintaannya berjalan di lapisan
 * native, di luar WebView: tidak ada urusan CORS, dan tidak terpengaruh
 * androidScheme http yang dipakai aplikasi ini untuk bicara ke server rumah —
 * permintaan https dari halaman http adalah persis kelas hal yang WebView suka
 * hentikan diam-diam. Di browser desktop (tempat build android diuji) plugin
 * itu tidak punya lapisan native, jadi di sana fetch biasa; api.github.com
 * memang mengizinkan CORS.
 */
const ambilRilis = async () => {
  if (ASLI_NATIF) {
    const { CapacitorHttp } = await import('@capacitor/core');
    const jawab = await CapacitorHttp.get({
      url: URL_RILIS,
      headers: KEPALA,
      connectTimeout: BATAS_AMBIL_MS,
      readTimeout: BATAS_AMBIL_MS,
      responseType: 'json',
    });
    // CapacitorHttp TIDAK melempar untuk status non-2xx: 403 (batas laju GitHub,
    // 60 permintaan per jam per IP) sampai ke sini sebagai jawaban biasa yang
    // isinya pesan galat. Tanpa baris ini, `data`-nya masuk ke bacaRilis, di sana
    // jadi null, dan hasilnya tidak bisa dibedakan dari "tidak ada versi baru".
    if (jawab?.status !== 200) throw new Error(`GitHub menjawab ${jawab?.status ?? '?'}`);
    const isi = jawab.data;
    // Android mengurai sendiri badan application/json jadi objek, tetapi
    // responseType lain (dan iOS) mengembalikannya sebagai teks. Dua-duanya
    // diterima supaya tidak ada perangkat yang gagal karena bentuk pembungkus.
    if (typeof isi === 'string') return JSON.parse(isi);
    if (isi && typeof isi === 'object') return isi;
    throw new Error('Jawaban GitHub tidak dikenali');
  }

  const kendali = new AbortController();
  const jam = setTimeout(() => kendali.abort(), BATAS_AMBIL_MS);
  try {
    const res = await fetch(URL_RILIS, { headers: KEPALA, cache: 'no-store', signal: kendali.signal });
    if (!res.ok) throw new Error(`GitHub menjawab ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(jam);
  }
};

/* ── Penyimpanan ────────────────────────────────────────────────────── */

/*
 * Plugin Capacitor adalah Proxy yang menerjemahkan setiap akses properti jadi
 * panggilan plugin, `.then` sekalipun — mengembalikannya langsung dari fungsi
 * async menghasilkan promise yang tidak pernah selesai. Sudah menggigit sekali
 * di platform/server.js, jadi di sini pun proxy-nya dipindahkan ke objek biasa
 * lebih dulu.
 */
let modulPrefs = null;
const prefs = async () => {
  if (!modulPrefs) modulPrefs = await import('@capacitor/preferences');
  return { Preferences: modulPrefs.Preferences };
};

const bacaSimpanan = async () => {
  try {
    const { Preferences } = await prefs();
    const [tersimpan, diabaikan, unduhDimulai] = await Promise.all([
      Preferences.get({ key: KUNCI_PEMBARUAN }),
      Preferences.get({ key: KUNCI_ABAIKAN }),
      Preferences.get({ key: KUNCI_UNDUH }),
    ]);
    let isi = null;
    if (tersimpan.value) {
      const urai = JSON.parse(tersimpan.value);
      if (urai && typeof urai === 'object') isi = urai;
    }
    return { isi, diabaikan: diabaikan.value || null, unduhDimulai: unduhDimulai.value || null };
  } catch {
    // Penyimpanan tidak terbaca (browser mode privat saat menguji build android
    // di laptop, atau JSON lama yang bentuknya sudah berubah). Bukan alasan
    // untuk tidak memeriksa: paling buruk pemeriksaannya dianggap belum pernah.
    return { isi: null, diabaikan: null, unduhDimulai: null };
  }
};

const tulisSimpanan = async (isi) => {
  try {
    const { Preferences } = await prefs();
    await Preferences.set({ key: KUNCI_PEMBARUAN, value: JSON.stringify(isi) });
  } catch {
    /* gagal menulis hanya berarti hasilnya tidak bertahan sampai aplikasi dibuka lagi */
  }
};

/**
 * Catat WAKTU PERCOBAAN saja, tanpa menyentuh jawaban tersimpan.
 *
 * Dibaca-lalu-ditulis, bukan menulis objek baru berisi dicobaPada saja.
 * Kegagalan bisa tiba SEBELUM jawaban tersimpan selesai dimuat ke memori:
 * pembacaan Preferences pernah menggantung detik-detikan di WebView, dan tombol
 * "Cek pembaruan" justru ada di layar yang memicu pemuatan itu. Pada saat itu
 * keadaan di memori masih kosong, jadi menulis dari memori akan MENGHAPUS
 * jawaban terakhir yang berhasil — tepat hal yang seluruh berkas ini berjanji
 * tidak dilakukan saat permintaan gagal.
 */
const catatPercobaan = async (sekarang) => {
  try {
    const { Preferences } = await prefs();
    const tersimpan = await Preferences.get({ key: KUNCI_PEMBARUAN });
    let isi = {};
    if (tersimpan.value) {
      const urai = JSON.parse(tersimpan.value);
      if (urai && typeof urai === 'object') isi = urai;
    }
    await Preferences.set({ key: KUNCI_PEMBARUAN, value: JSON.stringify({ ...isi, dicobaPada: sekarang }) });
  } catch {
    /* idem: paling buruk jedanya dihitung dari nol lagi saat aplikasi dibuka lagi */
  }
};

/* ── Keadaan bersama ────────────────────────────────────────────────── */

/*
 * Satu keadaan untuk seluruh aplikasi, bukan state per komponen: kartu di
 * Pengaturan dan kabar di bawah TopBar menampilkan jawaban yang sama, dan dua
 * useState terpisah berarti menekan "Cek pembaruan" di Pengaturan tidak pernah
 * memperbarui kabarnya. Polanya dipinjam dari terhubung.js.
 */
const keadaanAwal = {
  versiTerpasang: null,
  versiRilis: null,
  urlUnduh: null,
  /** Nama berkas aset, dipakai sebagai nama berkas unduhan di folder Download. */
  namaBerkas: null,
  /** Ukuran aset menurut GitHub; 0 berarti tidak diketahui. */
  ukuranUnduh: 0,
  namaRilis: null,
  catatan: null,
  /** Kapan pemeriksaan terakhir BERHASIL (ms epoch). */
  diperiksaPada: null,
  /** Kapan pemeriksaan terakhir DICOBA, berhasil atau tidak (ms epoch). */
  dicobaPada: null,
  sedangMemeriksa: false,
  galat: null,
  diabaikan: null,
  /** Versi yang unduhannya sudah dimulai, atau null. */
  unduhDimulai: null,

  /*
   * Unduhan sistem (DownloadManager).
   *
   * Dipisah dari unduhDimulai karena keduanya menjawab pertanyaan berbeda:
   * unduhDimulai bertahan di Preferences dan berarti "orang ini sudah menekan
   * Unduh untuk versi itu", sementara bidang di bawah adalah keadaan SAAT INI
   * dari satu pekerjaan unduh yang sedang berjalan — hidup selama id-nya masih
   * dikenali DownloadManager, termasuk sesudah aplikasi ditutup dan dibuka lagi.
   */
  /*
   * Galat UNDUHAN dipisah dari galat PEMERIKSAAN.
   *
   * Keduanya pernah menumpang satu bidang, dan hasilnya kalimat yang salah:
   * kotak galat pemeriksaan berbunyi "angka di atas adalah hasil pemeriksaan
   * terakhir yang berhasil" — benar untuk GitHub yang tak terjangkau, tapi tidak
   * masuk akal untuk berkas unduhan yang ukurannya tidak cocok.
   */
  galatUnduh: null,
  /** id DownloadManager, atau null kalau tidak ada unduhan yang dilacak. */
  unduhanId: null,
  /** "menunggu" | "berjalan" | "jeda" | "selesai" | "gagal" | "hilang" | "rusak" */
  unduhanKeadaan: null,
  unduhanTerunduh: 0,
  unduhanTotal: 0,
  /** Terisi hanya kalau unduhannya selesai DAN ukurannya cocok. */
  unduhanBerkas: null,
};

let keadaan = keadaanAwal;
const pendengar = new Set();

const siarkan = (perubahan) => {
  keadaan = { ...keadaan, ...perubahan };
  pendengar.forEach((beri) => beri());
};

const langgan = (beri) => {
  pendengar.add(beri);
  return () => pendengar.delete(beri);
};

const bacaKeadaan = () => keadaan;

/**
 * Petikan keadaan tanpa React, seperti alamatServer() di server.js.
 *
 * Dipakai untuk memeriksa perilaku berkas ini dari luar komponen — dan itu
 * bukan kemewahan: hampir seluruh yang penting di sini (batas 24 jam, kegagalan
 * yang TIDAK boleh jadi "sudah terbaru") hanya terlihat dari keadaan sesudah
 * beberapa panggilan berurutan, bukan dari satu nilai kembalian.
 */
export const bacaPembaruan = () => keadaan;

/**
 * Versi yang sedang terpasang.
 *
 * App.getInfo() adalah jawaban yang benar di perangkat: ia membaca versionName
 * dari APK yang BENAR-BENAR terpasang, bukan dari bundel di dalamnya. Di
 * browser desktop plugin itu melempar "Not implemented on web", jadi di sana
 * dipakai versi yang disuntik saat build — keduanya berasal dari
 * apps/web/package.json yang sama, jadi tidak ada versi yang dikarang.
 *
 * null berarti tidak tahu, dan tidak tahu berarti tidak pernah mengganggu.
 */
const bacaVersiTerpasang = async () => {
  if (ASLI_NATIF) {
    try {
      const { App } = await import('@capacitor/app');
      const info = await App.getInfo();
      if (uraiVersi(info?.version)) return String(info.version).trim();
    } catch {
      /* plugin tidak ada di perangkat ini — jatuh ke versi bundel di bawah */
    }
  }
  return uraiVersi(VERSI_BUNDEL) ? VERSI_BUNDEL : null;
};

/* ── Pemeriksaan ────────────────────────────────────────────────────── */

let berjalan = null;

const jalankanCek = () => {
  // Dua pemicu hampir bersamaan (kartu Pengaturan dibuka tepat saat pemeriksaan
  // otomatis jalan) harus menunggu permintaan yang sama, bukan menembak GitHub
  // dua kali — batas lajunya dihitung per IP.
  if (berjalan) return berjalan;

  siarkan({ sedangMemeriksa: true, galat: null });

  berjalan = (async () => {
    const sekarang = Date.now();
    try {
      const hasil = bacaRilis(await ambilRilis());
      if (!hasil) throw new Error('Rilis terbaru belum punya berkas APK yang dikenali');

      const isi = {
        versiRilis: hasil.versi,
        urlUnduh: hasil.urlUnduh,
        namaBerkas: hasil.namaBerkas,
        ukuranUnduh: hasil.ukuranUnduh,
        namaRilis: hasil.nama,
        catatan: hasil.catatan,
        diperiksaPada: sekarang,
      };
      siarkan({ ...isi, dicobaPada: sekarang, sedangMemeriksa: false, galat: null });
      await tulisSimpanan({ ...isi, dicobaPada: sekarang });
      return true;
    } catch (galat) {
      /*
       * Kegagalan TIDAK menghapus jawaban tersimpan dan TIDAK pernah berarti
       * "sudah versi terbaru".
       *
       * Ini inti berkas ini. HP yang sedang tanpa internet, GitHub yang menolak
       * dengan 403 karena batas laju sudah habis, dan jawaban yang bentuknya
       * berubah semuanya mendarat di sini. Kalau kegagalan itu ditulis sebagai
       * "tidak ada versi baru", orang yang tiap hari membuka aplikasi tanpa
       * sinyal akan selamanya diberi tahu bahwa aplikasinya mutakhir.
       *
       * Yang diperbarui hanya dicobaPada — supaya pemeriksaan otomatis tidak
       * mencoba lagi pada pembukaan berikutnya dan menghabiskan kuota batas laju
       * untuk kegagalan yang sama.
       */
      siarkan({ dicobaPada: sekarang, sedangMemeriksa: false, galat: galat?.message || 'Gagal menghubungi GitHub' });
      await catatPercobaan(sekarang);
      return false;
    } finally {
      berjalan = null;
    }
  })();

  return berjalan;
};

/** Tombol "Cek pembaruan": abaikan jeda 24 jam, orangnya memang sedang menunggu. */
export const cekPembaruan = () => {
  if (!IS_APP) return Promise.resolve(false);
  return jalankanCek();
};

/**
 * Pemeriksaan otomatis, lewat gerbang 24 jam.
 *
 * Jedanya dihitung dari percobaan terakhir, bukan dari keberhasilan terakhir.
 * Kalau dihitung dari keberhasilan, HP yang berbulan-bulan jarang online akan
 * menembak GitHub setiap kali aplikasi dibuka — dan justru di jaringan buruk
 * itulah permintaannya paling sering gagal.
 *
 * Fungsi tersendiri, bukan beberapa baris di dalam penyiapan, justru supaya ia
 * bisa dipanggil BERULANG: lihat pasangPemicuResume di bawah.
 */
const cekKalauSudahLewatSehari = () => {
  // Jam perangkat bisa mundur (zona waktu diganti, jam disetel ulang). Selisih
  // negatif berarti catatannya tidak masuk akal, jadi diperlakukan sebagai
  // "belum pernah" alih-alih memblokir pemeriksaan selamanya.
  const selisih = keadaan.dicobaPada === null ? Infinity : Date.now() - keadaan.dicobaPada;
  if (selisih >= SEHARI_MS || selisih < 0) return jalankanCek();
  return Promise.resolve(false);
};

let pemicuResume = false;

/**
 * Periksa lagi setiap kali aplikasi kembali ke depan.
 *
 * Tanpa ini gerbang 24 jam hanya pernah dihitung SEKALI per konteks JS, karena
 * penyiapan di bawah dimemoisasi dan tidak pernah dijalankan ulang. Proses
 * WebView Android bertahan melewati tombol Home berhari-hari, jadi HP yang
 * aplikasinya selalu tinggal di daftar aplikasi terakhir berhenti memeriksa
 * sama sekali sampai Android kebetulan membunuh prosesnya — sementara kartu
 * Pengaturan menjanjikan "diperiksa otomatis paling sering sekali sehari", dan
 * rilis berikutnya lewat tanpa seorang pun diberi tahu. Itu persis kegagalan
 * yang seluruh berkas ini dibangun untuk mencegah.
 *
 * appStateChange, dan sengaja TIDAK di balik ASLI_NATIF: sama seperti
 * pantauKoneksi di terhubung.js, kejadian itu punya padanan di browser desktop
 * (visibilitychange), jadi build android yang diuji di laptop ikut mendapat
 * pemicunya. Pendengarnya tidak pernah dilepas — pemanggilnya hidup selama
 * prosesnya hidup, dan melepas-pasang justru berisiko kehilangan kejadian
 * resume yang tiba di sela-selanya.
 *
 * Aman dipanggil beruntun: `berjalan` menahan permintaan ganda, dan dicobaPada
 * menahan kuota batas laju GitHub.
 */
const pasangPemicuResume = async () => {
  if (pemicuResume) return;
  pemicuResume = true;
  try {
    const { App } = await import('@capacitor/app');
    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) cekKalauSudahLewatSehari();
    });
  } catch {
    /* plugin tidak ada di perangkat ini — tombol "Cek pembaruan" tetap jalan */
  }
};

let penyiapan = null;

/**
 * Muat jawaban tersimpan, lalu pasang pemicu pemeriksaan otomatisnya.
 *
 * Gerbang 24 jam-nya ada di cekKalauSudahLewatSehari; di sini ia dipanggil
 * sekali untuk pembukaan ini, dan pasangPemicuResume yang mengurus pembukaan
 * berikutnya.
 */
export const siapkanPembaruan = () => {
  if (!IS_APP) return Promise.resolve();
  if (penyiapan) return penyiapan;

  penyiapan = (async () => {
    /*
     * versiTerpasang disiarkan SENDIRI, tidak ditunggu bersama penyimpanan.
     *
     * Angkanya datang instan dari App.getInfo(), sedangkan bacaSimpanan()
     * membaca Preferences — pembacaan yang pernah menggantung detik-detikan di
     * WebView (lihat catatPercobaan di atas) dan tidak punya batas waktu apa
     * pun. Dulu keduanya satu Promise.all, jadi versi yang sudah bisa diketahui
     * ikut disandera pembacaan yang lambat itu: selama jendela itu kartu
     * Pengaturan tidak tahu versi mana yang terpasang, dan pembandingnya
     * (bandingVersi) mengembalikan null — "tidak tahu", yang di layar dulu
     * terbaca sebagai "sudah versi terbaru". Kalau pembacaan Preferences tidak
     * pernah selesai, jendela itu permanen untuk sesi ini: penyiapan ini
     * dimemoisasi dan tidak pernah dicoba ulang.
     *
     * Tidak di-await dan tidak perlu .catch: bacaVersiTerpasang() sudah menelan
     * galatnya sendiri dan paling buruk menjawab null.
     */
    bacaVersiTerpasang().then((versi) => siarkan({ versiTerpasang: versi }));

    const { isi, diabaikan, unduhDimulai } = await bacaSimpanan();

    /*
     * Jawaban TERSIMPAN tidak boleh menimpa jawaban yang BARU didapat.
     *
     * Dua pembacaan di atas bisa memakan waktu (Preferences pernah menggantung
     * detik-detikan di WebView — lihat platform/server.js), dan tombol "Cek
     * pembaruan" ada di layar yang sama yang memicu penyiapan ini. Kalau
     * pemeriksaan paksa itu selesai lebih dulu, menulis isi penyimpanan apa
     * adanya di sini akan mengembalikan tampilan ke versi lama — atau ke kosong
     * — persis setelah orangnya melihat hasil yang benar.
     */
    const belumAdaJawaban = keadaan.diperiksaPada === null;

    /*
     * dicobaPada selalu yang TERBARU di antara keduanya, tidak ikut aturan di
     * atas. Kalau pemeriksaan paksa itu GAGAL, diperiksaPada masih null — jadi
     * blok di bawah tetap memuat jawaban lama, itu memang yang diinginkan — tapi
     * dicobaPada dari penyimpanan bisa berumur berhari-hari. Menulisnya di sini
     * membuat jeda 24 jam terbaca lewat, dan pemeriksaan otomatis langsung
     * menembak GitHub sekali lagi untuk kegagalan yang baru saja terjadi.
     */
    const dicoba = Math.max(keadaan.dicobaPada ?? 0, Number.isFinite(isi?.dicobaPada) ? isi.dicobaPada : 0) || null;

    siarkan({
      dicobaPada: dicoba,
      // Sama untuk "Nanti" yang barusan ditekan: yang ada di memori lebih baru.
      diabaikan: keadaan.diabaikan ?? diabaikan,
      // Idem untuk tombol "Unduh": penyiapan ini bisa selesai SESUDAH orangnya
      // menekannya, dan menimpa dengan nilai lama akan menghapus petunjuk
      // pemasangan tepat setelah ia muncul.
      unduhDimulai: keadaan.unduhDimulai ?? unduhDimulai,
      ...(belumAdaJawaban
        ? {
            versiRilis: typeof isi?.versiRilis === 'string' ? isi.versiRilis : null,
            // URL tersimpan diperiksa ULANG, bukan dipercaya karena sudah pernah
            // lolos: penyimpanan aplikasi bisa disunting di perangkat yang
            // di-root, dan pemeriksaan yang hanya berlaku sekali bukan
            // pemeriksaan.
            urlUnduh: urlUnduhAman(isi?.urlUnduh),
            namaBerkas: namaBerkasAman(isi?.namaBerkas),
            ukuranUnduh: Number.isFinite(isi?.ukuranUnduh) && isi.ukuranUnduh > 0 ? isi.ukuranUnduh : 0,
            namaRilis: typeof isi?.namaRilis === 'string' ? isi.namaRilis : null,
            catatan: typeof isi?.catatan === 'string' ? isi.catatan : null,
            diperiksaPada: Number.isFinite(isi?.diperiksaPada) ? isi.diperiksaPada : null,
          }
        : {}),
    });

    // Pemicu resume dipasang LEBIH DULU: pemeriksaan di bawah bisa memakan
    // sepuluh detik penuh (batas waktu permintaan), dan aplikasi yang berpindah
    // ke belakang lalu kembali di sela itu tidak boleh melewatkan pemicunya.
    await lanjutkanPemantauan();
    await pasangPemicuResume();
    await cekKalauSudahLewatSehari();
  })();

  return penyiapan;
};

/* ── Unduhan ────────────────────────────────────────────────────────── */

/**
 * Batas waktu untuk SETIAP panggilan plugin dari berkas ini.
 *
 * Alasannya bukan kehati-hatian umum, melainkan satu bug yang sudah pernah
 * terjadi dan memakan waktu lama untuk ditemukan: proxy plugin Capacitor
 * menjawab setiap akses properti dengan fungsi, termasuk `.then`, sehingga
 * mengembalikannya dari fungsi async membuat JavaScript memanggil `.then()`
 * sebagai metode plugin. Panggilan itu ditolak di rantai promise TERSENDIRI,
 * dan `await`-nya menggantung selamanya — tanpa galat, tanpa jejak, tanpa satu
 * pun perubahan di layar. Yang terlihat orang: tombol Unduh yang ditekan dan
 * tidak melakukan apa-apa.
 *
 * Penyebab itu sudah diperbaiki di bukaLuar.js dan unduhSistem.js. Batas waktu
 * ini menjaga agar BENTUK kegagalan seperti itu — apa pun sebabnya nanti —
 * selalu berakhir sebagai kalimat yang terbaca, bukan sebagai diam.
 */
const BATAS_PLUGIN_MS = 8000;

const dalamBatas = (janji, pekerjaan) =>
  Promise.race([
    janji,
    new Promise((_, tolak) =>
      setTimeout(() => tolak(new Error(`${pekerjaan} tidak menjawab dalam ${BATAS_PLUGIN_MS / 1000} detik`)), BATAS_PLUGIN_MS),
    ),
  ]);

const simpanPenandaUnduh = async (versi, id) => {
  try {
    const { Preferences } = await prefs();
    if (versi) await Preferences.set({ key: KUNCI_UNDUH, value: versi });
    else await Preferences.remove({ key: KUNCI_UNDUH });

    if (id != null && versi) await Preferences.set({ key: KUNCI_UNDUHAN, value: JSON.stringify({ versi, id }) });
    else await Preferences.remove({ key: KUNCI_UNDUHAN });
  } catch {
    /* tidak bertahan sampai aplikasi dibuka lagi; sesi ini tetap ingat */
  }
};

/*
 * Pemantauan unduhan.
 *
 * Satu pemantau saja yang boleh hidup: tombol boleh ditekan berkali-kali, dan
 * dua gelung yang menanyai DownloadManager untuk id yang sama hanya menggandakan
 * pekerjaan sambil saling menimpa hasilnya.
 */
let pemantau = null;

const JEDA_PANTAU_MS = 1200;

const pantauUnduhan = (id) => {
  if (pemantau) clearTimeout(pemantau);

  const putaran = async () => {
    pemantau = null;
    if (keadaan.unduhanId !== id) return; // sudah dibatalkan atau diganti

    let status;
    try {
      const { statusUnduhan } = await import('./unduhSistem.js');
      status = await dalamBatas(statusUnduhan(id), 'Membaca keadaan unduhan');
    } catch (galat) {
      siarkan({ unduhanKeadaan: 'gagal', galatUnduh: galat?.message || 'Keadaan unduhan tidak terbaca' });
      return;
    }

    if (keadaan.unduhanId !== id) return;

    if (status.keadaan === 'selesai') {
      /*
       * Ukuran diperiksa SEBELUM orangnya diminta memasang.
       *
       * Ini bukan kehati-hatian teoretis: berkas yang panjangnya tepat tetapi
       * isinya rusak sudah pernah terjadi di HP penguji, dan pemasang Android
       * menolaknya dengan "paket tampaknya tidak valid" — kalimat yang menunjuk
       * ke APK-nya, bukan ke unduhannya. Panjang yang MELESET sudah pasti
       * berkas yang tidak utuh, dan itu yang bisa ditangkap di sini.
       */
      const diharapkan = keadaan.ukuranUnduh;
      const rusak = diharapkan > 0 && status.terunduh > 0 && status.terunduh !== diharapkan;
      siarkan({
        unduhanKeadaan: rusak ? 'rusak' : 'selesai',
        unduhanTerunduh: status.terunduh,
        unduhanTotal: status.total || diharapkan,
        unduhanBerkas: rusak ? null : status.berkas,
        galatUnduh: rusak
          ? `Berkas yang terunduh ${status.terunduh.toLocaleString('id-ID')} byte, seharusnya ${diharapkan.toLocaleString('id-ID')} byte. Unduhannya tidak utuh — jangan dipasang, unduh ulang.`
          : null,
      });
      return;
    }

    if (status.keadaan === 'gagal' || status.keadaan === 'hilang') {
      siarkan({
        unduhanKeadaan: status.keadaan,
        galatUnduh:
          status.keadaan === 'gagal'
            ? `Unduhan gagal (kode ${status.alasan}). Coba lagi, atau unduh lewat browser.`
            : null,
      });
      return;
    }

    siarkan({
      unduhanKeadaan: status.keadaan,
      unduhanTerunduh: status.terunduh,
      unduhanTotal: status.total || keadaan.ukuranUnduh,
    });
    pemantau = setTimeout(putaran, JEDA_PANTAU_MS);
  };

  pemantau = setTimeout(putaran, 300);
};

/**
 * Lanjutkan memantau unduhan yang sudah berjalan sebelum aplikasi ditutup.
 *
 * Inilah yang membedakan unduhan sistem dari unduhan dalam aplikasi: pekerjaan
 * itu milik Android, jadi ia terus berjalan — dan saat aplikasi dibuka lagi,
 * yang perlu dipulihkan hanya cara menampilkannya.
 */
const lanjutkanPemantauan = async () => {
  if (!ASLI_NATIF) return;
  try {
    const { Preferences } = await prefs();
    const tersimpan = await Preferences.get({ key: KUNCI_UNDUHAN });
    if (!tersimpan.value) return;

    const urai = JSON.parse(tersimpan.value);
    const id = Number(urai?.id);
    if (!Number.isFinite(id)) return;

    // Unduhan untuk rilis yang sudah bukan rilis terbaru tidak relevan lagi;
    // menampilkan progresnya hanya menyuruh orang memasang berkas usang.
    if (keadaan.versiRilis && urai?.versi !== keadaan.versiRilis) {
      await simpanPenandaUnduh(null, null);
      return;
    }

    siarkan({ unduhanId: id, unduhanKeadaan: 'menunggu', unduhanTotal: keadaan.ukuranUnduh });
    pantauUnduhan(id);
  } catch {
    /* penanda tidak terbaca berarti tidak ada yang perlu dilanjutkan */
  }
};

/**
 * Unduh APK versi terbaru lewat DownloadManager, lalu ingat bahwa itu
 * sudah dilakukan.
 *
 * Kenapa lewat browser dan bukan diunduh sendiri: memasang APK dari dalam
 * aplikasi menuntut izin REQUEST_INSTALL_PACKAGES plus FileProvider — persis
 * dua hal yang membuat aplikasi hasil sideload dicurigai Play Protect, dan
 * aplikasi ini baru saja selesai membereskan peringatan itu. Jadi yang
 * dikerjakan tetap: buka tautannya, biarkan pengunduh sistem bekerja,
 * pemasangannya dimulai orangnya sendiri dari notifikasi unduhan.
 *
 * Yang BERUBAH adalah caranya membuka. Dulu ini sebuah <a href> biasa, dan
 * navigasi ke host luar diserahkan Bridge.launchIntent() milik Capacitor —
 * yang memanggil startActivity TANPA FLAG_ACTIVITY_NEW_TASK, sehingga browser
 * masuk ke tumpukan tugas NaruReader. Untuk unduhan 30-an MB itu berarti
 * jendela yang sedang mengunduh ikut terdorong ke belakang setiap kali orangnya
 * kembali ke aplikasi — bentuk yang dilaporkan sebagai "unduhan nyangkut di
 * saat-saat terakhir". Plugin BukaDiLuar membukanya sebagai tugas tersendiri.
 *
 * Penandanya disimpan SESUDAH browser benar-benar terbuka. Petunjuk "lanjutkan
 * pemasangan dari notifikasi" yang muncul padahal tidak ada yang terbuka lebih
 * buruk daripada tidak ada petunjuk sama sekali.
 *
 * @returns {Promise<boolean>} true kalau browser benar-benar terbuka.
 */
export const mulaiUnduhPembaruan = async () => {
  // Diperiksa ULANG di sini, bukan dipercaya karena sudah tersimpan: keadaan di
  // memori bisa berasal dari Preferences, dan Preferences bisa disunting di
  // perangkat yang di-root.
  const url = urlUnduhAman(keadaan.urlUnduh);
  const versi = keadaan.versiRilis;
  if (!url || !versi) {
    // Dulu di sini `return false` tanpa suara, dan itu keliru: tombolnya
    // ditekan, tidak ada yang terjadi, dan tidak ada satu pun keterangan.
    // Jalur yang tidak bisa dikerjakan harus MENGATAKANNYA.
    siarkan({ galatUnduh: 'Tautan unduhan untuk versi ini tidak ada' });
    return false;
  }

  const nama = namaBerkasAman(keadaan.namaBerkas) ?? `NaruReader-${versi}.apk`;

  /*
   * Jalur utama: DownloadManager milik Android.
   *
   * Kenapa bukan browser lagi — dua kegagalan nyata, keduanya terekam:
   * aplikasi GitHub yang mengunduh di dalam tumpukan tugas NaruReader lalu
   * membeku di 99% begitu orangnya kembali ke aplikasi ini, dan Chrome yang
   * melanjutkan unduhan terputus jadi berkas berukuran tepat tapi isinya rusak.
   * Unduhan sistem tidak bisa terdorong ke latar belakang dan tidak berhenti
   * saat NaruReader ditutup.
   */
  if (ASLI_NATIF) {
    try {
      const { mulaiUnduhan } = await import('./unduhSistem.js');
      const id = await dalamBatas(mulaiUnduhan(url, nama), 'Memulai unduhan sistem');
      siarkan({
        unduhDimulai: versi,
        galatUnduh: null,
        unduhanId: id,
        unduhanKeadaan: 'menunggu',
        unduhanTerunduh: 0,
        unduhanTotal: keadaan.ukuranUnduh,
        unduhanBerkas: null,
      });
      await simpanPenandaUnduh(versi, id);
      pantauUnduhan(id);
      return true;
    } catch (galat) {
      // Bukan akhir cerita: jatuh ke browser seperti sebelumnya, tapi dengan
      // sebabnya tertulis supaya kegagalan ini tidak kembali jadi "tombol yang
      // tidak melakukan apa-apa".
      siarkan({ galatUnduh: `Unduhan sistem tidak bisa dimulai (${galat?.message ?? 'sebab tidak diketahui'}); dicoba lewat browser` });
    }
  }

  try {
    const { bukaDiLuar } = await import('./bukaLuar.js');
    await dalamBatas(bukaDiLuar(url), 'Membuka tautan di browser');
  } catch (galat) {
    siarkan({ galatUnduh: galat?.message || 'Tautan unduhan tidak bisa dibuka' });
    return false;
  }

  siarkan({ unduhDimulai: versi, galatUnduh: null, unduhanId: null, unduhanKeadaan: null });
  await simpanPenandaUnduh(versi, null);
  return true;
};

/**
 * Buka daftar unduhan sistem; dari sana satu ketukan memulai pemasangan.
 *
 * Pemasangannya sengaja TIDAK dikerjakan dari sini — itu menuntut izin
 * REQUEST_INSTALL_PACKAGES, persis izin yang membuat aplikasi hasil sideload
 * dicurigai Play Protect.
 */
export const bukaUnduhan = async () => {
  try {
    const { bukaDaftarUnduhan } = await import('./unduhSistem.js');
    await dalamBatas(bukaDaftarUnduhan(), 'Membuka daftar unduhan');
    return true;
  } catch (galat) {
    siarkan({ galatUnduh: galat?.message || 'Daftar unduhan tidak bisa dibuka' });
    return false;
  }
};

/** Batalkan unduhan yang sedang berjalan, sekalian buang berkas separuhnya. */
export const batalkanUnduhanPembaruan = async () => {
  const id = keadaan.unduhanId;
  if (id == null) return false;
  try {
    const { batalkanUnduhan } = await import('./unduhSistem.js');
    await dalamBatas(batalkanUnduhan(id), 'Membatalkan unduhan');
  } catch {
    /* kalau DownloadManager sudah tidak mengenalnya, hasilnya sama saja */
  }
  siarkan({ unduhanId: null, unduhanKeadaan: null, unduhanTerunduh: 0, unduhanBerkas: null, unduhDimulai: null });
  await simpanPenandaUnduh(null, null);
  return true;
};

/**
 * Sembunyikan kabar untuk versi ini saja.
 *
 * Yang disimpan nomor versinya, bukan bendera "sudah ditutup". Bendera membuat
 * kabar untuk rilis BERIKUTNYA ikut tidak pernah muncul — orangnya menutup satu
 * kali dan tidak pernah diberi tahu apa pun lagi.
 */
export const abaikanPembaruan = async () => {
  const versi = keadaan.versiRilis;
  if (!versi) return;
  siarkan({ diabaikan: versi });
  try {
    const { Preferences } = await prefs();
    await Preferences.set({ key: KUNCI_ABAIKAN, value: versi });
  } catch {
    /* tidak bertahan sampai aplikasi dibuka lagi; sesi ini tetap tenang */
  }
};

/* ── Untuk React ────────────────────────────────────────────────────── */

/**
 * Apakah versi rilis benar-benar LEBIH BARU daripada yang terpasang?
 *
 * Hanya `=== 1`. bandingVersi mengembalikan null kalau salah satu sisi tidak
 * terbaca, dan null harus berarti diam — bukan "anggap saja ada pembaruan".
 */
const adaYangLebihBaru = (isi) => bandingVersi(isi.versiRilis, isi.versiTerpasang) === 1;

export const usePembaruan = () => {
  useEffect(() => {
    siapkanPembaruan();
  }, []);

  const kini = useSyncExternalStore(langgan, bacaKeadaan, bacaKeadaan);
  const adaPembaruan = adaYangLebihBaru(kini);

  return {
    ...kini,
    adaPembaruan,
    // Kabar hanya ditampilkan kalau versinya lebih baru, belum ditutup untuk
    // versi itu, DAN ada tautan unduhan yang lolos pemeriksaan. Tanpa tautan,
    // kabarnya cuma membuat cemas tanpa memberi jalan keluar.
    tampilkanKabar: adaPembaruan && Boolean(kini.urlUnduh) && kini.diabaikan !== kini.versiRilis,
    // Unduhan untuk versi INI yang sudah dibuka — bukan sekadar "pernah menekan
    // Unduh". Penanda dari rilis sebelumnya tidak boleh menyuruh siapa pun
    // memasang berkas yang sudah tidak relevan.
    sedangDiunduh: adaPembaruan && kini.unduhDimulai === kini.versiRilis,

    // Keadaan unduhan sistem, sudah diterjemahkan jadi pertanyaan yang memang
    // ditanyakan tampilan — supaya daftar nama keadaan tidak disalin ke setiap
    // komponen dan berbeda diam-diam begitu salah satunya ditambah.
    unduhanAktif: kini.unduhanKeadaan === 'menunggu' || kini.unduhanKeadaan === 'berjalan' || kini.unduhanKeadaan === 'jeda',
    unduhanSelesai: kini.unduhanKeadaan === 'selesai',
    unduhanRusak: kini.unduhanKeadaan === 'rusak',
    unduhanGagal: kini.unduhanKeadaan === 'gagal',
    // null berarti "besarnya belum diketahui" — bilah progres yang melompat dari
    // 0% ke 100% lebih buruk daripada bilah yang jujur mengaku belum tahu.
    persenUnduh:
      kini.unduhanTotal > 0 ? Math.min(100, Math.max(0, Math.round((kini.unduhanTerunduh / kini.unduhanTotal) * 100))) : null,

    cekPembaruan,
    abaikanPembaruan,
    mulaiUnduhPembaruan,
    bukaUnduhan,
    batalkanUnduhanPembaruan,
  };
};
