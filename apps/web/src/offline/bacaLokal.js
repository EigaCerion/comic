import { ASLI_NATIF } from '../platform/index.js';
import {
  bacaChapterJson,
  bebaskanUrl,
  berkasChapter,
  chapterKomikTersimpan,
  chapterTersimpan,
  hapusChapterTersimpan,
  urlLokal,
} from './penyimpanan.js';
import { posisiLokal } from './posisiBaca.js';

/**
 * Menyusun kembali sebuah chapter dari berkas di HP, dalam bentuk yang persis
 * sama dengan jawaban GET /api/chapters/:id.
 *
 * Bentuknya sengaja ditiru mentah-mentah supaya Reader tidak perlu tahu dari
 * mana chapter itu datang. Alternatifnya — reader dengan dua cabang render —
 * berarti setiap perbaikan tampilan harus dikerjakan dua kali, dan yang kedua
 * (jalur luring) adalah yang paling jarang dibuka dan paling mudah dilupakan.
 */

const tetangga = (entri) => {
  const urut = chapterKomikTersimpan(entri.comicId);
  const posisi = urut.findIndex((lain) => lain.id === entri.id);
  const bentuk = (lain) => (lain ? { id: lain.id, number: lain.nomor, title: lain.judul } : null);
  // Tetangga saat luring adalah chapter TERSIMPAN berikutnya, bukan chapter
  // berikutnya menurut server. Menawarkan chapter yang tidak ada berkasnya
  // hanya menghasilkan reader kosong di tengah perjalanan, dan pembacanya tidak
  // punya cara kembali selain tombol Back.
  return { prev: bentuk(urut[posisi - 1]), next: bentuk(urut[posisi + 1]) };
};

/**
 * Daftar chapter untuk pemilih chapter saat server tidak terjangkau — bentuknya
 * mengikuti keluaran ringkas /api/comics/:id/chapters.
 */
export const daftarChapterLokal = (comicId) =>
  chapterKomikTersimpan(comicId).map((entri) => {
    const posisi = posisiLokal(entri.id);
    return {
      id: entri.id,
      number: entri.nomor,
      title: entri.judul,
      totalPages: entri.jumlahHalaman,
      isDownloaded: true,
      lastPageRead: posisi?.halaman ?? null,
      progressPercentage: posisi?.halaman
        ? Math.round((posisi.halaman / Math.max(entri.jumlahHalaman, 1)) * 100)
        : null,
      readAt: posisi?.readAt ?? null,
    };
  });

/**
 * @returns {Promise<{siap:boolean, chapterId:number, chapter:object|null,
 *   halaman:{number:number,url:string}[]|null, daftar:object[]|null}>}
 */
export const rakitChapterLokal = async (chapterId) => {
  const id = Number(chapterId);
  const kosong = { siap: true, chapterId: id, chapter: null, halaman: null, daftar: null };

  const entri = chapterTersimpan(id);
  if (!entri) return kosong;

  const simpanan = await bacaChapterJson(id);
  if (!simpanan?.server || !simpanan.halaman?.length) return kosong;

  /*
   * Di HP, keberadaan berkasnya diperiksa DI SINI, sekali untuk seluruh chapter.
   *
   * Penjaga "!url" di bawah ditulis justru untuk kasus ini, tapi di perangkat
   * sungguhan ia mati total: urlLokal pada cabang native hanya menyambung string
   * lalu melewatkannya ke convertFileSrc — penulisan ulang sinkron, bukan
   * pembacaan berkas — sehingga hasilnya selalu truthy selama akar folder data
   * terpecahkan. Yang membuatnya penting bukan kasus langka: folder yang terhapus
   * separuh (proses dibunuh di tengah rmdir rekursif) menyisakan chapter.json —
   * ia ditulis paling akhir saat mengunduh, jadi besar kemungkinan ia pula yang
   * paling belakangan dibuang — sementara sebagian halamannya sudah lenyap.
   * Tanpa pemeriksaan ini reader membuka chapter itu dengan deretan ikon gambar
   * rusak dan tanpa sepatah pesan pun.
   */
  if (ASLI_NATIF) {
    const ada = await berkasChapter(id);
    if (!ada || !simpanan.halaman.every((berkas) => ada.has(berkas.berkas))) {
      // Baris indeksnya ikut dibuang, kalau tidak keadaannya permanen: /offline
      // terus menampilkan chapter itu berikut ukurannya, dan karena katalog
      // masih mengakuinya tersimpan, SimpanKeHP menulis "✓ Di HP" dan tidak
      // pernah menawarkan mengunduhnya ulang.
      await hapusChapterTersimpan(id);
      return kosong;
    }
  }

  const halaman = [];
  for (const berkas of simpanan.halaman) {
    const url = await urlLokal(id, berkas.berkas);
    // Satu halaman yang berkasnya raib membuat seluruh chapter tidak bisa
    // dipercaya: reader akan menampilkan lubang di tengah tanpa penjelasan.
    // Lebih jujur mengaku tidak punya chapter ini sama sekali — server masih
    // bisa melayaninya kalau sedang terjangkau, dan tombol simpan akan
    // menawarkan mengunduhnya lagi.
    if (!url) {
      halaman.forEach((sudah) => bebaskanUrl(sudah.url));
      return kosong;
    }
    halaman.push({ number: berkas.number, url });
  }

  const { prev, next } = tetangga(entri);

  return {
    siap: true,
    chapterId: id,
    chapter: { ...simpanan.server, pages: halaman, prev, next },
    halaman,
    daftar: daftarChapterLokal(entri.comicId),
  };
};

export const bebaskanHalaman = (halaman) => (halaman ?? []).forEach((satu) => bebaskanUrl(satu.url));
