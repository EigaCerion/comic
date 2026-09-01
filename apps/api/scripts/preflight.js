#!/usr/bin/env node
// Pemeriksaan sebelum terbang: mengecek hal-hal yang selama ini benar-benar
// membuat HP gagal terhubung — bukan daftar teori. Setiap temuan disertai
// perintah perbaikannya, dan tidak ada satu pun yang mengubah setelan sistem.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import config from '../src/utils/config.js';
import { alamatUtama, alamatLokal } from '../src/services/connectService.js';

const jalankan = promisify(execFile);
const CATATAN = path.join(config.dataDir, 'last-connect.json');

const powershell = async (perintah) => {
  const { stdout } = await jalankan('powershell', ['-NoProfile', '-Command', perintah], {
    windowsHide: true,
  });
  return stdout.trim();
};

const cek = (nama, status, pesan, perbaikan) => ({ nama, status, pesan, perbaikan });

/** Server hidup dan benar-benar menjawab di alamat LAN, bukan cuma localhost. */
const cekServer = (alamat) =>
  new Promise((resolve) => {
    if (!alamat) {
      resolve(cek('Server', 'lewati', 'belum ada alamat jaringan'));
      return;
    }
    const req = http.get(
      { host: alamat, port: config.port, path: '/api/health', agent: false, timeout: 2500 },
      (res) => {
        res.resume();
        resolve(
          res.statusCode === 200
            ? cek('Server', 'ok', `menjawab di http://${alamat}:${config.port}`)
            : cek('Server', 'peringatan', `menjawab dengan status ${res.statusCode}`),
        );
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(cek('Server', 'peringatan', 'belum berjalan (akan dinyalakan sebentar lagi)'));
    });
    req.on('error', () =>
      resolve(cek('Server', 'peringatan', 'belum berjalan (akan dinyalakan sebentar lagi)')),
    );
  });

/**
 * Rule firewall untuk port kita: ada, aktif, dan mencakup profil yang dipakai.
 *
 * Memakai `netsh`, bukan Get-NetFirewallRule — cmdlet itu menuntut hak
 * Administrator dan menolak dengan "Access is denied", yang mudah disalahartikan
 * sebagai "rule tidak ada". Kegagalan memeriksa dan temuan nyata dibedakan tegas
 * di sini: alarm palsu lebih merugikan daripada tidak ada pemeriksaan.
 */
const cekFirewall = async (kategori) => {
  if (process.platform !== 'win32') return cek('Firewall', 'lewati', 'bukan Windows');
  try {
    const { stdout } = await jalankan(
      'netsh',
      ['advfirewall', 'firewall', 'show', 'rule', 'name=all', 'dir=in'],
      { maxBuffer: 16 * 1024 * 1024, windowsHide: true },
    );

    const ambil = (teks, kunci) =>
      teks.match(new RegExp(`^${kunci}:\\s*(.+)$`, 'mi'))?.[1]?.trim() ?? '';

    const blok = stdout.split(/\r?\n\r?\n/);
    const adaKolomPort = blok.some((bagian) => /^LocalPort:/mi.test(bagian));
    if (!adaKolomPort) {
      return cek('Firewall', 'lewati', 'keluaran netsh tidak dikenali (mungkin beda bahasa Windows)');
    }

    const aktifDanMengizinkan = (bagian) =>
      /^yes$/i.test(ambil(bagian, 'Enabled')) && /^allow$/i.test(ambil(bagian, 'Action'));

    // Hanya rule yang MENYEBUT port kita yang dihitung sebagai bukti. Rule
    // ber-port "Any" biasanya terikat ke program tertentu (bukan Node kita),
    // jadi menghitungnya akan memberi centang hijau palsu.
    const relevan = blok.filter((bagian) => {
      const port = ambil(bagian, 'LocalPort');
      if (!port || !aktifDanMengizinkan(bagian)) return false;
      return port.split(',').map((x) => x.trim()).includes(String(config.port));
    });

    if (relevan.length === 0) {
      return cek(
        'Firewall',
        'gagal',
        `tidak ada rule inbound aktif untuk port ${config.port}`,
        `New-NetFirewallRule -DisplayName "NaruReader" -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${config.port} -Profile Private,Public`,
      );
    }

    const profil = [
      ...new Set(
        relevan
          .flatMap((bagian) => ambil(bagian, 'Profiles').toLowerCase().split(','))
          .map((x) => x.trim())
          .filter(Boolean),
      ),
    ].join(',');
    const cocokProfil = profil.includes('any') || !kategori || profil.includes(kategori.toLowerCase());
    if (!cocokProfil) {
      return cek(
        'Firewall',
        'gagal',
        `rule ada (profil ${profil}) tapi jaringan sekarang berkategori ${kategori}`,
        `New-NetFirewallRule -DisplayName "NaruReader ${kategori}" -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${config.port} -Profile ${kategori}`,
      );
    }

    return cek(
      'Firewall',
      'ok',
      `${relevan.length} rule menyebut port ${config.port} (profil ${profil || 'tidak terbaca'})`,
    );
  } catch (error) {
    return cek('Firewall', 'lewati', `tidak bisa diperiksa: ${error.message.split('\n')[0]}`);
  }
};

/** Kategori jaringan menentukan profil firewall mana yang berlaku. */
const cekKategori = async () => {
  if (process.platform !== 'win32') return { hasil: cek('Jaringan', 'lewati', 'bukan Windows') };
  try {
    const keluaran = await powershell(
      '(Get-NetConnectionProfile | Select-Object -First 1 -ExpandProperty NetworkCategory)',
    );
    const kategori = keluaran || null;
    return {
      kategori,
      hasil: cek('Jaringan', 'ok', `kategori ${kategori ?? 'tidak diketahui'}`),
    };
  } catch {
    return { kategori: null, hasil: cek('Jaringan', 'lewati', 'kategori tidak terbaca') };
  }
};

/**
 * GlobalProtect & VPN korporat sejenis kerap memasang kebijakan "no direct
 * access to local network": selama tersambung, lalu lintas ke jaringan lokal
 * diblokir dari sisi klien. Ini penyebab yang mudah terlewat karena firewall
 * dan alamat semuanya terlihat benar.
 */
const cekVpnKorporat = async () => {
  if (process.platform !== 'win32') return cek('VPN', 'lewati', 'bukan Windows');
  try {
    const keluaran = await powershell(
      "$p = Get-Process -Name PanGPS,PanGPA -ErrorAction SilentlyContinue;" +
        " $a = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceDescription -match 'PANGP|GlobalProtect' };" +
        " '{0}|{1}' -f [bool]$p, (($a | Where-Object Status -eq 'Up' | Measure-Object).Count)",
    );
    const [adaProses, adapterAktif] = keluaran.split('|');
    const jalan = /true/i.test(adaProses ?? '');
    const tersambung = Number(adapterAktif ?? 0) > 0;

    if (!jalan) return cek('VPN', 'ok', 'tidak ada VPN korporat yang berjalan');
    if (!tersambung) {
      return cek('VPN', 'ok', 'GlobalProtect terpasang tapi tidak tersambung');
    }
    return cek(
      'VPN',
      'peringatan',
      'GlobalProtect sedang tersambung — kebijakan kantor bisa memblokir akses ke jaringan lokal',
      'Kalau HP gagal terhubung padahal semua di atas hijau: putuskan GlobalProtect lalu coba lagi.',
    );
  } catch {
    return cek('VPN', 'lewati', 'status VPN tidak terbaca');
  }
};

/** IP berubah sejak terakhir dipakai? Bookmark dan QR lama jadi tidak berlaku. */
const cekPerubahanAlamat = (alamat) => {
  let sebelumnya = null;
  try {
    sebelumnya = JSON.parse(fs.readFileSync(CATATAN, 'utf8'))?.alamat ?? null;
  } catch {
    /* belum ada catatan */
  }

  try {
    fs.mkdirSync(path.dirname(CATATAN), { recursive: true });
    fs.writeFileSync(CATATAN, JSON.stringify({ alamat, waktu: new Date().toISOString() }, null, 2));
  } catch {
    /* tidak bisa mencatat — bukan masalah kritis */
  }

  if (!sebelumnya || sebelumnya === alamat) {
    return cek('Alamat', 'ok', alamat ? `${alamat} (sama seperti terakhir)` : 'belum ada alamat');
  }
  return cek(
    'Alamat',
    'peringatan',
    `berubah: ${sebelumnya} -> ${alamat}`,
    'Bookmark/QR lama di HP sudah tidak berlaku — pindai QR baru di jendela ini.',
  );
};

/** Beberapa adapter aktif bersamaan sering membuat orang memakai IP yang salah. */
const cekAdapter = (daftar, rute) => {
  if (daftar.length <= 1) return cek('Adapter', 'ok', daftar[0]?.name ?? 'tidak ada');
  const lain = daftar.filter((info) => info.address !== rute).map((info) => info.name);
  return cek(
    'Adapter',
    'peringatan',
    `${daftar.length} adapter aktif — HP harus memakai yang dipakai QR`,
    `Abaikan alamat dari: ${lain.join(', ')}`,
  );
};

/** Mask /32: petunjuk isolasi klien, bukan vonis (sudah terbukti kadang tetap jalan). */
const cekIsolasi = (daftar, rute) => {
  const dipakai = daftar.find((info) => info.address === rute);
  if (!dipakai) return cek('Isolasi', 'lewati', 'alamat utama tidak terbaca');
  if (dipakai.netmask !== '255.255.255.255') return cek('Isolasi', 'ok', `mask ${dipakai.netmask}`);
  return cek(
    'Isolasi',
    'peringatan',
    'jaringan memakai mask /32 — sebagian jaringan seperti ini memisahkan antar perangkat',
    'Kalau HP gagal terhubung padahal firewall sudah benar: pakai hotspot HP atau USB tethering.',
  );
};

const IKON = { ok: '✅', peringatan: '⚠️ ', gagal: '❌', lewati: '·' };

export const preflight = async () => {
  const daftar = alamatLokal();
  const rute = await alamatUtama();
  const { kategori, hasil: hasilKategori } = await cekKategori();

  return [
    cekPerubahanAlamat(rute),
    hasilKategori,
    await cekFirewall(kategori),
    await cekVpnKorporat(),
    cekAdapter(daftar, rute),
    cekIsolasi(daftar, rute),
    await cekServer(rute),
  ];
};

export const cetakPreflight = (hasil, { hanyaMasalah = false } = {}) => {
  const tampil = hanyaMasalah
    ? hasil.filter((item) => item.status === 'gagal' || item.status === 'peringatan')
    : hasil;
  if (tampil.length === 0) return;

  console.log(hanyaMasalah ? '\n   Perlu perhatian:' : '\n   Pemeriksaan koneksi:');
  tampil.forEach((item) => {
    console.log(`   ${IKON[item.status]} ${item.nama.padEnd(9)} ${item.pesan}`);
    if (item.perbaikan) console.log(`        ${item.perbaikan}`);
  });
};

// Dijalankan langsung: tampilkan semuanya.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const hasil = await preflight();
  cetakPreflight(hasil);
  const gagal = hasil.filter((item) => item.status === 'gagal').length;
  console.log(
    gagal === 0
      ? '\n   Semua siap untuk diakses dari HP.\n'
      : `\n   ${gagal} hal perlu dibereskan sebelum HP bisa terhubung.\n`,
  );
  process.exit(gagal === 0 ? 0 : 1);
}
