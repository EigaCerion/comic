#!/usr/bin/env node
// Penyala NaruReader untuk pemakaian sehari-hari: yang tampil di layar hanya
// alamat yang bisa dibuka. Log API, bot importir, dan bot pengawas tetap
// ditulis ke apps/api/logs/ supaya jendela ini bersih.
//
// PENTING: server dijalankan DI DALAM proses ini, bukan sebagai proses anak.
// Windows tidak mengirim sinyal ke Node saat jendela console ditutup, jadi
// anak yang di-spawn akan selamat sebagai proses yatim tanpa jendela — persis
// bug "sudah ditutup tapi masih jalan". Satu jendela = satu proses = pasti mati
// bersama jendelanya.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import config, { API_ROOT, REPO_ROOT } from '../src/utils/config.js';
import {
  qrTerminal,
  urlUtama,
  namaAdapterVpn,
  MDNS_HOST,
  MDNS_ENABLED,
} from '../src/services/connectService.js';
import { preflight, cetakPreflight } from './preflight.js';

const SERVER = path.join(API_ROOT, 'src', 'server.js');
const DIST = path.join(REPO_ROOT, 'apps', 'web', 'dist', 'index.html');
const LOG_DIR = path.relative(REPO_ROOT, config.logsDir);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const health = () =>
  new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: config.port, path: '/api/health', agent: false, timeout: 1200 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });

const run = (command, args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: process.platform === 'win32', stdio: 'ignore' });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} keluar dengan kode ${code}`)),
    );
    child.on('error', reject);
  });

const alamatJaringan = () =>
  Object.entries(os.networkInterfaces())
    .flatMap(([name, list]) => (list ?? []).map((info) => ({ ...info, name })))
    .filter((info) => info.family === 'IPv4' && !info.internal)
    .filter((info) => !/vethernet|vmware|virtualbox|loopback|hyper-v/i.test(info.name));

/** QR berisi alamat LAN: dipindai dari HP, langsung terbuka tanpa mengetik apa pun. */
const cetakQr = async (pilihan) => {
  if (!pilihan?.url) return;
  const { url, nama } = pilihan;
  try {
    const qr = await qrTerminal(url);
    console.log('');
    console.log(`   Pindai dari HP  ->  ${url}   (${nama})`);
    console.log('');
    console.log(qr.split('\n').map((baris) => `   ${baris}`).join('\n'));
  } catch {
    /* QR hanya pelengkap — alamatnya tetap tercetak di atas */
  }
};

const banner = (catatan, daftarAlamat) => {
  const lines = ['', '  ╔═══════════════════════════════════════════════╗'];
  lines.push('  ║              NaruReader siap                  ║');
  lines.push('  ╚═══════════════════════════════════════════════╝', '');
  lines.push(`   Di laptop ini : http://localhost:${config.port}`);

  // Semua alamat ditampilkan apa adanya: mask /32 kadang berarti jaringan
  // memisahkan perangkat, kadang tidak — jangan sembunyikan yang mungkin jalan.
  const jaringan = daftarAlamat ?? [];
  jaringan.forEach((info) => {
    // Adapter VPN ditandai: alamatnya TIDAK bisa dijangkau HP yang ada di
    // Wi-Fi yang sama, jadi jangan sampai tertukar dengan alamat LAN.
    const tanda = info.utama ? '  <- dipakai QR' : info.vpn ? '  (VPN, bukan untuk HP di Wi-Fi)' : '';
    lines.push(`   Dari HP       : ${info.url}   (${info.interface})${tanda}`);
  });
  if (jaringan.length === 0) {
    lines.push('   Dari HP       : belum ada alamat jaringan (laptop tidak terhubung Wi-Fi/LAN)');
  }

  if (MDNS_ENABLED) {
    lines.push(`   Nama tetap    : http://${MDNS_HOST}:${config.port}`);
  }
  lines.push('', `   Log lengkap   : ${LOG_DIR}`);
  lines.push(catatan ?? '   Tekan Ctrl+C atau tutup jendela ini untuk mematikan.');
  lines.push('');
  return lines.join('\n');
};

const main = async () => {
  const koneksi = await urlUtama();
  const pilihanQr = koneksi.lan
    ? { url: koneksi.lan, nama: koneksi.interfaceUtama ?? 'LAN' }
    : null;

  if (await health()) {
    console.log(
      banner('   Catatan       : ini NaruReader yang SUDAH berjalan di jendela lain.', koneksi.semua),
    );
    console.log('   Untuk mematikannya: klik dua kali NaruReader-Stop.bat\n');
    await cetakQr(pilihanQr);
    console.log('');
    return;
  }

  if (!fs.existsSync(DIST)) {
    console.log('\n   Menyiapkan tampilan untuk pertama kali, mohon tunggu…');
    await run('npm', ['run', 'build'], REPO_ROOT);
  }

  // Server memakai logger yang sama; mode tenang membuatnya menulis ke berkas saja.
  // Disetel sebelum server diimpor, dan logger membacanya setiap kali menulis.
  process.env.LOG_CONSOLE = 'false';

  process.stdout.write('\n   Menyalakan');
  const menyala = import(pathToFileURL(SERVER).href);

  for (let i = 0; i < 40; i += 1) {
    if (await health()) {
      process.stdout.write(`\r${' '.repeat(30)}\r`);
      console.log(banner(undefined, koneksi.semua));

      // Pemeriksaan koneksi: hanya yang bermasalah yang ditampilkan, supaya
      // jendela tetap bersih saat semuanya beres.
      const hasil = await preflight();
      const bermasalah = hasil.filter((item) => item.status !== 'ok' && item.status !== 'lewati');
      if (bermasalah.length > 0) cetakPreflight(hasil, { hanyaMasalah: true });
      else console.log('   Pemeriksaan koneksi: semua siap untuk diakses dari HP.');

      await cetakQr(pilihanQr);
      console.log('');
      return;
    }
    process.stdout.write('.');
    await sleep(500);
  }

  await menyala; // munculkan galat sebenarnya kalau server gagal menyala
  console.log(`\n   Gagal menyala dalam 20 detik. Periksa ${LOG_DIR}\\server.log\n`);
  process.exit(1);
};

main().catch((error) => {
  console.error(`\n   Gagal: ${error.message}\n`);
  process.exit(1);
});
