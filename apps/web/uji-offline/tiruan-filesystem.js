/*
 * Tiruan @capacitor/filesystem: satu Map di memori, cukup untuk menjalankan
 * seluruh lapisan offline tanpa perangkat Android.
 *
 * Yang ditiru bukan API lengkap plugin itu, melainkan PERSIS bagian yang dipakai
 * apps/web/src/offline: mkdir, writeFile, readFile, readdir, stat, rmdir, getUri.
 * Perilaku yang sengaja ditiru apa adanya karena kode yang diuji bergantung
 * padanya:
 *
 *   - mkdir MELEMPAR kalau foldernya sudah ada (pastikanFolder mengandalkannya)
 *   - readdir mengembalikan { files: [{ name, type, size }] } dengan `name`
 *     berupa nama dasar, bukan jalur penuh — inilah yang dibandingkan
 *     rakitChapterLokal dengan nama berkas di chapter.json
 *   - readFile/stat/rmdir MELEMPAR untuk jalur yang tidak ada
 *   - getUri mengembalikan file:// yang menyerupai folder data aplikasi
 */

const berkas = new Map(); // jalur -> { data, isDir }

const rapikan = (jalur) => String(jalur ?? '').replace(/^\/+|\/+$/g, '');

const galat = (pesan) => {
  throw new Error(pesan);
};

export const Directory = { Data: 'DATA' };
export const Encoding = { UTF8: 'utf8' };

export const Filesystem = {
  async mkdir({ path }) {
    const jalur = rapikan(path);
    if (berkas.has(jalur)) galat(`Directory exists: ${jalur}`);
    berkas.set(jalur, { data: null, isDir: true });
  },

  async writeFile({ path, data }) {
    const jalur = rapikan(path);
    const induk = jalur.slice(0, jalur.lastIndexOf('/'));
    if (induk) berkas.set(induk, { data: null, isDir: true });
    berkas.set(jalur, { data, isDir: false });
  },

  async readFile({ path }) {
    const jalur = rapikan(path);
    const isi = berkas.get(jalur);
    if (!isi || isi.isDir) galat(`File does not exist: ${jalur}`);
    return { data: isi.data };
  },

  async readdir({ path }) {
    const jalur = rapikan(path);
    const isi = berkas.get(jalur);
    if (!isi?.isDir) galat(`Directory does not exist: ${jalur}`);

    const awalan = `${jalur}/`;
    const anak = new Map();
    for (const [kunci, nilai] of berkas) {
      if (!kunci.startsWith(awalan)) continue;
      const sisa = kunci.slice(awalan.length);
      const potong = sisa.indexOf('/');
      const nama = potong === -1 ? sisa : sisa.slice(0, potong);
      if (!nama) continue;
      const langsung = potong === -1;
      anak.set(nama, {
        name: nama,
        type: langsung && !nilai.isDir ? 'file' : 'directory',
        size: langsung && typeof nilai.data === 'string' ? nilai.data.length : 0,
      });
    }
    return { files: [...anak.values()] };
  },

  async stat({ path }) {
    const jalur = rapikan(path);
    const isi = berkas.get(jalur);
    if (!isi) galat(`File does not exist: ${jalur}`);
    return {
      type: isi.isDir ? 'directory' : 'file',
      size: typeof isi.data === 'string' ? isi.data.length : 0,
    };
  },

  async rmdir({ path }) {
    const jalur = rapikan(path);
    if (!berkas.has(jalur)) galat(`Directory does not exist: ${jalur}`);
    for (const kunci of [...berkas.keys()]) {
      if (kunci === jalur || kunci.startsWith(`${jalur}/`)) berkas.delete(kunci);
    }
  },

  async getUri({ path }) {
    return { uri: `file:///data/user/0/id.naruread.app/files/${rapikan(path)}` };
  },
};

/* ── Alat bantu khusus pengujian ─────────────────────────────────────── */

export const _tulis = (jalur, data) => {
  const bersih = rapikan(jalur);
  const potongan = bersih.split('/');
  for (let i = 1; i < potongan.length; i += 1) {
    berkas.set(potongan.slice(0, i).join('/'), { data: null, isDir: true });
  }
  berkas.set(bersih, { data, isDir: false });
};

export const _hapus = (jalur) => berkas.delete(rapikan(jalur));
export const _ada = (jalur) => berkas.has(rapikan(jalur));
export const _semua = () => [...berkas.keys()].sort();
export const _kosongkan = () => berkas.clear();
