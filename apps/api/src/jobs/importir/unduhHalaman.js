/**
 * Mengunduh SATU gambar halaman, dengan percobaan ulang dan host cadangan.
 *
 * Dipisah dari pengerjaan job karena inilah satu-satunya bagian yang menyentuh
 * jaringan per halaman, dan satu-satunya yang boleh gagal lalu dicoba lagi
 * tanpa menggagalkan 81 halaman lain yang sudah ada di disk.
 */
import config from '../../utils/config.js';
import { fetchImage } from '../../utils/httpClient.js';
import { compressToFile } from '../../services/compressionService.js';
import { createLogger } from '../../utils/logger.js';
import { sedangBerhenti } from './keadaan.js';

const log = createLogger('naruread:importir');

const jeda = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Daftar URL yang layak dicoba untuk satu halaman: URL aslinya lebih dulu, lalu
 * hasil penukaran host sesuai peta yang diumumkan halaman sumber.
 *
 * Ada chapter yang host utamanya benar-benar mati (semua variasi nama berkas
 * menjawab 404) sementara host cadangannya melayani berkas itu dengan normal.
 * Tanpa mencoba cadangan, chapter seperti itu jadi jalan buntu permanen.
 */
const daftarKandidat = (url, cadangan) => {
  const kandidat = [url];
  Object.entries(cadangan ?? {}).forEach(([dari, ke]) => {
    if (!url.includes(dari)) return;
    const alternatif = url.split(dari).join(ke);
    if (!kandidat.includes(alternatif)) kandidat.push(alternatif);
  });
  return kandidat;
};

/**
 * Unduh satu halaman, dengan percobaan ulang untuk halaman itu saja.
 *
 * Sebelumnya satu gambar yang gagal langsung menggagalkan seluruh job, sehingga
 * chapter dengan 82 halaman dibuang gara-gara halaman ke-1 lambat — 81 berkas
 * lain sudah ada di disk tapi tidak pernah tercatat. Sekarang kegagalan sesaat
 * dicoba ulang di tempat, dan kalau tetap gagal pesannya menyebut nomor halaman
 * serta URL-nya supaya bisa langsung ditelusuri.
 */
export const unduhHalaman = async (url, referer, target, nomor, cadangan) => {
  const maksimal = Math.max(1, config.worker.imageRetry);
  const kandidat = daftarKandidat(url, cadangan);
  let terakhir = null;

  for (let percobaan = 1; percobaan <= maksimal; percobaan += 1) {
    for (const alamat of kandidat) {
      try {
        const buffer = await fetchImage(alamat, referer);
        const hasil = await compressToFile(buffer, target);
        if (alamat !== url) log.info(`halaman ${nomor}: dipakai host cadangan ${new URL(alamat).host}`);
        return hasil;
      } catch (error) {
        if (sedangBerhenti()) throw error;
        terakhir = error;
      }
    }
    if (percobaan < maksimal) {
      log.warn(`halaman ${nomor} gagal (percobaan ${percobaan}/${maksimal}): ${terakhir?.message}`);
      await jeda(1000 * percobaan); // beri napas ke server sumber
    }
  }

  const dicoba = kandidat.length > 1 ? ` (${kandidat.length} host dicoba)` : '';
  throw new Error(`Halaman ${nomor} gagal setelah ${maksimal} percobaan${dicoba} — ${terakhir?.message ?? 'sebab tidak diketahui'} (${url})`);
};
