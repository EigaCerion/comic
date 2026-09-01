#!/usr/bin/env node
// Uji logika bot pengawas terhadap berkas nyata di folder sementara.
// Tidak menyentuh database maupun jaringan.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { verifyPageFile, gapsFromNumbers } from '../src/services/auditService.js';

let failed = 0;

const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? '✅' : '❌'} ${label}`);
  if (!ok) {
    console.log(`   diharapkan: ${JSON.stringify(expected)}`);
    console.log(`   didapat   : ${JSON.stringify(actual)}`);
  }
};

const TMP = path.join(os.tmpdir(), `naruread-audit-${process.pid}`);
await fs.mkdir(TMP, { recursive: true });

// ── Berkas utuh ──────────────────────────────────────────────────────────
const utuh = path.join(TMP, '001.webp');
await sharp({ create: { width: 40, height: 60, channels: 3, background: '#123456' } })
  .webp()
  .toFile(utuh);
const hasilUtuh = await verifyPageFile(utuh);
check('halaman utuh dinyatakan ok', hasilUtuh.ok, true);

// ── Berkas kosong (disk penuh / proses mati saat menulis) ────────────────
const kosong = path.join(TMP, '002.webp');
await fs.writeFile(kosong, '');
check('berkas 0 byte terdeteksi', (await verifyPageFile(kosong)).kind, 'size_zero');

// ── Berkas terpotong / bukan gambar (koneksi putus di tengah) ────────────
const rusak = path.join(TMP, '003.webp');
await fs.writeFile(rusak, Buffer.from('<html>504 Gateway Timeout</html>'));
check('berkas bukan gambar terdeteksi', (await verifyPageFile(rusak)).kind, 'corrupt_file');

// ── Berkas hilang ───────────────────────────────────────────────────────
check(
  'berkas hilang terdeteksi',
  (await verifyPageFile(path.join(TMP, 'tidak-ada.webp'))).kind,
  'missing_file',
);

// ── Berkas .part tidak pernah dianggap halaman ──────────────────────────
// Penulisan atomik menyisakan .part kalau proses mati; nama berkas halaman
// tetap belum ada, jadi pemulihan akan mengunduh ulang halaman itu.
await fs.writeFile(path.join(TMP, '004.webp.part'), Buffer.from([0xff, 0xd8, 0xff]));
check(
  'berkas .part tidak dianggap halaman jadi',
  (await verifyPageFile(path.join(TMP, '004.webp'))).kind,
  'missing_file',
);

// ── Deteksi nomor bolong ────────────────────────────────────────────────
check('nomor bolong sederhana', gapsFromNumbers([1, 2, 4, 5]), [3]);
check('beberapa nomor bolong', gapsFromNumbers([1, 5]), [2, 3, 4]);
check('tanpa bolong', gapsFromNumbers([1, 2, 3]), []);
check('nomor desimal tidak dianggap bolong', gapsFromNumbers([1, 1.5, 2]), []);
check('deret terlalu pendek', gapsFromNumbers([7]), []);

await fs.rm(TMP, { recursive: true, force: true });

console.log(failed === 0 ? '\n✅ Semua pemeriksaan pengawas lolos' : `\n❌ ${failed} pemeriksaan gagal`);
process.exit(failed === 0 ? 0 : 1);
