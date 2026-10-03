import { ASLI_NATIF } from './index.js';

/**
 * Buka satu tautan https DI LUAR aplikasi ini.
 *
 * Pasangan JavaScript dari plugin BukaDiLuar
 * (android/app/src/main/java/id/naruread/app/BukaDiLuar.java) — penjelasan
 * lengkap kenapa ia ada ada di sana. Ringkasnya: browser harus berdiri sebagai
 * tugas (task) miliknya sendiri, dan jalur bawaan Capacitor menaruhnya di dalam
 * tugas NaruReader.
 *
 * Satu-satunya pemakainya hari ini adalah unduhan APK pembaruan, dan bentuk
 * fungsinya sengaja dibuat umum secukupnya saja — bukan "bukaUnduhanApk" —
 * karena yang dikerjakan memang cuma membuka tautan.
 */

/*
 * Plugin didaftarkan SEKALI lalu disimpan.
 *
 * registerPlugin() mengembalikan Proxy baru tiap panggilan, dan Capacitor
 * mencatat peringatan untuk nama yang sama didaftarkan dua kali. Pemanggilnya
 * adalah tombol yang boleh ditekan berulang kali.
 */
let plugin = null;

/*
 * Dikembalikan TERBUNGKUS `{ plugin }`, dan itu bukan gaya penulisan.
 *
 * registerPlugin() mengembalikan Proxy yang menjawab SETIAP akses properti
 * dengan sebuah fungsi — termasuk `.then`. Mengembalikan proxy itu apa adanya
 * dari fungsi `async` membuat mesin promise JavaScript memperlakukannya sebagai
 * "thenable" dan memanggil `plugin.then(resolve, reject)`. Panggilan itu
 * diteruskan ke Android sebagai metode plugin bernama "then", dijawab
 * «"BukaDiLuar.then()" is not implemented on android» — pada rantai promise
 * TERSENDIRI yang tidak dipegang siapa pun.
 *
 * Akibatnya `await muatPlugin()` tidak pernah selesai: bukan resolve, bukan
 * reject, hanya menggantung selamanya. Pemanggilnya tidak pernah sampai ke
 * baris berikutnya, try/catch-nya tidak pernah menyala, dan galatnya hanya
 * muncul sebagai unhandled rejection di konsol — yang pada build rilis tidak
 * dicatat ke mana pun. Di layar: tombol Unduh yang ditekan dan TIDAK melakukan
 * apa-apa, tanpa satu pun pesan.
 *
 * Satu objek pembungkus menghapus seluruh persoalan itu: objek biasa tidak
 * punya `.then`, jadi promise-nya selesai seperti promise mana pun.
 */
const muatPlugin = async () => {
  if (!plugin) {
    const { registerPlugin } = await import('@capacitor/core');
    plugin = registerPlugin('BukaDiLuar');
  }
  return { plugin };
};

/**
 * @param {string} url tautan https
 * @returns {Promise<void>} menolak kalau tidak ada yang bisa membukanya —
 *   pemanggilnya menampilkan petunjuk "unduhan sedang berjalan", dan petunjuk
 *   itu tidak boleh muncul kalau tidak ada yang benar-benar terbuka.
 */
export const bukaDiLuar = async (url) => {
  const alamat = String(url ?? '');
  // Dijaga di tiga lapis (di sini, di Java, dan urlUnduhAman di pembaruan.js).
  // Yang di sini menjaga agar build android yang dibuka di browser desktop pun
  // tidak pernah menyerahkan skema aneh ke window.open.
  if (!alamat.toLowerCase().startsWith('https://')) throw new Error('Hanya tautan https yang boleh dibuka');

  if (!ASLI_NATIF) {
    // Build android yang diuji di browser desktop. noopener wajib: tanpa itu
    // halaman yang dibuka memegang window.opener ke aplikasi ini.
    window.open(alamat, '_blank', 'noopener,noreferrer');
    return;
  }

  const { plugin: BukaDiLuar } = await muatPlugin();
  await BukaDiLuar.buka({ url: alamat });
};

export default bukaDiLuar;
