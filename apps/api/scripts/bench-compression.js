#!/usr/bin/env node
// Ukur pipeline kompresi: ukuran berkas, waktu, dan seberapa jauh hasilnya
// menyimpang dari sumber (MAE = rata-rata selisih nilai pixel, skala 0-255).
// Halaman uji dibuat menyerupai halaman komik: garis hitam di latar putih,
// disajikan sebagai JPEG berwarna seperti yang umum dikirim situs sumber.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const TMP = path.join(os.tmpdir(), `naruread-bench-${Date.now()}`);
const PAGES = 8;
const W = 1600;
const H = 2400;

const makePage = (seed) => {
  const panels = Array.from({ length: 6 }, (_v, i) => {
    const y = 80 + i * 380;
    const x = 60 + ((seed * 37 + i * 53) % 120);
    return `
      <rect x="${x}" y="${y}" width="${W - x * 2}" height="330" fill="#ffffff" stroke="#111111" stroke-width="6"/>
      <path d="M${x + 40},${y + 250} C${x + 300},${y + 40} ${x + 700},${y + 300} ${W - x - 60},${y + 90}"
            fill="none" stroke="#111111" stroke-width="${3 + (i % 3)}"/>
      <circle cx="${x + 220}" cy="${y + 150}" r="70" fill="none" stroke="#111111" stroke-width="5"/>
      <text x="${x + 420}" y="${y + 170}" font-family="sans-serif" font-size="42" fill="#111111">
        panel ${i + 1} — seed ${seed}
      </text>
      <rect x="${x + 40}" y="${y + 40}" width="140" height="60" fill="#111111" opacity="0.85"/>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="100%" height="100%" fill="#f7f7f5"/>${panels}</svg>`;
};

/** MAE terhadap sumber, dihitung pada grayscale ukuran tetap. */
const meanAbsError = async (aBuffer, bBuffer) => {
  const raw = (buffer) =>
    sharp(buffer).resize(800, 1200, { fit: 'fill' }).grayscale().raw().toBuffer();
  const [a, b] = await Promise.all([raw(aBuffer), raw(bBuffer)]);
  let sum = 0;
  let max = 0;
  for (let i = 0; i < a.length; i += 1) {
    const delta = Math.abs(a[i] - b[i]);
    sum += delta;
    if (delta > max) max = delta;
  }
  return { mae: sum / a.length, max };
};

// Tiap knob diuji terpisah supaya jelas mana yang menghemat dan mana yang mahal.
const VARIANTS = {
  'A. q75 effort4 warna      (baseline)': (pipeline) =>
    pipeline.webp({ quality: 75, alphaQuality: 75, effort: 4 }),
  'B. q75 effort4 grayscale': (pipeline) =>
    pipeline.grayscale().webp({ quality: 75, alphaQuality: 75, effort: 4, smartSubsample: true }),
  'C. q75 effort6 warna': (pipeline) =>
    pipeline.webp({ quality: 75, alphaQuality: 75, effort: 6, smartSubsample: true }),
  'D. q80 effort4 grayscale': (pipeline) =>
    pipeline.grayscale().webp({ quality: 80, alphaQuality: 80, effort: 4, smartSubsample: true }),
};

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

await fs.mkdir(TMP, { recursive: true });
console.log(`\nMembuat ${PAGES} halaman uji ${W}x${H} (JPEG berwarna, seperti sumber)…`);

const sources = [];
for (let i = 0; i < PAGES; i += 1) {
  const buffer = await sharp(Buffer.from(makePage(i))).jpeg({ quality: 90 }).toBuffer();
  sources.push(buffer);
}
const sourceBytes = sources.reduce((sum, buffer) => sum + buffer.length, 0);
console.log(`Sumber: ${mb(sourceBytes)} (${Math.round(sourceBytes / PAGES / 1024)} KB per halaman)\n`);

console.log('varian                                   ukuran      hemat   waktu     MAE   max');
console.log('─'.repeat(84));

for (const [label, encode] of Object.entries(VARIANTS)) {
  const started = performance.now();
  let bytes = 0;
  let maeSum = 0;
  let maxErr = 0;

  for (const [index, source] of sources.entries()) {
    const output = path.join(TMP, `${label.slice(0, 5).trim()}-${index}.webp`);
    const pipeline = sharp(source, { failOn: 'none' })
      .rotate()
      .resize(1600, 2560, { fit: 'inside', withoutEnlargement: true });
    const info = await encode(pipeline).toFile(output);
    bytes += info.size;

    const { mae, max } = await meanAbsError(source, await fs.readFile(output));
    maeSum += mae;
    maxErr = Math.max(maxErr, max);
  }

  const elapsed = (performance.now() - started) / 1000;
  const saved = ((1 - bytes / sourceBytes) * 100).toFixed(1);
  console.log(
    `${label.padEnd(40)} ${mb(bytes).padStart(9)} ${`${saved}%`.padStart(8)} ` +
      `${`${elapsed.toFixed(2)}s`.padStart(7)} ${(maeSum / PAGES).toFixed(2).padStart(7)} ${String(maxErr).padStart(5)}`,
  );
}

// Passthrough: gambar yang sudah WebP & efisien tidak perlu di-encode ulang.
const already = await sharp(sources[0]).resize(1600, 2560, { fit: 'inside' }).webp({ quality: 75 }).toBuffer();
const bpp = already.length / (1600 * 2400);
console.log(
  `\npasstrough: contoh WebP ${Math.round(already.length / 1024)} KB = ${bpp.toFixed(3)} byte/pixel ` +
    `(ambang ${0.35}) -> ${bpp <= 0.35 ? 'disimpan apa adanya, 0 CPU, 0 kehilangan kualitas' : 're-encode'}`,
);

console.log('\nMAE = rata-rata selisih pixel vs sumber (0 = identik). Resolusi tidak diturunkan.');
await fs.rm(TMP, { recursive: true, force: true });
