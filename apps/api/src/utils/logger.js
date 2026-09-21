import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';

fs.mkdirSync(config.logsDir, { recursive: true });

/*
 * Rotasi log sederhana.
 *
 * Satu baris ditulis untuk SETIAP request, dan tidak ada yang pernah
 * membersihkannya: debug.log sudah 31,9 MB. Dua akibatnya nyata — disk penuh
 * bisa membuat penulisan gagal dan proses mati, dan berkas itu sendiri adalah
 * catatan lengkap kebiasaan membaca pemilik (komik mana, jam berapa, dari
 * perangkat apa) yang tersimpan tanpa batas waktu.
 *
 * Aturannya sengaja sederhana: begitu melewati batas, berkas lama disimpan
 * sebagai .1 (menimpa yang sebelumnya) lalu berkas baru dimulai. Tidak ada
 * dependensi, tidak ada penjadwal — cukup untuk aplikasi satu proses.
 */
const BATAS_LOG = Number(process.env.LOG_MAX_BYTES) || 8 * 1024 * 1024;

const putarKalauPenuh = (berkas) => {
  try {
    const stat = fs.statSync(berkas);
    if (stat.size < BATAS_LOG) return;
    fs.rmSync(`${berkas}.1`, { force: true });
    fs.renameSync(berkas, `${berkas}.1`);
  } catch {
    /* berkas belum ada, atau sedang dipakai proses lain — bukan alasan gagal */
  }
};

const buatAliran = (nama) => {
  const berkas = path.join(config.logsDir, nama);
  putarKalauPenuh(berkas);
  const aliran = fs.createWriteStream(berkas, { flags: 'a' });
  // Kegagalan menulis log TIDAK BOLEH menjatuhkan proses. Tanpa penangan ini,
  // disk penuh berarti server berhenti melayani.
  aliran.on('error', () => {});
  return aliran;
};

const streams = {
  debug: buatAliran('debug.log'),
  error: buatAliran('error.log'),
};

const DEBUG_ENABLED = /naruread|\*/.test(process.env.DEBUG || '') || config.env !== 'production';

// Mode tenang: log tetap ditulis ke berkas, tapi tidak memenuhi layar. Dipakai
// launcher supaya jendelanya hanya berisi alamat yang bisa dibuka.
//
// Dibaca setiap pemanggilan, bukan sekali saat modul dimuat: launcher menyetel
// LOG_CONSOLE setelah import-nya dijalankan, dan nilai yang dibekukan di awal
// membuat setelan itu tidak pernah berlaku.
const consoleEnabled = () => process.env.LOG_CONSOLE !== 'false';

const write = (stream, level, scope, args) => {
  const line = `${new Date().toISOString()} [${level}] ${scope} ${args
    .map((a) => (typeof a === 'string' ? a : safeStringify(a)))
    .join(' ')}\n`;
  stream.write(line);
  return line.trimEnd();
};

const safeStringify = (value) => {
  if (value instanceof Error) return `${value.message}\n${value.stack ?? ''}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const createLogger = (scope = 'naruread') => ({
  info(...args) {
    const line = write(streams.debug, 'info', scope, args);
    if (consoleEnabled()) console.log(line);
  },
  debug(...args) {
    const line = write(streams.debug, 'debug', scope, args);
    if (DEBUG_ENABLED && consoleEnabled()) console.log(line);
  },
  warn(...args) {
    const line = write(streams.debug, 'warn', scope, args);
    if (consoleEnabled()) console.warn(line);
  },
  error(...args) {
    const line = write(streams.error, 'error', scope, args);
    if (consoleEnabled()) console.error(line);
  },
});

export default createLogger();
