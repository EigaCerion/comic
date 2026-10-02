import { extractSeries } from '@naruread/sumber';
import '../utils/sumberLogger.js';
import { getDb } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { ambilSeriUlet } from '../utils/ambilSeri.js';
import { badRequest, notFound, sanitizeSourceUrl } from '../utils/validators.js';

const log = createLogger('naruread:sumber');

/**
 * Sumber cadangan per komik: alamat halaman seri yang sama di situs lain.
 *
 * Masalah yang diselesaikan terjadi berulang kali dan selalu dengan cara yang
 * sama: situs sumber sebuah komik mati, lalu setiap "Cek chapter baru" untuk
 * komik itu gagal SELAMANYA — tidak ada chapter baru yang pernah masuk, dan
 * satu-satunya jalan keluar adalah pemiliknya mencari sendiri komik yang sama
 * di situs lain lalu menempelkan tautannya. Setiap kali. Untuk setiap komik.
 *
 * Yang ditambahkan di sini adalah ingatan. comics.source_url tetap menjadi
 * sumber yang SEDANG dipakai — seluruh kode lama membacanya dan tidak perlu
 * tahu berkas ini ada — sementara tabel comic_sources mencatat situs mana saja
 * yang pernah terbukti memuat komik ini. Saat yang aktif gagal, yang berikutnya
 * dicoba sendiri, dan yang berhasil naik menjadi aktif.
 *
 * Pembagian tugas yang disengaja:
 *   - BERPINDAH antar sumber yang sudah disetujui: otomatis penuh.
 *   - MENAMBAH sumber baru: dicari otomatis, dipasang hanya setelah disetujui.
 *
 * Batas itu bukan kehati-hatian berlebihan. Judul komik di situs sumber sering
 * nyaris sama satu sama lain — sekuel, spin-off, versi berwarna, dan judul
 * Inggris-vs-romaji untuk karya yang berbeda. Memasang yang salah berarti
 * chapter komik lain masuk ke koleksi yang sama, dan itu baru ketahuan saat
 * dibaca — setelah puluhan chapter telanjur terunduh.
 */

/* ── Judul ──────────────────────────────────────────────────────────── */

/*
 * Kata-kata yang muncul di judul HAMPIR SEMUA kartu di situs-situs ini dan
 * karena itu tidak membedakan apa pun. Dibiarkan ikut dihitung, dua komik yang
 * sama sekali tidak berhubungan tetap berbagi satu token "komik" dan skornya
 * terangkat — tepat di daerah ambang, tempat satu angka kecil menentukan
 * apakah kandidat yang salah ikut disodorkan.
 */
const KATA_UMUM = new Set(['komik', 'baca', 'manga', 'manhwa', 'manhua', 'bahasa', 'indonesia', 'id', 'sub']);

export const tokenJudul = (teks) =>
  String(teks ?? '')
    .toLowerCase()
    // Angka Romawi dan angka biasa DIPERTAHANKAN: "season 2" vs "season 3"
    // adalah dua komik berbeda, dan itu justru perbedaan yang paling sering
    // membedakan sekuel dari induknya.
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((kata) => kata && !KATA_UMUM.has(kata));

/**
 * Kemiripan dua judul, 0..1.
 *
 * Jaccard atas token, bukan jarak huruf: judul di situs sumber berbeda terutama
 * pada kata yang DITAMBAHKAN ("Komik X Bahasa Indonesia" vs "X"), bukan pada
 * ejaan. Jarak huruf menghukum penambahan itu sekeras salah ketik, padahal
 * hanya yang kedua yang berarti komiknya berbeda.
 *
 * Himpunan, bukan daftar: urutan kata antar situs tidak konsisten, dan
 * pengulangan kata tidak menambah informasi apa pun.
 */
export const kemiripanJudul = (a, b) => {
  const kiri = new Set(tokenJudul(a));
  const kanan = new Set(tokenJudul(b));
  if (kiri.size === 0 || kanan.size === 0) return 0;
  let sama = 0;
  kiri.forEach((kata) => {
    if (kanan.has(kata)) sama += 1;
  });
  return sama / (kiri.size + kanan.size - sama);
};

/**
 * Di bawah ini kandidat tidak pernah disodorkan sama sekali.
 *
 * Sengaja longgar (bukan 0,8) karena yang di baliknya BUKAN pemasangan
 * otomatis melainkan daftar yang masih harus disetujui orang: kandidat benar
 * yang tidak pernah muncul jauh lebih merugikan daripada kandidat salah yang
 * tinggal diabaikan. Yang dijaga ambang ini hanyalah agar daftarnya tidak
 * berisi seluruh hasil pencarian.
 */
export const AMBANG_MIRIP = 0.45;

/* ── Baris sumber ───────────────────────────────────────────────────── */

const hostDari = (url) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

const komikAtauGagal = (comicId) => {
  const comic = getDb().prepare('SELECT * FROM comics WHERE id = ?').get(Number(comicId));
  if (!comic) throw notFound('Komik tidak ditemukan');
  return comic;
};

const bentuk = (row, aktifUrl) => ({
  id: row.id,
  seriesUrl: row.series_url,
  host: row.host,
  status: row.status,
  aktif: row.series_url === aktifUrl,
  kemiripan: row.kemiripan,
  chapterTerakhir: row.chapter_terakhir,
  gagalBeruntun: row.gagal_beruntun ?? 0,
  lastError: row.last_error,
  lastOkAt: row.last_ok_at,
});

/**
 * Catat satu alamat sebagai sumber komik ini.
 *
 * Idempoten: alamat yang sudah tercatat tidak digandakan, dan statusnya hanya
 * boleh NAIK ('calon' → 'siap'), tidak pernah turun. Penemuan otomatis berjalan
 * berkali-kali untuk komik yang sama, dan tanpa aturan itu satu pencarian ulang
 * akan menurunkan kembali sumber yang sudah disetujui menjadi calon — lalu
 * perpindahan otomatis berhenti memakainya tanpa ada yang mengubah apa pun.
 */
export const catatSumber = ({ comicId, seriesUrl, status = 'calon', kemiripan = null, chapterTerakhir = null }) => {
  const url = sanitizeSourceUrl(seriesUrl);
  if (!url) {
    throw badRequest('URL ditolak. Tambahkan domainnya ke ALLOWED_SOURCE_DOMAINS di .env kalau memang ingin dipakai.');
  }
  const db = getDb();
  const ada = db.prepare('SELECT * FROM comic_sources WHERE comic_id = ? AND series_url = ?').get(comicId, url);

  if (ada) {
    const naik = ada.status === 'calon' && status === 'siap';
    db.prepare(
      `UPDATE comic_sources
          SET status = ?,
              kemiripan = COALESCE(?, kemiripan),
              chapter_terakhir = COALESCE(?, chapter_terakhir)
        WHERE id = ?`,
    ).run(naik ? 'siap' : ada.status, kemiripan, chapterTerakhir, ada.id);
    return db.prepare('SELECT * FROM comic_sources WHERE id = ?').get(ada.id);
  }

  const info = db
    .prepare(
      `INSERT INTO comic_sources (comic_id, series_url, host, status, kemiripan, chapter_terakhir)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(comicId, url, hostDari(url), status, kemiripan, chapterTerakhir);
  return db.prepare('SELECT * FROM comic_sources WHERE id = ?').get(info.lastInsertRowid);
};

/**
 * Pastikan sumber yang SEDANG aktif punya barisnya sendiri di tabel.
 *
 * Seluruh koleksi yang sudah ada lahir sebelum tabel ini, jadi comics.source_url
 * mereka tidak tercatat di mana pun. Tanpa penyeragaman ini, komik yang
 * sumbernya masih hidup tampil di layar seolah tidak punya sumber sama sekali,
 * dan perpindahan otomatis tidak punya titik berangkat.
 */
const seragamkan = (comic) => {
  if (!comic.source_url) return;
  const db = getDb();
  const ada = db
    .prepare('SELECT 1 FROM comic_sources WHERE comic_id = ? AND series_url = ?')
    .get(comic.id, comic.source_url);
  if (ada) return;
  // Lewat SQL langsung, bukan catatSumber(): alamat yang sudah dipakai koleksi
  // harus tetap tercatat apa adanya meski domainnya sejak itu dikeluarkan dari
  // ALLOWED_SOURCE_DOMAINS — kalau tidak, ia lenyap dari layar tanpa penjelasan
  // dan tidak bisa dihapus maupun diganti.
  db.prepare(
    `INSERT OR IGNORE INTO comic_sources (comic_id, series_url, host, status, last_ok_at)
     VALUES (?, ?, ?, 'siap', datetime('now'))`,
  ).run(comic.id, comic.source_url, hostDari(comic.source_url));
};

export const daftarSumber = (comicId) => {
  const comic = komikAtauGagal(comicId);
  seragamkan(comic);
  const rows = getDb()
    .prepare('SELECT * FROM comic_sources WHERE comic_id = ? ORDER BY id')
    .all(comic.id);
  return {
    comicId: comic.id,
    aktif: comic.source_url ?? null,
    items: rows.map((row) => bentuk(row, comic.source_url)),
  };
};

export const hapusSumber = ({ comicId, id }) => {
  const comic = komikAtauGagal(comicId);
  const row = getDb().prepare('SELECT * FROM comic_sources WHERE id = ? AND comic_id = ?').get(id, comic.id);
  if (!row) throw notFound('Sumber tidak ditemukan');
  getDb().prepare('DELETE FROM comic_sources WHERE id = ?').run(row.id);
  // Yang aktif ikut dilepas, kalau itu yang dibuang. Membiarkannya berarti
  // komik ini menunjuk alamat yang sudah tidak ada di daftar mana pun.
  if (row.series_url === comic.source_url) {
    getDb().prepare('UPDATE comics SET source_url = NULL WHERE id = ?').run(comic.id);
  }
  return { id: row.id, removed: 1 };
};

/** Setujui calon menjadi sumber yang boleh dipakai otomatis. */
export const setujuiSumber = ({ comicId, id, pakaiSekarang = false }) => {
  const comic = komikAtauGagal(comicId);
  const db = getDb();
  const row = db.prepare('SELECT * FROM comic_sources WHERE id = ? AND comic_id = ?').get(id, comic.id);
  if (!row) throw notFound('Sumber tidak ditemukan');

  db.prepare("UPDATE comic_sources SET status = 'siap', gagal_beruntun = 0, last_error = NULL WHERE id = ?").run(row.id);

  // Komik yang sumbernya sudah tidak ada sama sekali TIDAK perlu menunggu satu
  // kegagalan lagi sebelum memakai sumber yang baru disetujui.
  if (pakaiSekarang || !comic.source_url) {
    db.prepare('UPDATE comics SET source_url = ? WHERE id = ?').run(row.series_url, comic.id);
  }
  return daftarSumber(comic.id);
};

/* ── Perpindahan otomatis ───────────────────────────────────────────── */

/** Berapa kali gagal beruntun sebelum sebuah sumber dianggap mati. */
const BATAS_GAGAL = 4;

const catatBerhasil = (id, chapterTerakhir) =>
  getDb()
    .prepare(
      `UPDATE comic_sources
          SET gagal_beruntun = 0, last_error = NULL, last_ok_at = datetime('now'),
              chapter_terakhir = COALESCE(?, chapter_terakhir)
        WHERE id = ?`,
    )
    .run(chapterTerakhir, id);

const catatGagal = (id, pesan) => {
  const db = getDb();
  db.prepare(
    `UPDATE comic_sources
        SET gagal_beruntun = gagal_beruntun + 1, last_error = ?
      WHERE id = ?`,
  ).run(String(pesan ?? '').slice(0, 300), id);
  // 'mati' bukan penghapusan: sumber yang mati berbulan-bulan kadang hidup lagi,
  // dan yang dibuang di sini tidak bisa dihidupkan kembali tanpa pencarian dari
  // nol. Ia hanya turun ke urutan paling belakang.
  db.prepare("UPDATE comic_sources SET status = 'mati' WHERE id = ? AND gagal_beruntun >= ?").run(id, BATAS_GAGAL);
};

/**
 * Urutan percobaan: yang aktif dulu, lalu yang paling baru terbukti hidup.
 *
 * Yang berstatus 'calon' TIDAK ikut — itulah seluruh arti persetujuan. Yang
 * 'mati' ikut, tapi paling belakang: kalau semua yang lain gagal, mencoba yang
 * dulu pernah mati jauh lebih baik daripada menyerah.
 */
const urutanCoba = (comic) => {
  const rows = getDb().prepare("SELECT * FROM comic_sources WHERE comic_id = ? AND status != 'calon'").all(comic.id);
  const nilai = (row) => {
    if (row.series_url === comic.source_url) return 0;
    if (row.status === 'mati') return 2;
    return 1;
  };
  return rows.sort((a, b) => {
    const beda = nilai(a) - nilai(b);
    if (beda !== 0) return beda;
    return String(b.last_ok_at ?? '').localeCompare(String(a.last_ok_at ?? ''));
  });
};

/**
 * Ambil halaman seri komik ini — dari sumber mana pun yang masih hidup.
 *
 * @returns {Promise<{html:string, finalUrl:string, series:object, sumberId:number, berpindah:boolean}>}
 */
export const ambilSeriDenganCadangan = async (comicId, { seriesUrl = null } = {}) => {
  const comic = komikAtauGagal(comicId);
  seragamkan(comic);

  // Alamat yang dikirim tangan menang atas segalanya dan dicatat sebagai sumber
  // siap: orangnya baru saja menyatakan inilah yang benar.
  if (seriesUrl) catatSumber({ comicId: comic.id, seriesUrl, status: 'siap' });

  const kandidat = urutanCoba({ ...comic, source_url: seriesUrl ? sanitizeSourceUrl(seriesUrl) : comic.source_url });
  if (kandidat.length === 0) {
    throw badRequest('Komik ini belum punya satu pun sumber. Cari sumber lain, atau tempel URL serinya.');
  }

  const galat = [];
  for (const row of kandidat) {
    try {
      const { html, finalUrl } = await ambilSeriUlet(row.series_url, { percobaan: 2 });
      const series = extractSeries(html, finalUrl);

      /*
       * Halaman yang TERBUKA tapi tanpa satu pun chapter dihitung GAGAL.
       *
       * Situs yang sudah dijual atau kedaluwarsa hampir tidak pernah menjawab
       * galat jaringan: domainnya dijawab halaman parkir berisi iklan, dengan
       * status 200. Tanpa pemeriksaan ini, halaman itu lolos sebagai sukses,
       * sumbernya terus dianggap hidup, dan resync melaporkan "0 chapter baru"
       * setiap hari untuk komik yang sebenarnya sudah kehilangan sumbernya.
       */
      if (!series?.chapters?.length) throw new Error('halaman terbuka tapi tidak ada satu pun chapter terbaca');

      const tertinggi = series.chapters.reduce((maks, satu) => Math.max(maks, satu.number ?? 0), 0);
      catatBerhasil(row.id, tertinggi || null);

      const berpindah = finalUrl !== comic.source_url;
      if (berpindah) {
        getDb().prepare('UPDATE comics SET source_url = ? WHERE id = ?').run(finalUrl, comic.id);
        log.info(`${comic.slug}: sumber berpindah ke ${hostDari(finalUrl)} (${finalUrl})`);
      }

      return { html, finalUrl, series, sumberId: row.id, berpindah };
    } catch (error) {
      catatGagal(row.id, error.message);
      galat.push(`${row.host}: ${error.message}`);
      log.warn(`${comic.slug}: sumber ${row.host} gagal — ${error.message}`);
    }
  }

  throw badRequest(
    `Tidak ada sumber yang bisa dibaca untuk komik ini (${galat.join(' · ')}). ` +
      'Coba "Cari sumber lain" di halaman komiknya.',
  );
};

/* ── Penemuan ───────────────────────────────────────────────────────── */

/**
 * Cari komik ini di situs-situs lain yang kita dukung, lalu laporkan kandidat
 * terbaiknya — TANPA memasang apa pun.
 *
 * Mesin pencariannya dipakai ulang dari Scout (cariDiSumber), bukan ditulis
 * ulang: ia sudah memegang cache per host, penanganan situs yang tata letaknya
 * tidak terbaca, dan daftar host yang benar-benar punya halaman pencarian.
 * Impornya dinamis supaya tidak ada lingkaran modul — scoutService sendiri
 * mengimpor jalur impor yang nantinya akan membaca berkas ini.
 */
export const cariSumberLain = async (comicId) => {
  const comic = komikAtauGagal(comicId);
  seragamkan(comic);

  const { cariDiSumber } = await import('./scoutService.js');

  // Judul koleksi dipakai apa adanya sebagai kata kunci; itu nama yang dipilih
  // pemiliknya sendiri saat mengimpor, dan paling mendekati judul di situsnya.
  const hasil = await cariDiSumber({ q: comic.title }).catch((error) => {
    throw badRequest(`Pencarian gagal: ${error.message}`);
  });

  const db = getDb();
  const sudahAda = new Map(
    db
      .prepare('SELECT series_url, status FROM comic_sources WHERE comic_id = ?')
      .all(comic.id)
      .map((row) => [row.series_url, row.status]),
  );

  const kandidat = (hasil.items ?? [])
    .map((item) => ({
      seriesUrl: item.seriesUrl,
      host: item.sourceHost,
      judul: item.title,
      coverUrl: item.coverUrl,
      // bentukItem() di scoutService menaruhnya bersarang di latestChapter,
      // bukan sebagai bidang datar. Nomor ini bukan hiasan: ia yang menunjukkan
      // apakah kandidatnya benar-benar punya chapter yang kita cari, atau cuma
      // judul mirip dengan koleksi yang berhenti di chapter 3.
      chapterTerakhir: Number.isFinite(item.latestChapter?.number) ? item.latestChapter.number : null,
      kemiripan: Number(kemiripanJudul(comic.title, item.title).toFixed(3)),
      // Yang sudah tercatat tetap dilaporkan, tapi ditandai — supaya layarnya
      // bisa menjelaskan kenapa sebuah hasil tidak bisa ditambahkan lagi,
      // alih-alih diam-diam menghilangkannya dan terbaca sebagai hasil kurang.
      sudah: sudahAda.get(item.seriesUrl) ?? null,
    }))
    .filter((satu) => satu.seriesUrl && satu.kemiripan >= AMBANG_MIRIP)
    .sort((a, b) => b.kemiripan - a.kemiripan)
    .slice(0, 12);

  // Yang lolos ambang dicatat sebagai CALON, bukan dibiarkan hidup hanya di
  // jawaban ini: tanpa itu, menyetujui satu kandidat menuntut alamatnya dikirim
  // balik dari layar — dan alamat yang datang dari layar harus divalidasi ulang
  // sebagai masukan luar. Sebagai baris yang sudah tercatat, persetujuan cukup
  // menyebut id-nya.
  kandidat
    .filter((satu) => !satu.sudah)
    .forEach((satu) => {
      try {
        const row = catatSumber({
          comicId: comic.id,
          seriesUrl: satu.seriesUrl,
          status: 'calon',
          kemiripan: satu.kemiripan,
          chapterTerakhir: satu.chapterTerakhir,
        });
        satu.id = row.id;
        satu.sudah = 'calon';
      } catch (error) {
        // Domain di luar allowlist: dilaporkan, bukan didiamkan — itu setelan
        // yang bisa diperbaiki pemiliknya di .env.
        satu.ditolak = error.message;
      }
    });

  log.info(`cari sumber lain untuk ${comic.slug}: ${kandidat.length} kandidat di atas ambang`);
  return { comicId: comic.id, judul: comic.title, kandidat, sumber: hasil.sumber ?? [] };
};

export default {
  daftarSumber,
  catatSumber,
  hapusSumber,
  setujuiSumber,
  ambilSeriDenganCadangan,
  cariSumberLain,
  kemiripanJudul,
  tokenJudul,
  AMBANG_MIRIP,
};
