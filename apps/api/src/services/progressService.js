import { getDb } from '../db/index.js';
import { badRequest, notFound } from '../utils/validators.js';
import { touchComic } from './comicService.js';

/*
 * Riwayat baca dan bookmark adalah DATA PRIBADI.
 *
 * Sebelumnya kedua tabel tidak punya kolom pemilik, sehingga isinya jadi kolam
 * bersama: satu uji membuktikan tamu tanpa akun bisa membuat (201) dan menghapus
 * (200) bookmark milik orang lain, dan bisa menimpa posisi baca siapa pun.
 * Selama aplikasi hanya hidup di Wi-Fi rumah dengan satu pemakai itu tidak
 * terasa; begitu ia punya nama tetap yang bisa dijangkau lintas jaringan, itu
 * jadi lubang yang nyata.
 *
 * Sekarang setiap fungsi WAJIB menerima userId, dan setiap query menyaring
 * dengannya — termasuk penghapusan, supaya id milik orang lain tidak bisa
 * dihapus hanya dengan menebak angkanya.
 */

const wajibPemilik = (userId) => {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    // Bukan galat pengguna melainkan kesalahan pemanggilan: rute yang lupa
    // meneruskan identitas. Digagalkan keras supaya tidak diam-diam menulis
    // baris tanpa pemilik seperti dulu.
    throw new Error('progressService dipanggil tanpa userId — rute wajib meneruskan req.user.id');
  }
  return id;
};

/**
 * ISO dari klien -> bentuk yang sudah dipakai kolomnya, DI GARIS WAKTU SERVER.
 *
 * read_at diisi datetime('now'), yaitu 'YYYY-MM-DD HH:MM:SS' dalam UTC tanpa
 * zona. Menyimpan ISO penuh apa adanya akan merusak perbandingan: '2026-09-23T..'
 * > '2026-09-23 ..' secara string karena 'T' di atas spasi, jadi satu baris
 * ber-ISO akan selamanya mengalahkan semua baris lama. Diseragamkan di sini.
 *
 * Yang dipakai adalah UMUR kiriman, bukan waktu absolutnya. Baris dari web
 * berstempel jam server (datetime('now')), baris dari HP berstempel jam HP, dan
 * penjaga di bawah membandingkan keduanya. Jam PC rumahan biasa melenceng
 * puluhan detik; kalau jam server lebih maju, setiap perpindahan web -> HP di
 * dalam jendela selisih itu kalah dan posisi HP yang justru paling baru dibuang
 * tanpa satu pun galat yang terlihat. Menjepit hanya arah masa depan (seperti
 * dulu) tidak menolong, sebab arah yang merugikan justru jam HP yang TERTINGGAL.
 *
 * Maka klien mengirim dikirim_pada — jam HP saat paket itu berangkat — dan
 * selisihnya terhadap read_at (umurnya) dikurangkan dari jam server. Semua baris
 * jadi berada di satu garis waktu, dan meleset-tidaknya jam HP tidak lagi
 * menentukan siapa menang.
 *
 * Klien lama yang hanya mengirim read_at tetap dilayani dengan perilaku
 * sebelumnya, termasuk jepitan masa depannya: satu baris bertanggal tahun depan
 * akan mengunci chapter itu permanen — tidak ada bacaan berikutnya yang bisa
 * menimpanya lagi.
 */
/*
 * Ujung rentang tahun EMPAT DIGIT — satu-satunya rentang tempat
 * toISOString().slice(0, 19) benar-benar menghasilkan 'YYYY-MM-DD HH:MM:SS'.
 *
 * Number.isFinite saja tidak cukup: ia hanya menolak NaN, bukan tanggal yang
 * SAH tapi ekstrem. Dengan read_at '-271821-04-20T00:00:00.000Z' dan
 * dikirim_pada '+275760-09-13T00:00:00.000Z' — dua-duanya Date yang valid —
 * umurnya 1,7e16 ms, hasil pengurangannya jatuh di luar rentang Date, dan
 * toISOString() melempar RangeError. Lemparan itu bukan HttpError, jadi rutenya
 * membalas 500 dan mencatatnya sebagai galat server, padahal jalur validasi
 * tepat di sebelahnya rapi membalas 400.
 *
 * Yang kedua lebih sunyi dan justru lebih merusak: nilai yang masih di dalam
 * rentang Date tapi bertahun diperluas lolos TANPA lemparan, lalu slice(0, 19)
 * memotong '-196974-09-24T17:47:12.000Z' jadi '-196974-09-24 17:47' — detiknya
 * hilang, panjangnya beda dari semua baris lain, dan nilai cacat itu tersimpan
 * jadi pembanding read_at untuk selamanya.
 */
const MS_PALING_AWAL = -62167219200000; // 0000-01-01T00:00:00Z
const MS_PALING_AKHIR = 253402300799000; // 9999-12-31T23:59:59Z

const waktuKolom = (readAt, dikirimPada) => {
  if (readAt === undefined || readAt === null || readAt === '') return null;
  const ms = new Date(readAt).getTime();
  if (!Number.isFinite(ms)) throw badRequest('read_at harus waktu ISO yang sah');

  const kosong = dikirimPada === undefined || dikirimPada === null || dikirimPada === '';
  const msKirim = kosong ? null : new Date(dikirimPada).getTime();
  if (msKirim !== null && !Number.isFinite(msKirim)) throw badRequest('dikirim_pada harus waktu ISO yang sah');

  // Umur negatif berarti jam HP mundur di antara mencatat dan mengirim; dibaca
  // sebagai "barusan" karena kiriman itu memang tidak pernah menunggu lama.
  const pada = msKirim === null ? Math.min(ms, Date.now()) : Date.now() - Math.max(0, msKirim - ms);

  // DIBULATKAN ke detik terdekat, bukan dipotong. Kolomnya hanya berpresisi
  // detik sementara umur kiriman yang sehat tetap beberapa ratus milidetik
  // (jeda antara mencatat dan benar-benar berangkat, lalu transit). Dipotong,
  // kiriman berumur 200 ms mendarat di detik SEBELUM baris yang baru saja
  // ditulis server dan kalah dari bacaan yang justru lebih lama — persis
  // kekalahan senyap yang hendak dihilangkan.
  const bulat = Math.round(pada / 1000) * 1000;

  // Dijepit SESUDAH pembulatan, bukan sebelumnya: nilai setengah detik di bawah
  // ujung atas akan dibulatkan melewatinya dan lolos dari pemeriksaan yang
  // dipasang di depan. Bentuk perbandingannya sengaja negatif supaya NaN — yang
  // gagal pada perbandingan mana pun — ikut tertangkap di sini.
  if (!(bulat >= MS_PALING_AWAL && bulat <= MS_PALING_AKHIR)) {
    throw badRequest('read_at/dikirim_pada di luar rentang waktu yang wajar');
  }

  return new Date(bulat).toISOString().slice(0, 19).replace('T', ' ');
};

/** Simpan posisi baca terakhir (upsert per pemilik + comic + chapter). */
export const saveProgress = ({ userId, comicId, chapterId, lastPageRead, readAt, dikirimPada }) => {
  const pemilik = wajibPemilik(userId);
  const db = getDb();
  const chapter = db.prepare('SELECT * FROM chapters WHERE id = ? AND comic_id = ?').get(chapterId, comicId);
  if (!chapter) throw notFound('Chapter tidak ditemukan untuk komik ini');

  const page = Math.max(1, Number(lastPageRead) || 1);
  const percentage = chapter.total_pages > 0 ? Number(((page / chapter.total_pages) * 100).toFixed(2)) : 0;
  const waktu = waktuKolom(readAt, dikirimPada);

  /*
   * Kiriman yang tertunda boleh kalah, tidak boleh menang.
   *
   * Aplikasi Android menumpuk posisi baca selama tidak ada jaringan lalu
   * mengosongkan antrean begitu tersambung. Tanpa penjaga ini, bacaan pukul 9
   * yang baru terkirim pukul 11 akan MENIMPA posisi pukul 10 yang dibuat dari
   * web: pembacanya mundur sendiri ke chapter yang sudah dilewatinya, dan
   * karena penulisannya diam, tidak ada yang tahu kenapa.
   *
   * Penjaganya hanya dipasang kalau klien memang mengirim read_at. Tanpa itu
   * perilakunya tetap seperti dulu: jam server, selalu menimpa.
   *
   * Pembandingnya '>=', bukan '>'. Kolomnya hanya berpresisi DETIK, sementara
   * PosisiBacaApp menyimpan tiap 800 ms — dua posisi berturut-turut sering jatuh
   * di detik yang sama, dan dengan '>' yang kedua ditolak diam-diam. Rutenya
   * tetap menjawab 200 dan posisiBaca.js membuang entri itu dari antrean, jadi
   * tidak ada percobaan ulang: pembaca yang menutup chapter tepat sesudah
   * tabrakan itu meninggalkan posisi lama di server selamanya. Kiriman yang
   * datang belakangan dalam detik yang sama memang kebenaran terbaru; kiriman
   * basi berjam-jam tetap kalah karena detiknya berbeda jauh.
   *
   * IS NULL ikut diterima karena di SQLite pembandingan dengan NULL menghasilkan
   * NULL, bukan benar: satu baris warisan tanpa read_at akan terkunci selamanya
   * dan pemiliknya tidak akan pernah bisa memperbarui posisi bacanya lagi.
   *
   * Dan pembandingnya diberi TOLERANSI, bukan diadu mentah. Yang tersimpan di
   * kolom itu sebenarnya bukan waktu-baca melainkan waktu-baca DITAMBAH transit:
   * `pada` dihitung dari Date.now() saat paket TIBA dikurangi umur yang diukur
   * di HP, jadi umurnya habis dan yang tersisa justru waktu transit — yang tidak
   * dikompensasi sama sekali. Karena posisiBaca.js menyerialkan antreannya,
   * kiriman kedua baru berangkat sesudah jawaban kiriman pertama tiba, dan
   * kiriman pertama sesudah HP bangun harus melewati resolusi nama plus
   * handshake TCP sementara yang berikutnya jalan di koneksi yang sudah panas.
   * Selisih transit satu-dua detik itu hal biasa di Wi-Fi HP, dan tanpa
   * toleransi ia cukup untuk membuat posisi yang justru LEBIH BARU kalah:
   * halaman 12 yang dibaca 0,8 detik sesudah halaman 10 ditolak semata karena
   * transitnya 1,9 detik lebih cepat — 200 lagi, dibuang dari antrean lagi,
   * hilang lagi. Kiriman luring basi berjam-jam, yang justru jadi alasan penjaga
   * ini ada, tetap kalah telak oleh jendela sesempit ini.
   *
   * COALESCE-nya sebab yang sama dengan IS NULL di atas: datetime() membalas
   * NULL untuk stempel yang tidak bisa diurainya, dan satu baris cacat warisan
   * sudah cukup untuk mengunci chapter itu permanen. '' kalah dari stempel apa
   * pun, jadi baris seperti itu selalu bisa ditimpa lagi.
   */
  const info = db
    .prepare(
      `INSERT INTO reading_progress (user_id, comic_id, chapter_id, last_page_read, progress_percentage, read_at)
       VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
       ON CONFLICT(user_id, comic_id, chapter_id) DO UPDATE SET
         last_page_read = excluded.last_page_read,
         progress_percentage = excluded.progress_percentage,
         read_at = excluded.read_at
       ${
         waktu
           ? `WHERE reading_progress.read_at IS NULL
                 OR excluded.read_at >= COALESCE(datetime(reading_progress.read_at, '-15 seconds'), '')`
           : ''
       }`,
    )
    .run(pemilik, comicId, chapterId, page, percentage, waktu);

  const diterapkan = info.changes > 0;

  // Yang dikembalikan adalah isi baris yang BENAR-BENAR tersimpan, bukan yang
  // dikirim. Kalau kiriman kalah, klien perlu tahu posisi mana yang menang
  // supaya tidak menampilkan halaman yang tidak ada di server.
  const baris = db
    .prepare(
      `SELECT last_page_read, progress_percentage, read_at
         FROM reading_progress
        WHERE user_id = ? AND comic_id = ? AND chapter_id = ?`,
    )
    .get(pemilik, comicId, chapterId);

  /*
   * Komik tidak boleh naik ke urutan "terakhir dibaca" gara-gara kiriman basi
   * yang barusan ditolak: yang berubah cuma waktu sentuh, isinya tidak.
   *
   * Dan yang diteruskan adalah waktu baris yang benar-benar tersimpan, bukan
   * jam sekarang. Kiriman luring yang MENANG pun umurnya bisa dua hari: komik
   * yang dibaca di kereta hari Selasa akan melompat ke atas komik yang dibaca
   * dari web hari Rabu begitu antreannya terkirim hari Kamis, dan ComicCard
   * menulis "Dibaca baru saja" untuk bacaan dua hari lalu.
   */
  if (diterapkan) touchComic(comicId, baris?.read_at ?? null);

  return {
    comicId,
    chapterId,
    lastPageRead: baris?.last_page_read ?? page,
    progressPercentage: baris?.progress_percentage ?? percentage,
    readAt: baris?.read_at ?? null,
    diterapkan,
  };
};

export const getComicProgress = (comicId, userId) => {
  const pemilik = wajibPemilik(userId);
  return getDb()
    .prepare(
      `SELECT chapter_id, last_page_read, progress_percentage, read_at
         FROM reading_progress
        WHERE comic_id = ? AND user_id = ?
        ORDER BY read_at DESC`,
    )
    .all(comicId, pemilik)
    .map((row) => ({
      chapterId: row.chapter_id,
      lastPageRead: row.last_page_read,
      progressPercentage: row.progress_percentage,
      readAt: row.read_at,
    }));
};

export const listBookmarks = ({ comicId, userId } = {}) => {
  const pemilik = wajibPemilik(userId);
  const db = getDb();

  const dasar = `SELECT b.*, c.title AS comic_title, c.slug AS comic_slug, ch.chapter_number
                   FROM bookmarks b
                   JOIN comics c ON c.id = b.comic_id
                   JOIN chapters ch ON ch.id = b.chapter_id
                  WHERE b.user_id = ?`;

  const rows = comicId
    ? db.prepare(`${dasar} AND b.comic_id = ? ORDER BY b.created_at DESC`).all(pemilik, comicId)
    : db.prepare(`${dasar} ORDER BY b.created_at DESC LIMIT 200`).all(pemilik);

  return rows.map((row) => ({
    id: row.id,
    comicId: row.comic_id,
    comicTitle: row.comic_title,
    comicSlug: row.comic_slug,
    chapterId: row.chapter_id,
    chapterNumber: row.chapter_number,
    pageNumber: row.page_number,
    note: row.note,
    createdAt: row.created_at,
  }));
};

export const addBookmark = ({ userId, comicId, chapterId, pageNumber, note }) => {
  const pemilik = wajibPemilik(userId);
  const db = getDb();
  const info = db
    .prepare('INSERT INTO bookmarks (user_id, comic_id, chapter_id, page_number, note) VALUES (?, ?, ?, ?, ?)')
    .run(pemilik, comicId, chapterId, pageNumber ?? null, note?.trim() || null);
  return listBookmarks({ comicId, userId: pemilik }).find((b) => b.id === Number(info.lastInsertRowid));
};

export const deleteBookmark = (id, userId) => {
  const pemilik = wajibPemilik(userId);
  // Pemilik ikut jadi syarat, bukan hanya id. Tanpa itu, menebak angka id sudah
  // cukup untuk menghapus bookmark orang lain.
  const info = getDb().prepare('DELETE FROM bookmarks WHERE id = ? AND user_id = ?').run(id, pemilik);
  if (info.changes === 0) throw notFound('Bookmark tidak ditemukan');
  return { id: Number(id) };
};

export default { saveProgress, getComicProgress, listBookmarks, addBookmark, deleteBookmark };
