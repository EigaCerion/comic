#!/usr/bin/env node
// Tampilkan alamat yang bisa dibuka dari HP/tablet, sekaligus mendeteksi
// jaringan yang mengisolasi klien (mask /32) — di jaringan seperti itu
// alamat LAN memang tidak akan pernah bisa dijangkau perangkat lain.
import os from 'node:os';
import config from '../src/utils/config.js';

const addresses = Object.entries(os.networkInterfaces())
  .flatMap(([name, list]) => (list ?? []).map((info) => ({ ...info, name })))
  .filter((info) => info.family === 'IPv4' && !info.internal)
  // Buang adapter virtual (VMware, WSL, Hyper-V, loopback)
  .filter((info) => !/vethernet|vmware|virtualbox|loopback|hyper-v/i.test(info.name));

if (addresses.length === 0) {
  console.log('❌ Tidak ada alamat IPv4 jaringan lokal yang terdeteksi.');
  console.log('   Pastikan laptop terhubung ke Wi-Fi/LAN yang sama dengan HP.');
  process.exit(1);
}

// mask 255.255.255.255 = tidak punya tetangga sesubnet. Ciri khas hotspot
// publik/kantor/kampus yang memasang client isolation.
// saling terjangkau — jadi ini catatan, bukan vonis. Alamatnya tetap ditampilkan.
const petunjukIsolasi = addresses.some((info) => info.netmask === '255.255.255.255');

console.log('\n📱 Buka dari HP (harus satu Wi-Fi dengan laptop):\n');
addresses.forEach((info) => {
  const flag = '';
  console.log(`   http://${info.address}:${config.port}      (${info.name})${flag}`);
});

if (petunjukIsolasi) {
  console.log('');
  console.log('   Catatan: jaringan ini memakai mask /32. Kadang itu berarti tiap');
  console.log('   perangkat dipisahkan (client isolation), kadang tidak — coba dulu');
  console.log('   alamat di atas dari HP. Kalau memang tidak bisa dijangkau,');
  console.log('   alternatifnya: hotspot HP, USB tethering, atau Tailscale.');
}

console.log('\n   Mode dev (dua port): http://<ip>:5173 — jalankan `npm run dev:lan`');
console.log('   Mode satu port     : alamat di atas — jalankan `npm run start:lan`');
console.log('\n🔥 Kalau HP tidak bisa connect, Windows Firewall memblokir portnya.');
console.log('   Jalankan sekali di PowerShell **sebagai Administrator**:\n');
console.log(
  `   New-NetFirewallRule -DisplayName "NaruReader" -Direction Inbound -Action Allow \`\n     -Protocol TCP -LocalPort ${config.port},5173 -Profile Private,Public\n`,
);
console.log('   Cek kategori jaringanmu dengan `Get-NetConnectionProfile` — rule');
console.log('   berprofil Private tidak berlaku di jaringan berkategori Public.\n');
