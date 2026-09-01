#!/usr/bin/env node
// Verifikasi cepat: schema lengkap, FTS jalan, foreign key aktif.
import config from '../src/utils/config.js';
import { getDb, initSchema, closeDb } from '../src/db/index.js';

const REQUIRED = [
  'comics',
  'chapters',
  'pages',
  'reading_progress',
  'bookmarks',
  'download_queue',
  'comics_fts',
];

const db = initSchema(getDb());
const existing = new Set(
  db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table') ").all().map((r) => r.name),
);

let failed = false;
REQUIRED.forEach((table) => {
  const ok = existing.has(table);
  if (!ok) failed = true;
  console.log(`${ok ? '✅' : '❌'} tabel ${table}`);
});

const fk = db.pragma('foreign_keys', { simple: true });
console.log(`${fk ? '✅' : '❌'} foreign_keys aktif`);

const integrity = db.pragma('integrity_check', { simple: true });
console.log(`${integrity === 'ok' ? '✅' : '❌'} integrity_check: ${integrity}`);

try {
  db.prepare('SELECT rowid FROM comics_fts WHERE comics_fts MATCH ? LIMIT 1').get('"naru"*');
  console.log('✅ FTS5 query jalan');
} catch (error) {
  failed = true;
  console.log(`❌ FTS5 error: ${error.message}`);
}

console.log(`\ndatabase: ${config.dbPath}`);
closeDb();
process.exit(failed || integrity !== 'ok' ? 1 : 0);
