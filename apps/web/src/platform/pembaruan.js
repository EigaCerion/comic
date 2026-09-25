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
      terbaik = { versi: cocok[1], url, nama: aset.name };
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
    const [tersimpan, diabaikan] = await Promise.all([
      Preferences.get({ key: KUNCI_PEMBARUAN }),
      Preferences.get({ key: KUNCI_ABAIKAN }),
    ]);
    let isi = null;
    if (tersimpan.value) {
      const urai = JSON.parse(tersimpan.value);
      if (urai && typeof urai === 'object') isi = urai;
    }
    return { isi, diabaikan: diabaikan.value || null };
  } catch {
    // Penyimpanan tidak terbaca (browser mode privat saat menguji build android
    // di laptop, atau JSON lama yang bentuknya sudah berubah). Bukan alasan
    // untuk tidak memeriksa: paling buruk pemeriksaannya dianggap belum pernah.
    return { isi: null, diabaikan: null };
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
  namaRilis: null,
  catatan: null,
  /** Kapan pemeriksaan terakhir BERHASIL (ms epoch). */
  diperiksaPada: null,
  /** Kapan pemeriksaan terakhir DICOBA, berhasil atau tidak (ms epoch). */
  dicobaPada: null,
  sedangMemeriksa: false,
  galat: null,
  diabaikan: null,
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

    const { isi, diabaikan } = await bacaSimpanan();

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
      ...(belumAdaJawaban
        ? {
            versiRilis: typeof isi?.versiRilis === 'string' ? isi.versiRilis : null,
            // URL tersimpan diperiksa ULANG, bukan dipercaya karena sudah pernah
            // lolos: penyimpanan aplikasi bisa disunting di perangkat yang
            // di-root, dan pemeriksaan yang hanya berlaku sekali bukan
            // pemeriksaan.
            urlUnduh: urlUnduhAman(isi?.urlUnduh),
            namaRilis: typeof isi?.namaRilis === 'string' ? isi.namaRilis : null,
            catatan: typeof isi?.catatan === 'string' ? isi.catatan : null,
            diperiksaPada: Number.isFinite(isi?.diperiksaPada) ? isi.diperiksaPada : null,
          }
        : {}),
    });

    // Pemicu resume dipasang LEBIH DULU: pemeriksaan di bawah bisa memakan
    // sepuluh detik penuh (batas waktu permintaan), dan aplikasi yang berpindah
    // ke belakang lalu kembali di sela itu tidak boleh melewatkan pemicunya.
    await pasangPemicuResume();
    await cekKalauSudahLewatSehari();
  })();

  return penyiapan;
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
    cekPembaruan,
    abaikanPembaruan,
  };
};
