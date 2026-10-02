import { getDb } from '../db/index.js';
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { auditComic, repairFindings } from '../services/auditService.js';

const log = createLogger('naruread:pengawas');

/**
 * Bot pengawas: memeriksa hasil kerja bot importir.
 *
 * Antriannya di memori dan berisi comicId saja — pemeriksaan berat (baca berkas)
 * sudah disaring di auditService lewat kolom audited_at, jadi satu komik yang
 * masuk berkali-kali tidak berarti kerja berulang.
 */
const pending = new Set();
const inFlight = new Set();
let sweepTimer = null;
let stopped = true;
let statistik = { diperiksa: 0, temuan: 0, perbaikanDiantre: 0, sapuanTerakhir: null };

/** Dipanggil bot importir begitu sebuah chapter selesai. */
export const notifyChapterDone = (comicId) => {
  if (stopped || !comicId) return;
  pending.add(comicId);
};

export const supervisorStatus = () => ({
  aktif: !stopped,
  bot: config.worker.supervisors,
  antre: pending.size,
  sedangMemeriksa: inFlight.size,
  ...statistik,
});

const takeNext = () => {
  for (const comicId of pending) {
    if (inFlight.has(comicId)) continue; // satu komik cukup satu pengawas
    pending.delete(comicId);
    return comicId;
  }
  return null;
};

const superviseOne = async (comicId) => {
  inFlight.add(comicId);
  try {
    const hasil = await auditComic(comicId);
    statistik.diperiksa += hasil.diperiksa;

    if (hasil.bermasalah > 0 || hasil.gaps.length > 0) {
      statistik.temuan += hasil.bermasalah + hasil.gaps.length;
      log.info(
        `${hasil.slug}: ${hasil.diperiksa} chapter diperiksa, ${hasil.bermasalah} bermasalah, ${hasil.gaps.length} nomor bolong`,
      );

      // Yang bisa diperbaiki sendiri (chapter rusak dengan URL sumber) langsung
      // dikembalikan ke antrian importir; nomor bolong butuh resync manual.
      const perbaikan = await repairFindings(comicId);
      statistik.perbaikanDiantre += perbaikan.diantre;
      if (perbaikan.diantre > 0) {
        log.info(`${hasil.slug}: ${perbaikan.diantre} chapter diantre ulang untuk diperbaiki`);
      }
    }
  } catch (error) {
    log.error(`audit komik ${comicId} gagal:`, error);
  } finally {
    inFlight.delete(comicId);
  }
};

/** Satu bot pengawas: ambil satu komik, periksa, ulangi. */
const botLoop = async (nomor) => {
  while (!stopped) {
    const comicId = takeNext();
    if (comicId === null) {
      await new Promise((resolve) => setTimeout(resolve, config.worker.pollInterval));
      continue;
    }
    log.debug(`bot ${nomor} memeriksa komik ${comicId}`);
    await superviseOne(comicId);
  }
};

/**
 * Sapuan berkala: komik yang punya chapter belum pernah diperiksa dimasukkan
 * ke antrian. Batas 50 komik per sapuan supaya tidak menyita I/O.
 */
const sweep = () => {
  if (stopped) return;
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT c.id
         FROM comics c JOIN chapters ch ON ch.comic_id = c.id
        WHERE ch.is_downloaded = 1
          AND (ch.audited_at IS NULL OR (ch.downloaded_at IS NOT NULL AND ch.audited_at < ch.downloaded_at))
        LIMIT 50`,
    )
    .all();

  rows.forEach((row) => pending.add(row.id));
  statistik.sapuanTerakhir = new Date().toISOString();
  if (rows.length > 0) log.debug(`sapuan menemukan ${rows.length} komik untuk diperiksa`);
};

export const startSupervisors = () => {
  if (!stopped) return;
  stopped = false;
  statistik = { diperiksa: 0, temuan: 0, perbaikanDiantre: 0, sapuanTerakhir: null };

  sweep();
  sweepTimer = setInterval(sweep, config.worker.supervisorSweepMs);
  sweepTimer.unref?.();

  for (let i = 1; i <= config.worker.supervisors; i += 1) {
    botLoop(i).catch((error) => log.error(`bot pengawas ${i} berhenti:`, error));
  }

  log.info(`${config.worker.supervisors} bot pengawas aktif`);
};

export const stopSupervisors = () => {
  stopped = true;
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
};

export default { startSupervisors, stopSupervisors, notifyChapterDone, supervisorStatus };
