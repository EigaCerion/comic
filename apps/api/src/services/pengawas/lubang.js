/**
 * Deteksi nomor chapter yang BOLONG di sebuah koleksi.
 *
 * Terpisah dari pemeriksaan berkas karena jenis cacatnya memang berbeda: yang
 * lain menanyakan "apakah chapter ini utuh", yang ini menanyakan "apakah ada
 * chapter yang tidak pernah ada sama sekali". gapsFromNumbers() sengaja fungsi
 * murni tanpa database supaya bisa diuji langsung (scripts/test-audit.js).
 */
import { getDb } from '../../db/index.js';

/**
 * Nomor bulat yang hilang di antara deret yang dimiliki (1,2,4 -> 3).
 * Dipisah dari database supaya bisa diuji langsung.
 */
export const gapsFromNumbers = (numbers) => {
  if (!Array.isArray(numbers) || numbers.length < 2) return [];
  const whole = new Set(numbers.filter(Number.isInteger));
  const gaps = [];
  const max = Math.max(...numbers);
  for (let n = Math.ceil(Math.min(...numbers)); n <= max; n += 1) {
    if (!whole.has(n)) gaps.push(n);
  }
  return gaps;
};

/** Nomor chapter yang hilang di koleksi sebuah komik. */
export const findGaps = (comicId) =>
  gapsFromNumbers(
    getDb()
      .prepare('SELECT chapter_number FROM chapters WHERE comic_id = ? ORDER BY chapter_number')
      .all(comicId)
      .map((row) => row.chapter_number),
  );
