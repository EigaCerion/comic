import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import pLimit from 'p-limit';
import config from '../utils/config.js';

const {
  format,
  quality,
  maxWidth,
  maxHeight,
  concurrency,
  effort,
  autoGrayscale,
  passthrough,
  passthroughBytesPerPixel,
} = config.image;

/** sharp tidak boleh menahan file di cache — koleksi besar cepat makan memori */
sharp.cache({ files: 0, items: 50 });
sharp.concurrency(Math.max(1, Math.min(concurrency, 4)));

const encode = (pipeline) => {
  if (format === 'avif') return pipeline.avif({ quality, effort: Math.min(effort, 9) });
  if (format === 'jpeg' || format === 'jpg') return pipeline.jpeg({ quality, mozjpeg: true });
  return pipeline.webp({
    quality,
    alphaQuality: quality,
    effort, // 4 -> 6 memberi berkas lebih kecil pada kualitas sama, biayanya CPU
    smartSubsample: true,
  });
};

export const imageExtension = () => (format === 'jpeg' || format === 'jpg' ? 'jpg' : format);

/** Nama file halaman: 001.webp, 002.webp, ... */
export const pageFilename = (pageNumber) =>
  `${String(pageNumber).padStart(3, '0')}.${imageExtension()}`;

/**
 * Deteksi format dari byte awal berkas. Dipakai saat Sharp menolak membacanya:
 * kita tetap perlu tahu apakah yang diunduh benar-benar gambar atau justru
 * halaman error yang menyamar.
 */
const deteksiFormat = (buffer) => {
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    // 'avif' = gambar diam, 'avis' = urutan gambar (varian animasi).
    const merek = buffer.toString('ascii', 8, 12);
    if (/avi[fs]|mif1|msf1/i.test(merek)) return 'avif';
  }
  if (buffer.length >= 6 && buffer.toString('ascii', 0, 3) === 'GIF') return 'gif';
  return null;
};

/**
 * Halaman komik hampir selalu hitam-putih. Kalau gambar berwarna ternyata
 * isinya grayscale, membuang channel warna memotong ukuran tanpa kehilangan
 * apa pun yang terlihat. Pemeriksaan dilakukan pada thumbnail 64px
 * (shrink-on-load, jadi murah), bukan pada gambar penuh.
 */
const isEffectivelyGrayscale = async (buffer) => {
  try {
    const { data, info } = await sharp(buffer, { failOn: 'none' })
      .resize(64, 64, { fit: 'inside' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (info.channels < 3) return true;

    let maxDelta = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      maxDelta = Math.max(maxDelta, Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
      if (maxDelta > 12) return false; // ada warna nyata
    }
    return true;
  } catch {
    return false;
  }
};

/**
 * Gambar yang sudah efisien tidak perlu di-encode ulang: formatnya sama,
 * dimensinya sudah di bawah batas, dan rasio byte/pixel-nya rendah.
 * Re-encode hanya akan menambah waktu CPU sekaligus mengurangi kualitas.
 */
const canPassThrough = (metadata, byteLength) => {
  if (!passthrough) return false;
  if (metadata.format !== format) return false;
  if (!metadata.width || !metadata.height) return false;
  if (metadata.width > maxWidth || metadata.height > maxHeight) return false;
  if (metadata.orientation && metadata.orientation > 1) return false; // masih perlu diputar
  return byteLength / (metadata.width * metadata.height) <= passthroughBytesPerPixel;
};

/**
 * Kompresi satu gambar (buffer atau path) ke outputPath.
 * Target: HD tetap terbaca, ukuran turun 70-80%.
 */
let hitungSementara = 0;

/**
 * Akhiran unik untuk berkas sementara.
 *
 * Dulu semua penulisan memakai `<target>.part` yang sama persis. Kalau dua job
 * mengerjakan chapter yang sama (dan itu benar-benar terjadi — satu chapter
 * sempat punya 43 job duplikat), keduanya menulis ke berkas itu lalu saling
 * me-rename: yang kalah cepat mati dengan "ENOENT ... rename". Akhiran unik
 * membuat setiap penulisan berdiri sendiri, dan rename tetap atomik.
 */
const akhiranSementara = () => {
  hitungSementara = (hitungSementara + 1) % 1_000_000;
  return `.${process.pid}-${hitungSementara}.part`;
};

export const compressToFile = async (input, outputPath) => {
  const buffer = Buffer.isBuffer(input) ? input : await fs.readFile(input);
  const originalSize = buffer.length;

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  // Sebagian situs menyajikan format yang tidak bisa dibaca libvips —
  // mis. AVIF *sequence* (merek 'avis'). Dulu ini menggagalkan seluruh chapter
  // setelah 3 percobaan; sekarang berkasnya disimpan apa adanya selama byte-nya
  // memang gambar, sehingga chapter tetap bisa dibaca.
  let metadata = null;
  try {
    metadata = await sharp(buffer, { failOn: 'none' }).metadata();
  } catch (error) {
    const format = deteksiFormat(buffer);
    if (!format) {
      throw new Error(
        `Bukan berkas gambar (${originalSize} byte, kemungkinan halaman error): ${error.message}`,
      );
    }

    const tujuanAsli = `${outputPath.replace(/\.[^.]+$/, '')}.${format}`;
    const sementara = `${tujuanAsli}${akhiranSementara()}`;
    await fs.writeFile(sementara, buffer);
    await fs.rm(tujuanAsli, { force: true });
    await fs.rename(sementara, tujuanAsli);

    return {
      filename: path.basename(tujuanAsli),
      image_size: originalSize,
      original_size: originalSize,
      compression_ratio: 0,
      hash: crypto.createHash('sha1').update(buffer).digest('hex'),
      mode: `asli:${format}`,
    };
  }
  // Ditulis ke berkas sementara lalu di-rename. rename bersifat atomik di satu
  // volume, jadi kalau proses mati atau jaringan putus di tengah jalan tidak
  // pernah ada berkas setengah jadi yang lolos sebagai halaman valid.
  const tempPath = `${outputPath}${akhiranSementara()}`;
  let size;
  let mode;

  if (canPassThrough(metadata, originalSize)) {
    await fs.writeFile(tempPath, buffer);
    size = originalSize;
    mode = 'passthrough';
  } else {
    let pipeline = sharp(buffer, { failOn: 'none' })
      .rotate() // hormati EXIF orientation sebelum metadata dibuang
      .resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true });

    const grayscale = autoGrayscale && metadata.channels >= 3 && (await isEffectivelyGrayscale(buffer));
    if (grayscale) pipeline = pipeline.grayscale();

    ({ size } = await encode(pipeline).toFile(tempPath));
    mode = grayscale ? 'grayscale' : 'color';
  }

  await fs.rm(outputPath, { force: true });
  await fs.rename(tempPath, outputPath);

  return {
    filename: path.basename(outputPath),
    image_size: size,
    original_size: originalSize,
    compression_ratio: originalSize > 0 ? Number((1 - size / originalSize).toFixed(4)) : 0,
    hash: crypto.createHash('sha1').update(buffer).digest('hex'),
    mode,
  };
};

/** Batch dengan concurrency terbatas supaya RAM aman di laptop entry-level. */
export const compressBatch = async (items, onProgress) => {
  const limit = pLimit(concurrency);
  let done = 0;

  return Promise.all(
    items.map((item) =>
      limit(async () => {
        const result = await compressToFile(item.input, item.output);
        done += 1;
        onProgress?.(done, items.length);
        return { ...result, ...item.meta };
      }),
    ),
  );
};

export default { compressToFile, compressBatch, pageFilename, imageExtension };
