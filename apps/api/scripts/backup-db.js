#!/usr/bin/env node
// Backup database ke data/backups/database-backup-YYYY-MM-DD.db
// Pakai API backup SQLite (aman walau ada koneksi lain yang menulis).
import fs from 'node:fs';
import path from 'node:path';
import config from '../src/utils/config.js';
import { getDb, closeDb } from '../src/db/index.js';

fs.mkdirSync(config.backupsDir, { recursive: true });

const stamp = new Date().toISOString().slice(0, 10);
let target = path.join(config.backupsDir, `database-backup-${stamp}.db`);
let n = 2;
while (fs.existsSync(target)) {
  target = path.join(config.backupsDir, `database-backup-${stamp}-${n++}.db`);
}

const db = getDb();
await db.backup(target);
const { size } = fs.statSync(target);

console.log(`✅ Backup selesai: ${target} (${(size / 1024 / 1024).toFixed(2)} MB)`);
closeDb();
