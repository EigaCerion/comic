/**
 * Bandingkan koleksi dengan halaman seri di situs sumber, lalu antrekan yang
 * belum ada — chapter baru rilis maupun nomor yang bolong.
 *
 * Inilah yang dijalankan tombol "Cek chapter baru", dan yang dipakai pengawas
 * untuk menuntaskan temuan berjenis 'gap'. Pemilihan SUMBER MANA yang dibaca
 * bukan urusan berkas ini: sumberService yang mencoba sumber satu per satu dan
 * menaikkan yang hidup jadi sumber aktif.
 */
import { getDb } from '../../db/index.js';
import { createLogger } from '../../utils/logger.js';
import { notFound } from '../../utils/validators.js';
import { fetchHtml } from '../../utils/httpClient.js';
import { extractSeriesLink } from '@naruread/sumber';
import '../../utils/sumberLogger.js';
import { ambilSeriDenganCadangan, catatSumber } from '../sumberService.js';
import { enqueueChapterDownload } from '../downloadService.js';

const log = createLogger('naruread:pengawas');


/**
 * Bandingkan koleksi kita dengan halaman seri di situs sumber, lalu antrekan
 * chapter yang belum ada — mencakup chapter baru rilis dan nomor yang bolong.
 */
export const resyncComic = async (comicId, { seriesUrl } = {}) => {
  const db = getDb();
  const comic = db.prepare('SELECT * FROM comics WHERE id = ?').get(comicId);
  if (!comic) throw notFound('Komik tidak ditemukan');

  let url = seriesUrl ?? comic.source_url;

  // Komik yang diimpor sebelum URL seri disimpan tidak punya acuan. Daripada
  // menyerah, halaman salah satu chapter dibaca untuk menemukan tautan balik
  // ke halaman serinya, lalu disimpan supaya sekali ini saja.
  if (!url) {
    const chapter = db
      .prepare(
        `SELECT source_url FROM chapters
          WHERE comic_id = ? AND source_url IS NOT NULL AND source_url != ''
          ORDER BY chapter_number LIMIT 1`,
      )
      .get(comicId);

    if (chapter?.source_url) {
      try {
        const halaman = await fetchHtml(chapter.source_url);
        const ditemukan = extractSeriesLink(halaman.html, halaman.finalUrl);
        if (ditemukan) {
          url = ditemukan;
          db.prepare('UPDATE comics SET source_url = ? WHERE id = ?').run(url, comicId);
          // Ikut dicatat sebagai sumber siap, bukan hanya ditulis ke kolom
          // comics: perpindahan otomatis berangkat dari tabel comic_sources,
          // dan alamat yang cuma hidup di kolom itu tidak punya riwayat
          // berhasil-gagal apa pun untuk diurutkan.
          try {
            catatSumber({ comicId, seriesUrl: url, status: 'siap' });
          } catch (galat) {
            log.debug(`URL seri ${comic.slug} tidak bisa dicatat sebagai sumber: ${galat.message}`);
          }
          log.info(`URL seri ${comic.slug} ditemukan otomatis: ${url}`);
        }
      } catch (error) {
        log.debug(`penemuan URL seri ${comic.slug} gagal: ${error.message}`);
      }
    }
  }

  // Sumber cadangan yang sudah disetujui membuat kolom source_url tidak lagi
  // menjadi syarat: komik yang sumber utamanya sudah mati dan dilepas tetap
  // punya jalan, selama ada satu saja sumber siap di comic_sources.
  const punyaCadangan =
    db.prepare("SELECT COUNT(*) AS n FROM comic_sources WHERE comic_id = ? AND status != 'calon'").get(comicId).n > 0;

  if (!url && !punyaCadangan) {
    return {
      comicId,
      error:
        'URL sumber tidak ketemu otomatis. Kirim series_url lewat tombol "Cek chapter baru", ' +
        'atau pakai "Cari sumber lain" di halaman komiknya.',
    };
  }

  /*
   * Pengambilan halaman seri diserahkan ke sumberService: ia yang mencoba
   * sumber satu per satu, mencatat mana yang hidup, dan menaikkan yang berhasil
   * jadi sumber aktif. Di sinilah "update gagal karena situsnya mati" berhenti
   * menjadi kegagalan — selama komik ini punya satu saja sumber lain yang
   * pernah disetujui.
   */
  const { series, finalUrl, berpindah } = await ambilSeriDenganCadangan(comicId, { seriesUrl: url ?? null });

  const punya = new Set(
    db
      .prepare('SELECT chapter_number FROM chapters WHERE comic_id = ? AND is_downloaded = 1')
      .all(comicId)
      .map((row) => row.chapter_number),
  );

  // Nomor yang bolong di koleksi TAPI juga tidak ada di sumbernya bukan cacat
  // kita — situsnya sendiri melompati nomor itu. Tanpa ini, temuannya menetap
  // selamanya dan tombol Perbaiki tidak akan pernah bisa menuntaskannya.
  const nomorSumber = new Set(series.chapters.map((chapter) => chapter.number));
  const gapMati = db
    .prepare("SELECT id, chapter_number FROM audit_findings WHERE comic_id = ? AND kind = 'gap' AND status != 'resolved'")
    .all(comicId)
    .filter((temuan) => !nomorSumber.has(temuan.chapter_number));

  gapMati.forEach((temuan) => {
    db.prepare(
      `UPDATE audit_findings
          SET status = 'resolved', resolved_at = datetime('now'),
              detail = 'nomor ini juga tidak ada di situs sumber — bukan chapter yang hilang'
        WHERE id = ?`,
    ).run(temuan.id);
  });
  if (gapMati.length > 0) {
    log.info(`${comic.slug}: ${gapMati.length} nomor bolong ditutup (memang tidak ada di sumber)`);
  }

  const queued = [];
  series.chapters
    .filter((chapter) => !punya.has(chapter.number))
    .forEach((chapter) => {
      try {
        const { job } = enqueueChapterDownload({
          comicId,
          chapterNumber: chapter.number,
          chapterTitle: chapter.title,
          chapterUrl: chapter.url,
          priority: 3,
        });
        queued.push(chapter.number);
        return job;
      } catch {
        return null; // sudah ada di antrian
      }
    });

  log.info(
    `resync ${comic.slug}: sumber ${series.chapters.length} chapter, koleksi ${punya.size}, diantre ${queued.length}`,
  );

  return {
    comicId,
    slug: comic.slug,
    diSumber: series.chapters.length,
    diKoleksi: punya.size,
    diantre: queued.length,
    gapDitutup: gapMati.length,
    chapterDiantre: queued.slice(0, 30),
    // Dilaporkan supaya layarnya bisa mengatakan "sumber berpindah ke X"
    // alih-alih diam. Perpindahan yang terjadi tanpa sepengetahuan siapa pun
    // adalah hal pertama yang akan dicurigai saat suatu hari chapter yang masuk
    // ternyata milik komik lain.
    sumberDipakai: finalUrl,
    berpindahSumber: berpindah,
  };
};
