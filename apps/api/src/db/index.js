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
];

const applyMigrations = (db) => {
  MIGRATIONS.forEach(({ table, column, type }) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (columns.some((c) => c.name === column)) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    log.info(`migrasi: kolom ${table}.${column} ditambahkan`);
  });
};

export const initSchema = (db = getDb()) => {
  const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(sql);
  applyMigrations(db);
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
