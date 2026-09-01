import os from 'node:os';
import dgram from 'node:dgram';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import QRCode from 'qrcode';
import makeMdns from 'multicast-dns';
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('naruread:connect');

/**
 * Penyiaran nama di jaringan lokal (mDNS) — DEFAULT MATI.
 *
 * Dukungan `.local` tidak merata (Android kerap gagal meresolusinya), sementara
 * menyalakannya berarti mengumumkan keberadaan aplikasi ke semua perangkat di
 * jaringan. Manfaatnya kecil, paparannya nyata — jadi hanya menyala kalau
 * diminta lewat MDNS_ENABLED=true.
 */
export const MDNS_ENABLED = process.env.MDNS_ENABLED === 'true';
export const MDNS_HOST = process.env.MDNS_HOST || 'naruread.local';

/**
 * Nama tetap yang dipilih sendiri oleh pemilik, mis. nama MagicDNS dari
 * Tailscale atau entri DNS di router sendiri.
 *
 * Berbeda dari mDNS: ini tidak menyiarkan apa pun. Aplikasi hanya perlu tahu
 * nama itu supaya QR dan halaman Pengaturan menampilkannya, bukan IP mentah
 * yang berubah tiap pindah jaringan.
 */
export const NAMA_HOST = (process.env.NAMA_HOST || '').trim();

/** Alamat IPv4 nyata milik mesin ini (adapter virtual dibuang). */
export const alamatLokal = () =>
  Object.entries(os.networkInterfaces())
    .flatMap(([name, list]) => (list ?? []).map((info) => ({ ...info, name })))
    .filter((info) => info.family === 'IPv4' && !info.internal)
    .filter((info) => !/vethernet|vmware|virtualbox|loopback|hyper-v/i.test(info.name));

const jalankan = promisify(execFile);

/**
 * Dua jenis adapter virtual, dengan perlakuan yang BERKEBALIKAN.
 *
 * VPN korporat/komersial menyalurkan lalu lintas ke tempat lain; menyajikan
 * aplikasi di alamatnya salah sasaran. Pernah terjadi QR berisi alamat PANGP
 * sementara HP butuh alamat Wi-Fi, dan itu sebabnya adapter ini dibuang.
 *
 * Overlay mesh (Tailscale, ZeroTier) justru sebaliknya: alamatnya PERSIS cara
 * HP menjangkau mesin ini dari jaringan mana pun. Versi sebelumnya menyamakan
 * keduanya, sehingga begitu overlay dipasang aplikasi ini malah menyembunyikan
 * satu-satunya alamat yang berguna saat berpindah jaringan.
 */
const POLA_VPN_KORPORAT = /pangp|globalprotect|openvpn|anyconnect|forticlient|nordlynx|expressvpn/i;
const POLA_OVERLAY = /tailscale|zerotier|wireguard|wintun|\btun\b|tap-/i;

// Dipertahankan untuk pemanggil lama: keduanya sama-sama "bukan adapter fisik".
const POLA_VPN = new RegExp(`${POLA_VPN_KORPORAT.source}|${POLA_OVERLAY.source}`, 'i');

let cacheAdapter = null;

/** Satu kali pemindaian adapter, dipilah jadi dua kategori yang berlawanan. */
const klasifikasiAdapter = async () => {
  if (cacheAdapter) return cacheAdapter;
  const kosong = { korporat: new Set(), overlay: new Set() };
  if (process.platform !== 'win32') {
    cacheAdapter = kosong;
    return cacheAdapter;
  }
  try {
    const { stdout } = await jalankan(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        'Get-NetAdapter | Select-Object Name, InterfaceDescription | ConvertTo-Json -Compress',
      ],
      { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    );
    const data = JSON.parse(stdout || '[]');
    const daftar = Array.isArray(data) ? data : [data];
    const korporat = new Set();
    const overlay = new Set();
    daftar.forEach((item) => {
      const teks = `${item?.Name ?? ''} ${item?.InterfaceDescription ?? ''}`;
      // Urutan penting: VPN korporat diperiksa lebih dulu, karena sebagian
      // memakai driver TAP/TUN yang juga cocok dengan pola overlay.
      if (POLA_VPN_KORPORAT.test(teks)) korporat.add(item.Name);
      else if (POLA_OVERLAY.test(teks)) overlay.add(item.Name);
    });
    cacheAdapter = { korporat, overlay };
  } catch {
    cacheAdapter = kosong; // gagal mendeteksi bukan alasan menolak melayani
  }
  return cacheAdapter;
};

/** Adapter yang TIDAK boleh dipakai menyajikan aplikasi (VPN korporat). */
export const namaAdapterVpn = async () => (await klasifikasiAdapter()).korporat;

/** Adapter overlay mesh — justru inilah alamat yang tahan pindah jaringan. */
export const namaAdapterOverlay = async () => (await klasifikasiAdapter()).overlay;

/**
 * Alamat yang benar-benar dipakai mesin ini untuk keluar ke jaringan.
 *
 * Mengambil `alamatLokal()[0]` tidak cukup: laptop kerap punya beberapa adapter
 * (Wi-Fi, Ethernet, VPN) dan yang pertama terdaftar belum tentu terhubung ke
 * router yang sama dengan HP — QR jadi berisi alamat yang tidak bisa dituju.
 * Trik UDP connect ini membuat OS sendiri yang memilih interface keluar;
 * tidak ada paket yang benar-benar dikirim.
 */
export const alamatUtama = () =>
  new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const selesai = (nilai) => {
      try {
        socket.close();
      } catch {
        /* sudah tertutup */
      }
      resolve(nilai);
    };

    socket.once('error', () => selesai(null));
    try {
      socket.connect(80, '8.8.8.8', () => {
        const alamat = socket.address()?.address ?? null;
        selesai(alamat && alamat !== '0.0.0.0' ? alamat : null);
      });
    } catch {
      selesai(null);
    }
  });

/** URL yang paling masuk akal dibuka dari perangkat lain. */
export const urlUtama = async () => {
  const alamat = alamatLokal();
  const rute = await alamatUtama();
  const { korporat, overlay } = await klasifikasiAdapter();

  // Alamat LAN: adapter fisik saja. VPN korporat salah sasaran, dan overlay
  // punya perannya sendiri di bawah — keduanya bukan "alamat Wi-Fi".
  const fisik = alamat.filter((info) => !korporat.has(info.name) && !overlay.has(info.name));
  const utama =
    fisik.find((info) => info.address === rute) ?? fisik[0] ?? alamat.find((info) => info.address === rute) ?? alamat[0];

  // Alamat overlay: satu-satunya yang tetap sama saat berpindah jaringan,
  // karena tidak bergantung pada Wi-Fi mana yang sedang dipakai.
  const mesh = alamat.find((info) => overlay.has(info.name)) ?? null;

  const lan = utama ? `http://${utama.address}:${config.port}` : null;
  const urlMesh = mesh ? `http://${mesh.address}:${config.port}` : null;

  // Nama tetap yang dikonfigurasi sendiri menang atas mDNS: ia tidak menyiarkan
  // apa pun dan tetap berlaku di jaringan mana pun.
  const nama = NAMA_HOST
    ? `http://${NAMA_HOST}:${config.port}`
    : MDNS_ENABLED
      ? `http://${MDNS_HOST}:${config.port}`
      : null;

  const jenis = (info) =>
    korporat.has(info.name) ? 'vpn' : overlay.has(info.name) ? 'overlay' : 'fisik';

  return {
    lokal: `http://localhost:${config.port}`,
    lan,
    overlay: urlMesh,
    overlayInterface: mesh?.name ?? null,
    nama,
    sumberNama: NAMA_HOST ? 'nama-host' : MDNS_ENABLED ? 'mdns' : null,
    mdnsEnabled: MDNS_ENABLED,
    interfaceUtama: utama?.name ?? null,
    // Urutan pilihan untuk QR: nama tetap dulu (paling tahan pindah jaringan),
    // lalu alamat overlay, baru alamat Wi-Fi.
    terbaik: nama ?? urlMesh ?? lan ?? `http://localhost:${config.port}`,
    semua: alamat.map((info) => ({
      url: `http://${info.address}:${config.port}`,
      interface: info.name,
      jenis: jenis(info),
      vpn: korporat.has(info.name),
      utama: info.address === utama?.address,
    })),
  };
};

export const qrTerminal = async (url) =>
  QRCode.toString(url, { type: 'terminal', small: true, errorCorrectionLevel: 'M' });

export const qrSvg = async (url) =>
  QRCode.toString(url, { type: 'svg', margin: 1, width: 320, errorCorrectionLevel: 'M' });

// ── Penyiar mDNS ──────────────────────────────────────────────────────────

let mdns = null;

/**
 * Jawab pertanyaan "siapa naruread.local?" di jaringan lokal.
 *
 * Ini yang membuat alamat tidak perlu dicatat lagi: IP boleh berganti setiap
 * pindah Wi-Fi, namanya tetap. Dukungan perangkat berbeda-beda — iOS/macOS
 * mulus, Android tergantung versi dan browser — jadi alamat IP tetap
 * ditampilkan sebagai cadangan.
 */
export const startMdns = () => {
  if (!MDNS_ENABLED) return; // dimatikan secara default
  if (mdns) return;
  try {
    mdns = makeMdns();

    mdns.on('query', (query) => {
      const cocok = (query.questions ?? []).some(
        (q) => (q.type === 'A' || q.type === 'ANY') && q.name?.toLowerCase() === MDNS_HOST,
      );
      if (!cocok) return;

      const jawaban = alamatLokal().map((info) => ({
        name: MDNS_HOST,
        type: 'A',
        ttl: 120,
        data: info.address,
      }));
      if (jawaban.length > 0) mdns.respond({ answers: jawaban });
    });

    mdns.on('error', (error) => log.debug(`mDNS: ${error.message}`));
    log.info(`mDNS aktif — perangkat lain bisa memakai http://${MDNS_HOST}:${config.port}`);
  } catch (error) {
    log.warn(`mDNS tidak bisa dinyalakan: ${error.message}`);
    mdns = null;
  }
};

export const stopMdns = () => {
  if (!mdns) return;
  try {
    mdns.destroy();
  } catch {
    /* sudah tertutup */
  }
  mdns = null;
};

export default { urlUtama, qrTerminal, qrSvg, startMdns, stopMdns, MDNS_HOST, alamatLokal };
