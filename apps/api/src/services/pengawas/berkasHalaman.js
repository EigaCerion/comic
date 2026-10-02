/**
 * Pemeriksa satu berkas halaman: apakah ini benar-benar gambar yang utuh?
 *
 * Bagian paling dasar bot pengawas, dan sengaja berdiri sendiri tanpa menyentuh
 * database maupun jaringan — itu yang membuatnya bisa diuji langsung terhadap
 * berkas sungguhan di folder sementara (apps/api/scripts/test-audit.js).
 */
import fs from 'node:fs/promises';

/**
 * Tanda tangan berkas gambar. Memeriksa 16 byte pertama jauh lebih murah
 * daripada mendekode gambar, tapi sudah cukup membedakan berkas utuh dari
 * berkas kosong atau potongan akibat koneksi terputus.
 */
const SIGNATURES = [
  {
    name: 'webp',
    test: (b) =>
      b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
  { name: 'jpeg', test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { name: 'png', test: (b) => b.length >= 8 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG' },
  { name: 'avif', test: (b) => b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp' },
];

const readHead = async (filePath, bytes = 16) => {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

/** Halaman utuh: berkasnya ada, tidak kosong, dan header-nya memang gambar. */
export const verifyPageFile = async (filePath) => {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return { ok: false, kind: 'missing_file' };
  }
  if (stat.size === 0) return { ok: false, kind: 'size_zero' };

  const head = await readHead(filePath);
  if (!SIGNATURES.some((signature) => signature.test(head))) {
    return { ok: false, kind: 'corrupt_file', size: stat.size };
  }
  return { ok: true, size: stat.size };
};
