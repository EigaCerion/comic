/*
 * Membangun halaman uji lalu menjalankannya di Chromium, dan melaporkan hasilnya
 * ke terminal dengan kode keluar yang benar.
 *
 * Chromium dipakai, bukan Node, karena yang diuji hanya masuk akal di dalam
 * browser: IS_APP dibaca dari import.meta.env.MODE (diganti Vite saat build),
 * ASLI_NATIF dari window.Capacitor, dan urlLokal memanggil convertFileSrc.
 *
 * Digerakkan lewat --dump-dom, bukan lewat pustaka otomasi browser: menambah
 * Playwright sebagai dependensi repo ini hanya untuk satu berkas uji jauh lebih
 * mahal daripada membaca DOM yang sudah dicetak Chromium sendiri. Jalur binari
 * bisa ditimpa lewat CHROMIUM_BIN kalau di mesin lain letaknya berbeda.
 *
 * Jalankan: npm run test:offline --workspace apps/web
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const jalankanBerkas = promisify(execFile);

/*
 * Halaman uji dilayani lewat HTTP, bukan dibuka sebagai file://.
 *
 * Skrip modul ES yang dimuat dari file:// ditolak Chromium sebagai pelanggaran
 * lintas-origin, jadi berkasnya terbuka tapi tidak satu baris pun kode aplikasi
 * dijalankan — dan DOM yang dicetak terlihat seperti pengujian yang menggantung,
 * bukan seperti pengujian yang tidak pernah dimulai.
 */
const TIPE = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const layani = (akar) =>
  new Promise((selesai) => {
    const server = http.createServer((minta, jawab) => {
      const jalur = decodeURIComponent(new URL(minta.url, 'http://localhost').pathname);
      const target = path.join(akar, jalur === '/' ? 'index.html' : jalur);
      // Penjaga jalur: server ini hanya boleh melayani isi folder dist-nya.
      if (!target.startsWith(akar) || !existsSync(target)) {
        jawab.writeHead(404).end('tidak ada');
        return;
      }
      jawab.writeHead(200, { 'Content-Type': TIPE[path.extname(target)] ?? 'application/octet-stream' });
      jawab.end(readFileSync(target));
    });
    server.listen(0, '127.0.0.1', () => selesai({ server, port: server.address().port }));
  });

const DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(DIR, '..');

// Jalur Windows ikut dicari karena di situlah APK-nya dibangun: mesin build
// NaruReader satu-satunya adalah PC Windows pemiliknya, dan uji ini justru
// paling dibutuhkan di sana — tepat sebelum APK baru dikompilasi.
const KANDIDAT = [
  process.env.CHROMIUM_BIN,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  `${process.env.ProgramFiles ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)'] ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)'] ?? ''}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env.ProgramFiles ?? ''}\\Microsoft\\Edge\\Application\\msedge.exe`,
].filter(Boolean);

const cariChromium = () => KANDIDAT.find((jalur) => existsSync(jalur)) ?? null;

const SKENARIO = [
  { nama: 'index.json sah + jalur baca + penjaga berkas hilang', query: 'indeks' },
  { nama: 'index.json hilang → dibangun ulang dari folder', query: 'pulih' },
];

const main = async () => {
  const chromium = cariChromium();
  if (!chromium) {
    process.stderr.write(
      `Chromium tidak ditemukan. Setel CHROMIUM_BIN ke binarinya.\nYang dicoba:\n${KANDIDAT.map((j) => `  ${j}`).join('\n')}\n`,
    );
    process.exit(1);
  }

  process.stdout.write('membangun halaman uji…\n');
  // shell: true khusus Windows — di sana "npx" adalah npx.cmd, dan spawn tanpa
  // shell menolaknya dengan ENOENT yang menyesatkan (seolah npx tidak terpasang).
  await jalankanBerkas('npx', ['vite', 'build', '--mode', 'android', '--config', 'uji-offline/vite.config.js'], {
    cwd: WEB,
    maxBuffer: 20 * 1024 * 1024,
    shell: process.platform === 'win32',
  });

  const { server, port } = await layani(path.join(DIR, 'dist'));
  let gagal = 0;
  let lolos = 0;

  try {
  for (const skenario of SKENARIO) {
    const { stdout } = await jalankanBerkas(
      chromium,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        // Waktu virtual: Chromium memajukan timer secepat mungkin lalu berhenti,
        // jadi tidak ada penantian nyata dan tidak ada uji yang menggantung.
        '--virtual-time-budget=20000',
        '--dump-dom',
        `http://127.0.0.1:${port}/index.html?skenario=${skenario.query}`,
      ],
      { maxBuffer: 20 * 1024 * 1024 },
    );

    process.stdout.write(`\n── ${skenario.nama} ──\n`);

    const cocok = /__MULAI__(.*?)__SELESAI__/s.exec(stdout);
    if (!cocok) {
      gagal += 1;
      process.stdout.write('  ❌ pengujian tidak pernah selesai (tidak ada laporan di DOM)\n');
      continue;
    }

    let daftar;
    try {
      // DOM yang dicetak sudah di-escape sebagai HTML; dikembalikan dulu supaya
      // JSON-nya bisa diurai.
      const mentah = cocok[1]
        .replaceAll('&quot;', '"')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&amp;', '&');
      daftar = JSON.parse(mentah);
    } catch (galat) {
      gagal += 1;
      process.stdout.write(`  ❌ laporan tidak bisa diurai: ${galat.message}\n`);
      continue;
    }

    daftar.forEach((satu) => {
      if (satu.lolos) {
        lolos += 1;
        process.stdout.write(`  ✅ ${satu.nama}\n`);
      } else {
        gagal += 1;
        process.stdout.write(
          `  ❌ ${satu.nama}\n       dapat : ${JSON.stringify(satu.dapat)}\n       harap : ${JSON.stringify(satu.harap)}\n`,
        );
      }
    });
  }
  } finally {
    server.close();
  }

  process.stdout.write(`\n${gagal === 0 ? '✅' : '❌'} ${lolos} lolos, ${gagal} gagal\n\n`);
  process.exit(gagal === 0 ? 0 : 1);
};

main().catch((galat) => {
  process.stderr.write(`${galat?.stdout ?? ''}${galat?.stderr ?? ''}\n${galat?.message ?? galat}\n`);
  process.exit(1);
});
