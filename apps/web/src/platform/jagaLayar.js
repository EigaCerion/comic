import { ASLI_NATIF } from './index.js';

/**
 * Penjaga layar dengan penghitung pemegang.
 *
 * KeepAwake adalah SATU BIT milik seluruh Activity: keepAwake() memasang
 * FLAG_KEEP_SCREEN_ON dan allowSleep() mencabutnya, tanpa pengertian siapa yang
 * memasangnya. Di aplikasi ini ada dua pemegang yang hidup berbarengan — reader
 * (ModeBacaNatif) dan antrean unduh (pompa) — dan keduanya memanggil plugin itu
 * langsung, jadi yang selesai duluan mematikan penjaga milik yang lain:
 *
 *  - tekan "Simpan 10 chapter" lalu baca chapter yang sudah tersimpan sambil
 *    menunggu; antrean habis, blok finally-nya memanggil allowSleep(), dan layar
 *    boleh tidur padahal reader masih terbuka. ModeBacaNatif memasangnya sekali
 *    saat mount saja, jadi tidak pernah dipulihkan sepanjang sesi baca itu.
 *  - baca sambil antrean berjalan lalu keluar dari reader; pembersihannya
 *    memanggil allowSleep(), layar mati beberapa menit kemudian, Android
 *    membekukan jaringan aplikasi, dan unduhannya berhenti di tengah.
 *
 * Maka sakelarnya hanya disentuh di tepi 0→1 dan 1→0. Penghitungnya dinaikkan
 * dan diturunkan SEREMPAK (bukan di dalam async) supaya pasangannya selalu tepat
 * walau pemegangnya lepas sebelum import() plugin selesai.
 */

let pemegang = 0;

/*
 * Panggilan ke plugin diserikan. keepAwake() dan allowSleep() sama-sama async,
 * dan dua tepi yang berdekatan (unduhan selesai persis saat reader dibuka) bisa
 * mendarat terbalik — layar dibiarkan tidur padahal pemegang terakhir justru
 * baru saja meminta sebaliknya.
 */
let rantai = Promise.resolve();
const diam = () => undefined;

const sakelar = (nyala) => {
  rantai = rantai.then(async () => {
    try {
      const { KeepAwake } = await import('@capacitor-community/keep-awake');
      if (nyala) await KeepAwake.keepAwake();
      else await KeepAwake.allowSleep();
    } catch {
      /* perangkat tanpa plugin ini: unduhan dan bacaan tetap jalan selama layar menyala */
    }
  }, diam);
  return rantai;
};

/** Minta layar tetap menyala. Wajib dipasangkan dengan satu lepasLayar(). */
export const tahanLayar = () => {
  if (!ASLI_NATIF) return rantai;
  pemegang += 1;
  return pemegang === 1 ? sakelar(true) : rantai;
};

/** Lepaskan satu pegangan. Layar baru boleh tidur saat pemegang terakhir pergi. */
export const lepasLayar = () => {
  if (!ASLI_NATIF) return rantai;
  // Pelepasan berlebih diabaikan, bukan dibiarkan membuat penghitung negatif:
  // satu saja akan membuat tahanLayar() berikutnya tidak pernah menyentuh tepi
  // 0→1 lagi, dan layar tidak pernah dijaga sampai aplikasi dimulai ulang.
  if (pemegang === 0) return rantai;
  pemegang -= 1;
  return pemegang === 0 ? sakelar(false) : rantai;
};

export default { tahanLayar, lepasLayar };
