/**
 * Pemisah build web dan build aplikasi Android.
 *
 * Seluruh kode khusus Android bersandar pada konstanta ini, bukan pada
 * pemeriksaan runtime, supaya bundel web tidak bertambah sebaris pun: Vite
 * mengganti `import.meta.env.MODE` dengan literal saat build, jadi IS_APP
 * runtuh menjadi `false` dan setiap `if (IS_APP)` maupun `{IS_APP && …}` ikut
 * dibuang Rollup bersama modul yang cuma dirujuk dari sana.
 *
 * Konsekuensinya satu aturan keras: plugin Capacitor hanya boleh dipanggil
 * lewat `import()` di dalam cabang IS_APP. Satu import statis saja sudah cukup
 * untuk menyeret @capacitor/core ke bundel web yang tidak pernah memakainya.
 */
export const IS_APP = import.meta.env.MODE === 'android';

/**
 * Benar-benar berjalan di dalam WebView Android?
 *
 * Sengaja dipisah dari IS_APP: build android juga dibuka di browser desktop
 * selama dikembangkan. Di sana Preferences dan jaringan tetap jalan karena
 * punya implementasi web, tetapi StatusBar, KeepAwake, dan pemindai QR sama
 * sekali tidak ada — panggilannya melempar, bukan diam-diam gagal. Jadi yang
 * native-saja dijaga oleh konstanta ini, yang app-saja oleh IS_APP.
 *
 * Nilainya dibaca dari global, bukan lewat `Capacitor.isNativePlatform()`,
 * justru karena aturan di atas: mengimpor @capacitor/core di modul yang dipakai
 * semua orang akan membatalkan seluruh pemangkasan. Jembatan native Android
 * menyuntikkan native-bridge.js ke WebView sebelum bundel aplikasi dijalankan,
 * jadi window.Capacitor sudah terisi saat baris ini dieksekusi.
 */
export const ASLI_NATIF =
  IS_APP && typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() === true;

/**
 * Layar yang tidak butuh alamat server SAMA SEKALI.
 *
 * Dulu daftar ini cuma '/sambung', dan itu benar selama aplikasi tidak lebih
 * dari jendela ke server rumah. Sejak /sumber membaca situs sumber langsung
 * dari HP, melemparkan orangnya ke layar penyambungan justru menyembunyikan
 * satu-satunya bagian yang sudah bisa dipakainya — tepat pada orang yang hanya
 * memasang APK-nya dan tidak punya server untuk disambungkan.
 *
 * Tinggal di sini, bukan di CangkangAndroid.jsx tempatnya lahir, karena
 * PitaOffline juga membutuhkannya: mengimpornya dari cangkang berarti menyeret
 * cangkang itu (beserta antrean unduh dan posisi baca) ke dalam bundel web yang
 * tidak pernah memakainya, sementara menyalin predikatnya berarti dua daftar
 * jalur yang akan berbeda diam-diam begitu salah satunya ditambah.
 */
export const mandiri = (jalur) =>
  jalur === '/sambung' || jalur === '/sumber' || jalur.startsWith('/sumber/');
