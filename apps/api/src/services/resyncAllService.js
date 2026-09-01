import { getDb } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { resyncComic } from './auditService.js';

const log = createLogger('naruread:resync-all');

/**
 * Cek update untuk SELURUH koleksi, satu komik demi satu.
 *
 * Dikerjakan bergiliran, bukan paralel. Bukan karena lebih sederhana, tapi
 * karena setiap komik berarti satu permintaan ke situs sumber: 23 dari 27 komik
 * berasal dari host yang sama, jadi menjalankannya serentak hanya akan
 * menumpuk di antrean throttle per-host sambil memperbesar peluang diblokir.
 *
 * Statusnya disimpan di memori saja. Ini operasi sesaat yang hasil nyatanya
 * sudah mendarat di tabel download_queue — tidak ada yang perlu diselamatkan
 * kalau server mati di tengah jalan.
 */
const keadaan = {
  berjalan: false,
  dimintaBerhenti: false,
  mulaiPada: null,
  selesaiPada: null,
  total: 0,
  diproses: 0,
  sekarang: null,
  totalDiantre: 0,
  hasil: [],
};

// Berapa banyak komik "perlu perhatian" yang ikut dikirim tiap poll. Sisanya
// cukup dihitung: detail chapternya toh sudah tampil di antrian unduhan.
const BATAS_PERHATIAN = 50;

/**
 * Ringkasan status — sengaja TIDAK mengirim seluruh daftar hasil.
 *
 * Endpoint ini di-poll tiap 1,5 detik selama pemeriksaan berlangsung. Kalau
 * seluruh daftar ikut terkirim, koleksi 500 komik berarti ~110 KB per poll
 * selama ~80 menit — sekitar 346 MB untuk satu kali cek update, dan itu
 * dibayar mahal saat dibuka dari HP. Yang benar-benar berubah tiap detik
 * hanyalah angka kemajuan, jadi hanya itu yang dikirim; komik yang sudah
 * terkini cukup jadi hitungan.
 */
export const statusResyncSemua = () => {
  const ringkasan = { adaBaru: 0, terkini: 0, gagal: 0, tanpaSumber: 0 };
  const kunci = { 'ada-baru': 'adaBaru', terkini: 'terkini', gagal: 'gagal', 'tanpa-sumber': 'tanpaSumber' };
  keadaan.hasil.forEach((item) => {
    const k = kunci[item.status];
    if (k) ringkasan[k] += 1;
  });

  const perluPerhatian = keadaan.hasil.filter((item) => item.status !== 'terkini');

  // Perkiraan sisa waktu dari kecepatan nyata sejauh ini — di koleksi besar,
  // "27 dari 500" tanpa perkiraan waktu tidak memberi tahu apa pun.
  let sisaDetik = null;
  if (keadaan.berjalan && keadaan.diproses > 0 && keadaan.mulaiPada) {
    const lewat = Date.now() - new Date(keadaan.mulaiPada).getTime();
    sisaDetik = Math.round(((lewat / keadaan.diproses) * (keadaan.total - keadaan.diproses)) / 1000);
  }

  return {
    berjalan: keadaan.berjalan,
    mulaiPada: keadaan.mulaiPada,
    selesaiPada: keadaan.selesaiPada,
    total: keadaan.total,
    diproses: keadaan.diproses,
    sekarang: keadaan.sekarang,
    totalDiantre: keadaan.totalDiantre,
    sisaDetik,
    ringkasan,
    perhatian: perluPerhatian.slice(0, BATAS_PERHATIAN),
    perhatianLain: Math.max(0, perluPerhatian.length - BATAS_PERHATIAN),
  };
};

export const hentikanResyncSemua = () => {
  if (!keadaan.berjalan) return { berhenti: false, alasan: 'tidak ada pemeriksaan yang berjalan' };
  keadaan.dimintaBerhenti = true;
  log.info('permintaan berhenti diterima — akan berhenti setelah komik yang sedang jalan selesai');
  return { berhenti: true };
};

/** Komik yang layak dicek: semuanya. Yang tanpa URL sumber ditangani resyncComic. */
const daftarKomik = () =>
  getDb()
    .prepare('SELECT id, title, slug FROM comics ORDER BY title COLLATE NOCASE')
    .all();

const jedaMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sesaat = (pesan = '') =>
  /fetch failed|timeout|aborted|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(pesan);

/** Periksa satu komik, selalu mengembalikan entri hasil (tidak pernah melempar). */
const periksaSatu = async (item) => {
  try {
    const hasil = await resyncComic(item.id);
    // resyncComic mengembalikan { error } (bukan melempar) saat URL sumber
    // tidak ketemu — itu bukan kegagalan sistem, cuma komik yang belum punya
    // acuan, jadi dibedakan dari error sungguhan.
    if (hasil.error) return { ...item, status: 'tanpa-sumber', pesan: hasil.error, diantre: 0 };
    return {
      ...item,
      status: hasil.diantre > 0 ? 'ada-baru' : 'terkini',
      diantre: hasil.diantre,
      diSumber: hasil.diSumber,
      diKoleksi: hasil.diKoleksi,
    };
  } catch (error) {
    // Satu komik yang bermasalah tidak boleh menghentikan sisanya — itulah
    // seluruh gunanya tombol ini.
    log.warn(`cek update ${item.slug} gagal: ${error.message}`);
    return { ...item, status: 'gagal', pesan: error.message, diantre: 0 };
  }
};

/**
 * Sapuan kedua untuk komik yang gagal karena gangguan sesaat.
 *
 * Pemeriksaan ini memicu unduhannya sendiri: begitu chapter baru diantre, bot
 * importir menyerbu host yang sama dan halaman seri berikutnya kalah rebutan.
 * Puncaknya bisa puluhan detik — lebih lama dari yang bisa ditutup percobaan
 * ulang di dalam satu pengambilan. Karena itu yang tersisa dicoba sekali lagi
 * di akhir, saat gelombang unduhan sudah lewat. Kegagalan yang tegas (URL mati)
 * tidak ikut, supaya situs sumber tidak ditekan tanpa guna.
 */
const sapuanKedua = async () => {
  const ulang = keadaan.hasil.filter((x) => x.status === 'gagal' && sesaat(x.pesan));
  if (ulang.length === 0 || keadaan.dimintaBerhenti) return;

  log.info(`sapuan kedua untuk ${ulang.length} komik yang gagal sesaat`);
  keadaan.sekarang = `Mencoba ulang ${ulang.length} komik…`;
  await jedaMs(15_000); // beri jeda supaya gelombang unduhan mereda

  for (const item of ulang) {
    if (keadaan.dimintaBerhenti) break;
    keadaan.sekarang = item.title;
    const baru = await periksaSatu(item);
    const posisi = keadaan.hasil.findIndex((x) => x.id === item.id);
    if (posisi > -1) keadaan.hasil[posisi] = baru;
    if (baru.status === 'ada-baru') keadaan.totalDiantre += baru.diantre;
    log.info(`sapuan kedua ${item.slug}: ${baru.status}`);
  }
};

const jalankan = async () => {
  const komik = daftarKomik();
  keadaan.total = komik.length;
  keadaan.diproses = 0;
  keadaan.totalDiantre = 0;
  keadaan.hasil = [];
  keadaan.mulaiPada = new Date().toISOString();
  keadaan.selesaiPada = null;

  log.info(`cek update dimulai untuk ${komik.length} komik`);

  for (const item of komik) {
    if (keadaan.dimintaBerhenti) {
      log.info(`dihentikan setelah ${keadaan.diproses} komik`);
      break;
    }

    keadaan.sekarang = item.title;

    const entri = await periksaSatu(item);
    if (entri.status === 'ada-baru') keadaan.totalDiantre += entri.diantre;
    keadaan.hasil.push(entri);

    keadaan.diproses += 1;
  }

  await sapuanKedua();

  keadaan.sekarang = null;
  keadaan.berjalan = false;
  keadaan.dimintaBerhenti = false;
  keadaan.selesaiPada = new Date().toISOString();

  const baru = keadaan.hasil.filter((x) => x.status === 'ada-baru').length;
  log.info(
    `cek update selesai: ${keadaan.diproses}/${keadaan.total} komik, ${baru} punya chapter baru, ${keadaan.totalDiantre} chapter diantre`,
  );
};

export const mulaiResyncSemua = () => {
  if (keadaan.berjalan) return { dimulai: false, ...statusResyncSemua() };

  keadaan.berjalan = true;
  keadaan.dimintaBerhenti = false;

  // Sengaja tidak di-await: permintaan HTTP harus langsung kembali, sementara
  // pemeriksaan puluhan komik berjalan di latar. Kemajuannya dibaca lewat
  // GET /api/audit/resync-all.
  jalankan().catch((error) => {
    log.error('cek update berhenti tak terduga:', error);
    keadaan.berjalan = false;
    keadaan.dimintaBerhenti = false;
    keadaan.selesaiPada = new Date().toISOString();
  });

  return { dimulai: true, ...statusResyncSemua() };
};

export default { mulaiResyncSemua, statusResyncSemua, hentikanResyncSemua };
