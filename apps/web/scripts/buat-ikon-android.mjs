#!/usr/bin/env node
/**
 * Ikon launcher Android dibuat dari public/favicon.svg.
 *
 * Template Capacitor datang dengan ikon Capacitor bawaan. Kalau dibiarkan,
 * yang terpasang di HP adalah logo orang lain — dan ikonnya PNG, jadi tidak
 * ada cara memperbaikinya selain menggambar ulang. Berkas ini menaruh sumber
 * kebenarannya di satu tempat yang sudah ada: favicon yang dipakai web.
 *
 * Android meminta dua bentuk yang berbeda:
 *
 *  - ic_launcher / ic_launcher_round — ikon lawas, seluruh kotak terlihat.
 *  - ic_launcher_foreground — lapisan depan ikon adaptif. Kanvasnya 108dp
 *    tetapi peluncur boleh memotongnya jadi lingkaran, kotak bulat, atau
 *    bentuk lain, dan ia ikut bergeser saat ikon dianimasikan. Hanya 72dp di
 *    tengah yang dijamin selalu terlihat. Karena itu gambarnya ditaruh pada
 *    dua pertiga kanvas, bukan memenuhinya: kalau tidak, cincin oranyenya
 *    terpotong di sebagian besar HP.
 *
 * Warna latar ikon adaptif ikut disetel ke latar favicon. Bawaannya putih, dan
 * putih di sekeliling kotak gelap favicon terbaca sebagai bingkai yang salah
 * cetak.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const AKAR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUMBER = path.join(AKAR, 'public', 'favicon.svg');
const RES = path.join(AKAR, 'android', 'app', 'src', 'main', 'res');

/** Latar kotak favicon (night.DEFAULT di tailwind.config.js). */
const WARNA_LATAR = '#0f1419';

const KEPADATAN = [
  { nama: 'mdpi', ikon: 48, depan: 108 },
  { nama: 'hdpi', ikon: 72, depan: 162 },
  { nama: 'xhdpi', ikon: 96, depan: 216 },
  { nama: 'xxhdpi', ikon: 144, depan: 324 },
  { nama: 'xxxhdpi', ikon: 192, depan: 432 },
];

/** Bagian kanvas ikon adaptif yang dijamin tidak terpotong: 72dp dari 108dp. */
const ZONA_AMAN = 2 / 3;

const main = async () => {
  // SVG dirender SEKALI pada 1024px, lalu semua ukuran diperkecil dari sana.
  // Merender ulang per ukuran sama benarnya, tapi density rendah membuat
  // mdpi (48px) kehilangan ketebalan garis cincin — memperkecil dari raster
  // besar mempertahankannya lewat penghalusan.
  const dasar = await sharp(SUMBER, { density: 1152 }) // 72dpi × 16 → 64 × 16
    .resize(1024, 1024)
    .png()
    .toBuffer();

  for (const { nama, ikon, depan } of KEPADATAN) {
    const dir = path.join(RES, `mipmap-${nama}`);
    await mkdir(dir, { recursive: true });

    const kotak = await sharp(dasar).resize(ikon, ikon).png().toBuffer();
    await writeFile(path.join(dir, 'ic_launcher.png'), kotak);
    // Versi bulat memakai gambar yang sama: Android sendiri yang memotongnya,
    // dan sudut kotak favicon memang sudah membulat.
    await writeFile(path.join(dir, 'ic_launcher_round.png'), kotak);

    const sisiIsi = Math.round(depan * ZONA_AMAN);
    const isi = await sharp(dasar).resize(sisiIsi, sisiIsi).png().toBuffer();
    await sharp({
      create: {
        width: depan,
        height: depan,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: isi, gravity: 'center' }])
      .png()
      .toFile(path.join(dir, 'ic_launcher_foreground.png'));

    console.log(`mipmap-${nama}: ${ikon}px ikon, ${depan}px depan (isi ${sisiIsi}px)`);
  }

  const nilai = path.join(RES, 'values', 'ic_launcher_background.xml');
  await writeFile(
    nilai,
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${WARNA_LATAR}</color>\n</resources>\n`,
  );
  console.log(`values/ic_launcher_background.xml: ${WARNA_LATAR}`);
};

main().catch((galat) => {
  console.error('Gagal membuat ikon:', galat.message);
  process.exitCode = 1;
});
