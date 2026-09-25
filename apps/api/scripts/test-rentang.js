/*
 * Uji hitungan rentang panel "Simpan ke HP" (apps/web/src/offline/pilihRentang.js).
 *
 * Kenapa skripnya duduk di apps/api/scripts padahal yang diuji milik apps/web:
 * di sinilah seluruh skrip uji repo ini berada (test-db, test-extractor,
 * test-audit) dan `npm run test:*` sudah menunjuk ke sini. Modul yang diuji
 * adalah JS biasa tanpa React maupun Capacitor, jadi Node bisa mengimpornya
 * langsung tanpa perkakas build.
 *
 * Yang dijaga: panel itu hanya hidup di build APK, jadi tanpa berkas ini satu
 * salah hitung batas rentang ("Ch 300-360" memilih 60, bukan 61) baru terlihat
 * setelah APK dipasang di HP.
 *
 * Jalankan: npm run test:rentang
 */
import {
  bisaDisimpan,
  daftarLayak,
  dalamRentang,
  pisahkanCalon,
  rentangCepat,
} from '../../web/src/offline/pilihRentang.js';

let gagal = 0;
let lolos = 0;

const cek = (nama, dapat, harap) => {
  const sama = JSON.stringify(dapat) === JSON.stringify(harap);
  if (sama) {
    lolos += 1;
    console.log(`  ✅ ${nama}`);
  } else {
    gagal += 1;
    console.log(`  ❌ ${nama}\n       dapat : ${JSON.stringify(dapat)}\n       harap : ${JSON.stringify(harap)}`);
  }
};

/** Chapter tiruan: id, nomor, dan keadaan berkasnya di server. */
const ch = (number, { isDownloaded = true, totalPages = 20 } = {}) => ({
  id: `c${number}`,
  number,
  isDownloaded,
  totalPages,
});

console.log('\n── bisaDisimpan ──────────────────────────────────────');
cek('berkas lengkap di server → boleh', bisaDisimpan(ch(1)), true);
cek('belum terunduh → tidak', bisaDisimpan(ch(1, { isDownloaded: false })), false);
cek('terunduh tapi nol halaman → tidak', bisaDisimpan(ch(1, { totalPages: 0 })), false);
cek('objek kosong tidak melempar', bisaDisimpan(undefined), false);

console.log('\n── daftarLayak ───────────────────────────────────────');
{
  const campur = [ch(3), ch(1, { isDownloaded: false }), ch(2), ch(5, { totalPages: 0 }), ch(4)];
  cek(
    'yang belum siap dibuang, sisanya urut naik',
    daftarLayak(campur).map((c) => c.number),
    [2, 3, 4],
  );
}

console.log('\n── dalamRentang (batas ikut terhitung) ───────────────');
{
  // 700 chapter: ukuran koleksi yang jadi alasan pemilih ini berbentuk rentang.
  const besar = daftarLayak(Array.from({ length: 700 }, (_, i) => ch(i + 1)));
  cek('Ch 300–360 berisi 61 chapter, bukan 60', dalamRentang(besar, 300, 360).length, 61);
  cek('batas bawah ikut', dalamRentang(besar, 300, 360)[0].number, 300);
  cek('batas atas ikut', dalamRentang(besar, 300, 360).at(-1).number, 360);
  cek('satu chapter saja', dalamRentang(besar, 42, 42).map((c) => c.number), [42]);
  cek('rentang terbalik ditukar sendiri', dalamRentang(besar, 90, 30).length, 61);
  cek('di luar daftar → kosong', dalamRentang(besar, 900, 999).length, 0);
}

console.log('\n── rentang dengan nomor desimal ──────────────────────');
{
  // Chapter sisipan (10.5) nyata di situs sumber; nomor bulat saja akan
  // melewatkannya tanpa jejak.
  const desimal = daftarLayak([ch(10), ch(10.5), ch(11)]);
  cek('Ch 10–11 ikut menyertakan 10.5', dalamRentang(desimal, 10, 11).map((c) => c.number), [10, 10.5, 11]);
}

console.log('\n── pisahkanCalon ─────────────────────────────────────');
{
  const dalam = daftarLayak([ch(1), ch(2), ch(3), ch(4)]);
  const diHp = new Set(['c2', 'c3']);
  const hasil = pisahkanCalon(dalam, (c) => diHp.has(c.id));
  cek('yang sudah di HP tidak diantre ulang', hasil.calon.map((c) => c.number), [1, 4]);
  cek('yang dilewati dihitung', hasil.sudahAda, 2);

  const semua = pisahkanCalon(dalam, () => true);
  cek('semua sudah ada → calon kosong', semua.calon.length, 0);
  cek('semua sudah ada → jumlah dilewati utuh', semua.sudahAda, 4);
}

console.log('\n── rentangCepat ──────────────────────────────────────');
{
  const berurutan = daftarLayak(Array.from({ length: 100 }, (_, i) => ch(i + 1)));
  cek('10 berikutnya dari Ch 50 → 50..59', rentangCepat(berurutan, 50, 10), { dari: 50, sampai: 59 });
  cek('5 berikutnya dari Ch 1 → 1..5', rentangCepat(berurutan, 1, 5), { dari: 1, sampai: 5 });

  // Titik lanjut baca bisa menunjuk chapter yang belum terunduh: yang dicari
  // chapter tersedia pertama yang nomornya tidak lebih kecil.
  const berlubang = daftarLayak([ch(1), ch(2), ch(10), ch(11), ch(12)]);
  cek('titik baca di lubang → maju ke yang tersedia', rentangCepat(berlubang, 5, 2), { dari: 10, sampai: 11 });

  // Sudah di ujung: mengembalikan rentang kosong akan membuat tombolnya mati
  // tanpa penjelasan, jadi yang diambil N terakhir.
  cek('titik baca melewati chapter terakhir → N terakhir', rentangCepat(berurutan, 500, 3), { dari: 98, sampai: 100 });

  cek('minta lebih banyak dari yang ada → berhenti di yang terakhir', rentangCepat(berlubang, 1, 999), {
    dari: 1,
    sampai: 12,
  });
  cek('daftar kosong → null', rentangCepat([], 1, 10), null);
  cek('jumlah nol → null', rentangCepat(berurutan, 1, 0), null);
}

console.log(`\n${gagal === 0 ? '✅' : '❌'} ${lolos} lolos, ${gagal} gagal\n`);
process.exit(gagal === 0 ? 0 : 1);
