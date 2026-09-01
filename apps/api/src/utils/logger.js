import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';

fs.mkdirSync(config.logsDir, { recursive: true });

const streams = {
  debug: fs.createWriteStream(path.join(config.logsDir, 'debug.log'), { flags: 'a' }),
  error: fs.createWriteStream(path.join(config.logsDir, 'error.log'), { flags: 'a' }),
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
