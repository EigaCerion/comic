import { useEffect, useSyncExternalStore } from 'react';
import { IS_APP } from './index.js';
import { normalkanAlamat, urlServer } from './server.js';

/**
 * Apakah server rumah masih terjangkau dari HP ini?
 *
 * Pertanyaan yang tidak pernah ada di build web: di sana halaman dan API satu
 * origin, jadi "server mati" berarti halamannya juga tidak termuat. Di HP,
 * aplikasinya termuat dari dalam APK dan tetap tampil rapi sambil setiap
 * permintaan gagal — layar penuh kerangka kosong tanpa satu pun petunjuk bahwa
 * yang salah adalah jaringan, bukan koleksinya.
 */

const STATUS_MEMERIKSA = 'memeriksa';
const STATUS_TERHUBUNG = 'terhubung';
const STATUS_PUTUS = 'putus';

/**
 * Batas waktu sendiri, bukan menunggu fetch menyerah.
 *
 * Server yang mati di Wi-Fi tidak menolak koneksi dengan sopan: paketnya hilang
 * dan fetch menggantung sampai batas waktu TCP, puluhan detik. Tanpa angka ini
 * layar "Memeriksa…" terlihat membeku.
 */
const BATAS_MS = 4000;

/**
 * Ketuk /api/health dan pastikan yang menjawab memang NaruReader.
 *
 * Status 200 saja tidak cukup sebagai bukti: router, printer jaringan, dan
 * captive portal hotel sama-sama menjawab 200 di port acak. Yang dicari adalah
 * identitas servisnya, supaya alamat salah ketik yang kebetulan hidup tidak
 * tersimpan sebagai "berhasil".
 *
 * @param {string|null} alamat Alamat yang ingin diuji; null = alamat tersimpan.
 */
export const periksaServer = async (alamat = null, batasMs = BATAS_MS) => {
  let target;
  if (alamat === null) {
    target = urlServer('/api/health');
  } else {
    const bersih = normalkanAlamat(alamat);
    if (!bersih) return false;
    target = `${bersih}/api/health`;
  }
  // Build android yang belum punya alamat menghasilkan jalur relatif, dan itu
  // menunjuk ke origin WebView sendiri — tidak ada gunanya ditembak.
  if (!/^https?:\/\//i.test(target)) return false;

  const kendali = new AbortController();
  const jam = setTimeout(() => kendali.abort(), batasMs);
  try {
    const res = await fetch(target, { signal: kendali.signal, cache: 'no-store' });
    if (!res.ok) return false;
    const data = await res.json();
    return data?.service === 'naruread-api';
  } catch {
    return false;
  } finally {
    clearTimeout(jam);
  }
};

let status = IS_APP ? STATUS_MEMERIKSA : STATUS_TERHUBUNG;
const pendengar = new Set();

const siarkan = (baru) => {
  if (baru === status) return;
  status = baru;
  pendengar.forEach((beri) => beri());
};

const langgan = (beri) => {
  pendengar.add(beri);
  return () => pendengar.delete(beri);
};

const bacaStatus = () => status;

let berjalan = null;

/**
 * Paksa periksa ulang. Aman dipanggil beruntun: resume aplikasi dan perubahan
 * jaringan hampir selalu tiba berbarengan (Android membangunkan aplikasi tepat
 * saat Wi-Fi tersambung lagi), dan dua ketukan serentak hanya memperlama
 * jawaban pertama.
 */
export const periksaUlang = () => {
  if (!IS_APP) return Promise.resolve(true);
  if (berjalan) return berjalan;
  siarkan(STATUS_MEMERIKSA);
  berjalan = periksaServer()
    .then((ok) => {
      siarkan(ok ? STATUS_TERHUBUNG : STATUS_PUTUS);
      return ok;
    })
    .catch(() => {
      siarkan(STATUS_PUTUS);
      return false;
    })
    .finally(() => {
      berjalan = null;
    });
  return berjalan;
};

let terpasang = false;

/**
 * Pasang pemicu periksa ulang. Pendengarnya sengaja tidak pernah dilepas:
 * pemanggilnya adalah cangkang aplikasi yang hidup selama prosesnya hidup, dan
 * melepas-pasang tiap render justru berisiko kehilangan kejadian resume yang
 * tiba di sela-selanya.
 */
export const pantauKoneksi = async () => {
  if (!IS_APP || terpasang) return;
  terpasang = true;
  periksaUlang();

  try {
    const { App } = await import('@capacitor/app');
    // appStateChange, bukan 'resume': di browser desktop (tempat build android
    // diuji) hanya yang pertama yang punya padanan, yaitu visibilitychange.
    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) periksaUlang();
    });
  } catch {
    /* plugin tidak ada — cukup andalkan periksa manual */
  }

  try {
    const { Network } = await import('@capacitor/network');
    Network.addListener('networkStatusChange', () => periksaUlang());
  } catch {
    /* idem */
  }
};

export const useTerhubung = () => {
  useEffect(() => {
    pantauKoneksi();
  }, []);

  const kini = useSyncExternalStore(langgan, bacaStatus, bacaStatus);

  return {
    status: kini,
    terhubung: kini === STATUS_TERHUBUNG,
    sedangMemeriksa: kini === STATUS_MEMERIKSA,
    periksaUlang,
  };
};
