import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getDb } from '../db/index.js';
import config from '../utils/config.js';

const dirSize = async (dir) => {
  let total = 0;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else {
      try {
        total += (await fsp.stat(full)).size;
      } catch {
        /* file hilang saat scan — abaikan */
      }
    }
  }
  return total;
};

const fileSize = (filePath) => {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
};

export const getStats = async () => {
  const db = getDb();
  const counts = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM comics) AS comics,
         (SELECT COUNT(*) FROM comics WHERE is_favorite = 1) AS favorites,
         (SELECT COUNT(*) FROM chapters) AS chapters,
         (SELECT COUNT(*) FROM chapters WHERE is_downloaded = 1) AS downloaded_chapters,
         (SELECT COUNT(*) FROM pages) AS pages,
         (SELECT COUNT(*) FROM bookmarks) AS bookmarks,
         (SELECT COUNT(*) FROM download_queue WHERE status IN ('pending','downloading')) AS queue_active`,
    )
    .get();

  const compression = db
    .prepare(
      `SELECT SUM(image_size) AS compressed, SUM(original_size) AS original,
              AVG(compression_ratio) AS avg_ratio
         FROM pages WHERE original_size IS NOT NULL AND original_size > 0`,
    )
    .get();

  const imagesBytes = await dirSize(config.comicsDir);
  const cacheBytes = await dirSize(config.cacheDir);
  const dbBytes =
    fileSize(config.dbPath) + fileSize(`${config.dbPath}-wal`) + fileSize(`${config.dbPath}-shm`);

  return {
    library: counts,
    storage: {
      dataDir: config.dataDir,
      databaseBytes: dbBytes,
      imagesBytes,
      cacheBytes,
      totalBytes: dbBytes + imagesBytes + cacheBytes,
    },
    compression: {
      originalBytes: compression.original ?? 0,
      compressedBytes: compression.compressed ?? 0,
      averageRatio: compression.avg_ratio ?? 0,
    },
    system: {
      totalMemoryBytes: os.totalmem(),
      freeMemoryBytes: os.freemem(),
      platform: process.platform,
      nodeVersion: process.version,
    },
  };
};

export default { getStats };
