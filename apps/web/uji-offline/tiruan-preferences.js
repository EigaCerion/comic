/*
 * Tiruan @capacitor/preferences. Dipakai posisiBaca.js (posisi baca) dan
 * platform/server.js (alamat server, token) — keduanya ikut terbawa saat
 * lapisan offline diimpor, jadi keduanya harus bisa dijawab.
 */
const nilai = new Map();

export const Preferences = {
  async get({ key }) {
    return { value: nilai.has(key) ? nilai.get(key) : null };
  },
  async set({ key, value }) {
    nilai.set(key, String(value));
  },
  async remove({ key }) {
    nilai.delete(key);
  },
  async clear() {
    nilai.clear();
  },
};

export const _setel = (kunci, isi) => nilai.set(kunci, String(isi));
