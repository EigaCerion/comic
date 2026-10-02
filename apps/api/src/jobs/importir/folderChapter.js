/**
 * Isi folder chapter di disk: memasang halaman pengganti, dan membersihkan sisa
 * folder komik yang sudah dihapus.
 *
 * Keduanya di sini karena keduanya menyentuh DISK, bukan database — dan
 * keduanya adalah tempat kerusakan yang tidak bisa dibatalkan pernah terjadi.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDb } from '../../db/index.js';
import config from '../../utils/config.js';
import { safeJoin } from '../../utils/validators.js';
import { chapterDir, replacePages } from '../../services/chapterService.js';

// Nama berkas halaman buatan compressToFile: 001.webp, atau 001.jpg/.avif/...
// saat byte aslinya disimpan apa adanya.
const POLA_BERKAS_HALAMAN = /^\d{3,}\.(webp|jpe?g|png|avif|gif)$/i;
export const SUBFOLDER_GANTI = '.ganti';
export const SUBFOLDER_LAMA = '.lama';

/**
 * Pasang halaman pengganti dengan cara yang bisa dipulihkan.
 *
 * Menimpa berkas satu per satu lalu baru memperbarui tabel pages meninggalkan
 * celah: kalau replacePages gagal (mis. database terkunci), folder sudah berisi
 * halaman baru sementara tabel masih mencatat daftar lama — pembaca melihat
 * separuh chapter dari situs baru disambung separuh dari situs lama. Karena itu
 * seluruh halaman lama dipindah ke subfolder .lama lebih dulu. Kalau pemasangan
 * atau pencatatan gagal, halaman baru dibuang dan halaman lama dikembalikan
 * utuh. Ini melindungi dari galat, bukan dari listrik padam; untuk kasus itu
 * .lama tetap tertinggal dan bisa dikembalikan manual.
 *
 * Seluruh halaman lama ikut dibuang saat berhasil, bukan hanya yang tertimpa:
 * sumber pengganti jarang punya jumlah halaman yang sama (69 lawan 35), dan
 * ekstensinya pun bisa beda — 032.jpg lama tidak boleh tertinggal di samping
 * 032.webp yang baru.
 */
export const pasangHasilGanti = async (dir, dirGanti, chapterId, pages) => {
  const dirLama = path.join(dir, SUBFOLDER_LAMA);
  await fs.rm(dirLama, { recursive: true, force: true });
  await fs.mkdir(dirLama, { recursive: true });

  const lama = (await fs.readdir(dir, { withFileTypes: true }))
    .filter((entri) => entri.isFile() && POLA_BERKAS_HALAMAN.test(entri.name))
    .map((entri) => entri.name);
  const dipindahkan = [];
  const dipasang = [];

  try {
    for (const nama of lama) {
      await fs.rename(path.join(dir, nama), path.join(dirLama, nama));
      dipindahkan.push(nama);
    }
    for (const page of pages) {
      await fs.rename(path.join(dirGanti, page.filename), path.join(dir, page.filename));
      dipasang.push(page.filename);
    }
    replacePages(chapterId, pages);
  } catch (error) {
    for (const nama of dipasang) await fs.rm(path.join(dir, nama), { force: true });
    for (const nama of dipindahkan) await fs.rename(path.join(dirLama, nama), path.join(dir, nama));
    await fs.rm(dirLama, { recursive: true, force: true });
    await fs.rm(dirGanti, { recursive: true, force: true });
    throw error;
  }
  return lama.length;
};

/**
 * Buang tulisan job yang chapternya dihapus di tengah unduhan. Folder hanya
 * dibuang kalau memang tidak ada lagi yang memilikinya: komik dengan slug yang
 * sama bisa saja sudah diimpor ulang sebelum job lama ini selesai.
 */
export const buangSisaTerhapus = async (comicSlug, chapterSlug) => {
  const db = getDb();
  const chapterMasihDimiliki = db
    .prepare('SELECT 1 FROM chapters ch JOIN comics c ON c.id = ch.comic_id WHERE c.slug = ? AND ch.slug = ?')
    .get(comicSlug, chapterSlug);
  if (!chapterMasihDimiliki) await fs.rm(chapterDir(comicSlug, chapterSlug), { recursive: true, force: true });
  if (!db.prepare('SELECT 1 FROM comics WHERE slug = ?').get(comicSlug)) {
    await fs.rm(safeJoin(config.comicsDir, comicSlug), { recursive: true, force: true });
  }
};
