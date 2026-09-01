#!/usr/bin/env node
// Isi poster untuk komik yang belum punya cover, memakai halaman pertama
// chapter paling awal. Tidak menyentuh jaringan dan tidak menimpa cover
// yang sudah ada.
import { getDb, initSchema, closeDb } from '../src/db/index.js';
import { setCoverFromFirstPage } from '../src/services/coverService.js';

initSchema(getDb());

const targets = getDb()
  .prepare(
    `SELECT c.id, c.title, c.slug
       FROM comics c
      WHERE (c.cover_image IS NULL OR c.cover_image = '')
        AND EXISTS (SELECT 1 FROM chapters ch WHERE ch.comic_id = c.id AND ch.is_downloaded = 1)
      ORDER BY c.title COLLATE NOCASE`,
  )
  .all();

if (targets.length === 0) {
  console.log('✅ Semua komik yang punya halaman tersimpan sudah bercover.');
  closeDb();
  process.exit(0);
}

console.log(`\n🖼️  ${targets.length} komik tanpa cover — membuat dari halaman pertama:\n`);

let ok = 0;
for (const comic of targets) {
  try {
    const updated = await setCoverFromFirstPage(comic.id);
    ok += 1;
    console.log(`   ✅ ${comic.title} -> ${updated.coverUrl}`);
  } catch (error) {
    console.log(`   ❌ ${comic.title}: ${error.message}`);
  }
}

console.log(`\nSelesai: ${ok}/${targets.length} cover dibuat.`);
closeDb();
