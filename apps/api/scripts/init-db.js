#!/usr/bin/env node
// Inisialisasi database + folder data.
//   node scripts/init-db.js           -> buat kalau belum ada (idempotent)
//   node scripts/init-db.js --force   -> HAPUS database lalu buat ulang
import fs from 'node:fs';
import config from '../src/utils/config.js';
import { getDb, initSchema, closeDb } from '../src/db/index.js';

const force = process.argv.includes('--force');

if (force) {
  closeDb();
  [config.dbPath, `${config.dbPath}-wal`, `${config.dbPath}-shm`].forEach((file) => {
    if (fs.existsSync(file)) {
      fs.rmSync(file);
      console.log(`  dihapus: ${file}`);
    }
  });
}

[config.dataDir, config.comicsDir, config.cacheDir, config.backupsDir].forEach((dir) => {
  fs.mkdirSync(dir, { recursive: true });
  console.log(`  folder siap: ${dir}`);
});

const db = initSchema(getDb());

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((row) => row.name);

console.log(`\n✅ Database siap: ${config.dbPath}`);
console.log(`   Tabel (${tables.length}): ${tables.join(', ')}`);
console.log(`   journal_mode = ${db.pragma('journal_mode', { simple: true })}`);
closeDb();
