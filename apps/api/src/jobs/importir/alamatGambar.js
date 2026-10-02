/**
 * Dari sebuah job antrean, hasilkan daftar URL gambar yang harus diunduh.
 *
 * Dua bentuk job yang didukung, dan bedanya penting: job boleh membawa daftar
 * URL gambar yang sudah jadi (dari tempel manual), atau hanya alamat halaman
 * chapter — yang berarti halamannya harus diambil dan dibaca dulu.
 */
import { getDb } from '../../db/index.js';
import { fetchHtml } from '../../utils/httpClient.js';
import { sanitizeSourceUrl } from '../../utils/validators.js';
import { extractChapterPages } from '@naruread/sumber';
import '../../utils/sumberLogger.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('naruread:importir');

/** Job boleh membawa daftar gambar, atau hanya URL halaman chapter. */
export const resolveImageUrls = async (job) => {
  const payload = JSON.parse(job.payload || '{}');
  const paksaUlang = payload.paksa_ulang === true;
  if (payload.image_urls?.length) {
    return {
      urls: payload.image_urls,
      referer: payload.chapter_url,
      cadangan: payload.host_fallbacks ?? {},
      paksaUlang,
    };
  }

  if (!payload.chapter_url) throw new Error('Job tanpa image_urls maupun chapter_url');

  const { html, finalUrl } = await fetchHtml(payload.chapter_url);
  const { imageUrls, extractor, hostFallbacks } = extractChapterPages(html, finalUrl);
  if (!imageUrls.length) {
    throw new Error(
      `Tidak ada gambar terdeteksi di ${payload.chapter_url} — perbaiki selector host ini di packages/sumber/selectors.js`,
    );
  }

  // URL ini berasal dari halaman yang sudah lolos allowlist, jadi CDN gambarnya
  // ikut dipercaya (localhost/IP privat tetap ditolak).
  const clean = imageUrls.map((url) => sanitizeSourceUrl(url, { anyPublicHost: true })).filter(Boolean);
  if (!clean.length) throw new Error('Semua URL gambar hasil ekstraksi tidak valid');

  // Simpan hasil ekstraksi supaya retry tidak perlu parse ulang dan UI tahu totalnya.
  // Payload lama WAJIB ikut disebar: paksa_ulang ada di sana, dan kalau hilang
  // di sini, percobaan kedua sebuah penggantian akan diam-diam memakai ulang
  // berkas lama.
  getDb()
    .prepare('UPDATE download_queue SET payload = ? WHERE id = ?')
    .run(
      JSON.stringify({ ...payload, image_urls: clean, extractor, host_fallbacks: hostFallbacks ?? {} }),
      job.id,
    );

  log.debug(`job ${job.id}: ${clean.length} gambar via ${extractor}`);
  return { urls: clean, referer: payload.chapter_url, cadangan: hostFallbacks ?? {}, paksaUlang };
};
