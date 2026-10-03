import { ASLI_NATIF } from './index.js';

/**
 * Pasangan JavaScript dari plugin UnduhSistem
 * (android/app/src/main/java/id/naruread/app/UnduhSistem.java) — alasan
 * lengkapnya ada di sana. Ringkasnya: APK pembaruan diunduh DownloadManager
 * milik Android, bukan oleh aplikasi lain yang bisa terdorong ke latar
 * belakang.
 */

/*
 * Proxy plugin disimpan, dan selalu dikembalikan TERBUNGKUS objek biasa.
 *
 * registerPlugin() menjawab setiap akses properti dengan sebuah fungsi,
 * termasuk `.then`. Mengembalikannya apa adanya dari fungsi async membuat
 * JavaScript menyangkanya promise lalu memanggil `.then(resolve, reject)` —
 * yang diteruskan ke Android sebagai metode plugin bernama "then", ditolak di
 * rantai promise tersendiri, dan membuat `await`-nya menggantung SELAMANYA
 * tanpa galat yang bisa ditangkap siapa pun.
 *
 * Itu bukan kekhawatiran teoretis: persis itu yang membuat tombol "Unduh" di
 * 0.2.0 dan 0.3.0 ditekan tanpa menghasilkan apa pun. Lihat bukaLuar.js.
 */
let plugin = null;

const muatPlugin = async () => {
  if (!plugin) {
    const { registerPlugin } = await import('@capacitor/core');
    plugin = registerPlugin('UnduhSistem');
  }
  return { plugin };
};

/** Apakah unduhan sistem bisa dipakai di sini sama sekali. */
export const adaUnduhSistem = () => ASLI_NATIF;

/**
 * Antrekan unduhan ke DownloadManager.
 *
 * @param {string} url   tautan https
 * @param {string} nama  nama berkas, harus berakhiran .apk
 * @returns {Promise<number>} id unduhan, dipakai statusUnduhan()
 */
export const mulaiUnduhan = async (url, nama) => {
  const alamat = String(url ?? '');
  if (!alamat.toLowerCase().startsWith('https://')) throw new Error('Hanya tautan https yang boleh diunduh');

  const { plugin: UnduhSistem } = await muatPlugin();
  const hasil = await UnduhSistem.mulai({ url: alamat, nama: String(nama ?? '') });

  const id = Number(hasil?.id);
  if (!Number.isFinite(id)) throw new Error('Unduhan tidak memberi nomor yang bisa dilacak');
  return id;
};

/**
 * Keadaan satu unduhan.
 *
 * @returns {Promise<{keadaan: string, terunduh: number, total: number, berkas: string|null}>}
 */
export const statusUnduhan = async (id) => {
  const { plugin: UnduhSistem } = await muatPlugin();
  const hasil = await UnduhSistem.status({ id: Number(id) });
  return {
    keadaan: typeof hasil?.keadaan === 'string' ? hasil.keadaan : 'hilang',
    terunduh: Number(hasil?.terunduh) || 0,
    total: Number(hasil?.total) || 0,
    alasan: Number(hasil?.alasan) || 0,
    berkas: typeof hasil?.berkas === 'string' ? hasil.berkas : null,
  };
};

/** Buka daftar unduhan sistem; dari sana pemasangan dimulai satu ketukan. */
export const bukaDaftarUnduhan = async () => {
  const { plugin: UnduhSistem } = await muatPlugin();
  await UnduhSistem.bukaDaftarUnduhan();
};

/** Batalkan unduhan, sekalian buang berkas setengah jadinya. */
export const batalkanUnduhan = async (id) => {
  const { plugin: UnduhSistem } = await muatPlugin();
  await UnduhSistem.batalkan({ id: Number(id) });
};
