import { IS_APP } from './index.js';

/**
 * Alamat server rumah dan token sesi milik build Android.
 *
 * Keduanya disimpan lewat @capacitor/preferences, bukan localStorage langsung:
 * di WebView, localStorage ikut terhapus setiap kali Android membersihkan data
 * WebView atau skema halaman berubah, sementara Preferences bersandar pada
 * SharedPreferences yang umurnya seumur aplikasi. Di browser desktop plugin ini
 * jatuh balik ke localStorage sendiri, jadi build android tetap bisa diuji di
 * laptop tanpa cabang tambahan di sini.
 *
 * Nilainya dimuat SEKALI ke state modul oleh siapkanPlatform(), lalu dibaca
 * serentak (alamatServer(), tokenSesi()). Itu disengaja: baseQuery RTK Query
 * dan setiap pemanggil urlMedia() berjalan sinkron, dan membuat mereka async
 * hanya demi satu pembacaan penyimpanan akan menjalar ke seluruh aplikasi.
 */
export const KUNCI_ALAMAT = 'naruread:alamat-server';
export const KUNCI_TOKEN = 'naruread:token-sesi';

/** Server ini selalu mendengar di 3000 kecuali pemiliknya menyebut port lain. */
const PORT_BAWAAN = 3000;

let alamat = null;
let token = null;

// Modul plugin dipegang setelah import pertama. import() memang meng-cache
// modulnya, tapi promise-nya tetap menambah satu microtask di jalur yang
// dipakai tiap kali menyimpan token.
let modulPrefs = null;

/**
 * Plugin Capacitor BUKAN objek biasa: ia Proxy yang menerjemahkan setiap akses
 * properti menjadi panggilan ke plugin — termasuk `.then`. Mengembalikannya
 * langsung dari fungsi async membuat runtime menganggapnya thenable, memanggil
 * `Preferences.then(resolve, reject)`, dan plugin menjawab "not implemented on
 * web" tanpa pernah memanggil resolve maupun reject. Hasilnya promise yang tak
 * pernah selesai: layar kosong total, karena main.jsx menunggu promise itu
 * sebelum merender. Terbukti persis begitu saat build android dibuka pertama
 * kali di browser. Karena itu proxy-nya selalu dibungkus objek biasa dulu.
 */
const prefs = async () => {
  if (!modulPrefs) modulPrefs = await import('@capacitor/preferences');
  return { Preferences: modulPrefs.Preferences };
};

/**
 * Terima apa pun yang masuk akal diketik orang, keluarkan satu bentuk baku.
 *
 * Yang diketik orang adalah apa yang dilihatnya: kadang "192.168.1.5" dari
 * layar launcher, kadang "192.168.1.5:3000", kadang URL utuh hasil pindai QR
 * yang berakhiran "/". Tanpa pembakuan, tiga bentuk itu menghasilkan tiga
 * alamat berbeda dan yang ketiga melahirkan "…3000//api/health".
 */
export const normalkanAlamat = (masukan) => {
  const teks = String(masukan ?? '').trim();
  if (!teks) return null;

  const berskema = /^[a-z][a-z0-9+.-]*:\/\//i.test(teks) ? teks : `http://${teks}`;
  let url;
  try {
    url = new URL(berskema);
  } catch {
    return null;
  }
  // mailto:, ftp:, dan sejenisnya lolos dari URL() tapi tidak bisa di-fetch.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;

  // Port kosong berarti port bawaan skema (80), yang di sini hampir pasti bukan
  // yang dimaksud — orang menyebut nama host saja karena menganggap portnya
  // sudah diketahui.
  if (!url.port) url.port = String(PORT_BAWAAN);

  // Jalur dan query dibuang: yang disimpan adalah asal server. urlServer()
  // yang menempelkan jalurnya, dan QR launcher berisi URL lengkap.
  return `${url.protocol}//${url.host}`;
};

let pemuatan = null;

const baca = async () => {
  const { Preferences } = await prefs();
  const [tersimpanAlamat, tersimpanToken] = await Promise.all([
    Preferences.get({ key: KUNCI_ALAMAT }),
    Preferences.get({ key: KUNCI_TOKEN }),
  ]);
  alamat = normalkanAlamat(tersimpanAlamat.value);
  token = tersimpanToken.value || null;
};

const muat = async () => {
  try {
    // Dibatasi waktu, bukan hanya dibungkus try/catch. Pembacaan ini pernah
    // menghasilkan promise yang TIDAK PERNAH selesai — bukan gagal, hanya diam
    // — dan karena main.jsx menunggunya, yang tampil adalah layar putih kosong
    // tanpa sepatah pesan pun. Menyerah setelah beberapa detik dan melanjutkan
    // ke layar "Sambungkan" jauh lebih bisa dijelaskan daripada itu.
    await Promise.race([
      baca(),
      new Promise((selesai) => {
        setTimeout(selesai, 4000);
      }),
    ]);
  } catch {
    // Penyimpanan tidak terbaca (browser mode privat saat menguji build android
    // di laptop). Aplikasi tetap boleh jalan — paling buruk orangnya diminta
    // mengisi alamat server sekali lagi.
  }
};

/**
 * Dipanggil di main.jsx SEBELUM render pertama pada build android.
 *
 * Kalau render didahulukan, render pertama berjalan tanpa alamat server: semua
 * permintaan menembak origin WebView (http://localhost) dan gagal, lalu
 * CangkangAndroid melempar orangnya ke /sambung walau alamatnya sebenarnya ada
 * di penyimpanan. Satu await di awal menghapus seluruh kelas bug itu.
 */
export const siapkanPlatform = () => {
  if (!IS_APP) return Promise.resolve();
  // Promise-nya yang di-cache, bukan flag "sudah jalan": dua pemanggil hampir
  // bersamaan harus menunggu pemuatan yang sama, bukan lewat begitu saja.
  if (!pemuatan) pemuatan = muat();
  return pemuatan;
};

export const alamatServer = () => alamat;

export const tokenSesi = () => token;

export const setelAlamatServer = async (nilai) => {
  const bersih = normalkanAlamat(nilai);
  alamat = bersih;
  if (!IS_APP) return bersih;
  try {
    const { Preferences } = await prefs();
    if (bersih) await Preferences.set({ key: KUNCI_ALAMAT, value: bersih });
    else await Preferences.remove({ key: KUNCI_ALAMAT });
  } catch {
    // Gagal menulis hanya berarti alamatnya tidak bertahan sampai aplikasi
    // dibuka lagi; sesi yang sedang berjalan sudah memakai nilai di memori.
  }
  return bersih;
};

export const setelToken = async (nilai) => {
  token = nilai || null;
  if (!IS_APP) return;
  try {
    const { Preferences } = await prefs();
    if (token) await Preferences.set({ key: KUNCI_TOKEN, value: token });
    else await Preferences.remove({ key: KUNCI_TOKEN });
  } catch {
    /* sama seperti di atas: cukup hilang saat aplikasi ditutup */
  }
};

/**
 * Jalur API menjadi URL utuh ke server rumah pada build android, dan tetap apa
 * adanya pada build web (di sana halaman dan API satu origin).
 */
export const urlServer = (path = '') => {
  if (!IS_APP) return path;
  if (!alamat) return path;
  const jalur = String(path);
  return `${alamat}${jalur.startsWith('/') ? '' : '/'}${jalur}`;
};

/**
 * Sama untuk URL gambar, dengan satu syarat tambahan: hanya jalur relatif yang
 * diberi awalan. Cover Scout adalah URL absolut ke situs sumber, dan menempelkan
 * alamat server di depannya akan mengubah tautan sah menjadi 404.
 */
export const urlMedia = (url) => {
  if (!IS_APP) return url;
  if (typeof url !== 'string' || !url.startsWith('/')) return url;
  return urlServer(url);
};
