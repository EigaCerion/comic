import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('naruread:db');

let instance = null;

const applyPragmas = (db) => {
  db.pragma('journal_mode = WAL');       // concurrency: API + worker bisa jalan bareng
  db.pragma('synchronous = NORMAL');     // balance aman vs cepat
  db.pragma('cache_size = -20000');      // ~20MB
  db.pragma('temp_store = MEMORY');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
};

/** Buka (atau ambil) koneksi database. Sinkron — better-sqlite3. */
export const getDb = () => {
  if (instance) return instance;

  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  instance = new Database(config.dbPath, { timeout: 5000 });
  applyPragmas(instance);
  log.debug(`database dibuka: ${config.dbPath}`);
  return instance;
};

/** Jalankan schema.sql (idempotent). */
/**
 * Kolom yang ditambahkan setelah rilis pertama. SQLite tidak punya
 * "ADD COLUMN IF NOT EXISTS", jadi keberadaannya diperiksa lewat PRAGMA.
 */
const MIGRATIONS = [
  // URL halaman seri: dipakai pengawas untuk mencocokkan chapter kita dengan sumber.
  { table: 'comics', column: 'source_url', type: 'TEXT' },
  // Kapan chapter terakhir diperiksa pengawas — supaya sapuan berikutnya hanya
  // menyentuh yang belum atau berubah, bukan seluruh koleksi.
  { table: 'chapters', column: 'audited_at', type: 'TIMESTAMP' },
  // Pemilik data pribadi. Sebelum ini keduanya adalah kolam bersama: siapa pun
  // yang bisa menjangkau aplikasi — bahkan tanpa akun — melihat dan menimpa
  // riwayat baca serta bookmark milik orang lain.
  { table: 'reading_progress', column: 'user_id', type: 'INTEGER' },
  { table: 'bookmarks', column: 'user_id', type: 'INTEGER' },
];

/**
 * Data lama tidak punya pemilik. Diserahkan ke super admin paling awal —
 * satu-satunya pemilik yang masuk akal untuk koleksi yang sudah ada.
 */
const wariskanDataLama = (db) => {
  const pemilik = db
    .prepare("SELECT id FROM users WHERE role = 'super_admin' ORDER BY id LIMIT 1")
    .get();
  if (!pemilik) return; // akun belum disiapkan — biarkan sampai restart berikutnya

  ['reading_progress', 'bookmarks'].forEach((tabel) => {
    const info = db.prepare(`UPDATE ${tabel} SET user_id = ? WHERE user_id IS NULL`).run(pemilik.id);
    if (info.changes > 0) {
      log.info(`migrasi: ${info.changes} baris ${tabel} diwariskan ke akun #${pemilik.id}`);
    }
  });
};

/**
 * UNIQUE(comic_id, chapter_id) harus jadi UNIQUE(user_id, comic_id, chapter_id).
 *
 * Tanpa ini, dua akun yang membaca chapter yang sama akan bertabrakan: yang
 * kedua menimpa posisi baca yang pertama. SQLite tidak bisa mengubah constraint
 * di tempat, jadi tabelnya dibangun ulang — dijalankan sekali dan idempoten.
 */
const bangunUlangReadingProgress = (db) => {
  const meta = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'reading_progress'")
    .get();
  if (!meta?.sql || /UNIQUE\s*\(\s*user_id/i.test(meta.sql)) return; // sudah benar

  const jalankan = db.transaction(() => {
    db.exec(`
      CREATE TABLE reading_progress_baru (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        comic_id INTEGER NOT NULL,
        chapter_id INTEGER NOT NULL,
        last_page_read INTEGER DEFAULT 1,
        progress_percentage REAL DEFAULT 0,
        read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(comic_id) REFERENCES comics(id) ON DELETE CASCADE,
        FOREIGN KEY(chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
        UNIQUE(user_id, comic_id, chapter_id)
      );
    `);
    db.exec(`
      INSERT INTO reading_progress_baru
        (id, user_id, comic_id, chapter_id, last_page_read, progress_percentage, read_at)
      SELECT id, user_id, comic_id, chapter_id, last_page_read, progress_percentage, read_at
        FROM reading_progress;
    `);
    db.exec('DROP TABLE reading_progress;');
    db.exec('ALTER TABLE reading_progress_baru RENAME TO reading_progress;');
    db.exec('CREATE INDEX IF NOT EXISTS idx_reading_progress_comic ON reading_progress(comic_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_reading_progress_read_at ON reading_progress(read_at DESC);');
  });

  const sebelum = db.prepare('SELECT COUNT(*) n FROM reading_progress').get().n;
  jalankan();
  const sesudah = db.prepare('SELECT COUNT(*) n FROM reading_progress').get().n;
  log.info(`migrasi: reading_progress dibangun ulang dengan pemilik (${sebelum} -> ${sesudah} baris)`);
};

/**
 * Etalase sumber (panel Scout): salinan hasil pindaian halaman depan situs
 * sumber, bukan sumber kebenaran. Kolom apa pun boleh ditimpa pindaian
 * berikutnya, dan satu-satunya yang dijaga adalah "satu baris per komik per
 * situs" lewat UNIQUE(source_host, series_url).
 *
 * Tabelnya dibuat di sini, bukan di schema.sql, karena ia lahir setelah rilis
 * pertama — sama alasannya dengan MIGRATIONS di atas: basis data yang sudah
 * berisi koleksi harus ikut mendapatkannya tanpa dibangun ulang.
 */
const buatTabelScout = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scout_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_host TEXT NOT NULL,
      series_url TEXT NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      cover_url TEXT,
      genre TEXT,
      tipe TEXT,
      bagian TEXT NOT NULL,          -- terbaru | baru, sesuai bagian di halaman depan
      latest_chapter_number REAL,
      latest_chapter_title TEXT,
      latest_chapter_url TEXT,
      updated_text TEXT,             -- apa adanya dari situs, mis. "2 menit lalu"
      updated_at TEXT,
      scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source_host, series_url)
    );
    CREATE INDEX IF NOT EXISTS idx_scout_bagian ON scout_items(bagian);
    CREATE INDEX IF NOT EXISTS idx_scout_slug ON scout_items(slug);
  `);
};

const applyMigrations = (db) => {
  MIGRATIONS.forEach(({ table, column, type }) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (columns.some((c) => c.name === column)) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    log.info(`migrasi: kolom ${table}.${column} ditambahkan`);
  });
};

/**
 * Indeks yang kolomnya sudah menjadi awalan indeks UNIQUE di tabel yang sama.
 * Tidak mempercepat kueri apa pun, hanya memperlambat setiap INSERT dan
 * memakan ruang (idx_pages_chapter saja ~4 MB). Dibuang dari basis data lama;
 * schema.sql tidak lagi membuatnya.
 */
const INDEKS_DOBEL = ['idx_pages_chapter', 'idx_chapters_comic', 'idx_reading_progress_user', 'idx_ratings_comic'];

const buangIndeksDobel = (db) => {
  INDEKS_DOBEL.forEach((nama) => {
    const ada = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(nama);
    if (!ada) return;
    db.exec(`DROP INDEX ${nama}`);
    log.info(`migrasi: indeks dobel ${nama} dibuang`);
  });
};

export const initSchema = (db = getDb()) => {
  const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(sql);
  applyMigrations(db);
  buatTabelScout(db);
  bangunUlangReadingProgress(db);
  buangIndeksDobel(db);
  wariskanDataLama(db);
  return db;
};

export const closeDb = () => {
  if (instance) {
    instance.close();
    instance = null;
  }
};

export const vacuum = (db = getDb()) => db.exec('VACUUM');
export const analyze = (db = getDb()) => db.exec('ANALYZE');

export default { getDb, initSchema, closeDb, vacuum, analyze };
