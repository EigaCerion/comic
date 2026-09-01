#!/usr/bin/env node
// Matikan NaruReader yang sedang berjalan, termasuk proses yatim yang tidak
// punya jendela lagi. Prosesnya dicari dari siapa yang menahan port-nya,
// bukan dari daftar proses node — supaya tidak salah membunuh proses lain.
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import config from '../src/utils/config.js';

const jalankan = promisify(execFile);

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

/** PID yang sedang listen di port kita. */
const cariPid = async () => {
  if (process.platform === 'win32') {
    const { stdout } = await jalankan('powershell', [
      '-NoProfile',
      '-Command',
      `(Get-NetTCPConnection -LocalPort ${config.port} -State Listen -ErrorAction SilentlyContinue).OwningProcess`,
    ]);
    return [...new Set(stdout.split(/\r?\n/).map((x) => x.trim()).filter(Boolean))];
  }
  const { stdout } = await jalankan('sh', ['-c', `lsof -ti tcp:${config.port} -sTCP:LISTEN || true`]);
  return stdout.split('\n').map((x) => x.trim()).filter(Boolean);
};

const matikan = async (pid) => {
  if (process.platform === 'win32') {
    // /T ikut mematikan proses anak (mis. jendela cmd pembungkus)
    await jalankan('taskkill', ['/PID', pid, '/T', '/F']);
  } else {
    process.kill(Number(pid), 'SIGTERM');
  }
};

const main = async () => {
  const hidup = await health();
  const pids = await cariPid();

  if (!hidup && pids.length === 0) {
    console.log(`\n   NaruReader tidak sedang berjalan (port ${config.port} kosong).\n`);
    return;
  }

  if (pids.length === 0) {
    console.log(`\n   Port ${config.port} dipakai, tapi PID-nya tidak terbaca.`);
    console.log(`   Coba manual: netstat -ano | findstr :${config.port}\n`);
    process.exit(1);
  }

  for (const pid of pids) {
    try {
      await matikan(pid);
      console.log(`   Proses ${pid} dihentikan.`);
    } catch (error) {
      console.log(`   Gagal menghentikan ${pid}: ${error.message}`);
    }
  }

  // Pastikan benar-benar mati, bukan sekadar diminta berhenti.
  for (let i = 0; i < 10; i += 1) {
    if (!(await health())) {
      console.log(`\n   ✅ NaruReader berhenti. Port ${config.port} sudah bebas.\n`);
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log('\n   ⚠️  Masih ada yang menjawab di port itu. Jalankan lagi perintah ini.\n');
  process.exit(1);
};

main().catch((error) => {
  console.error(`\n   Gagal: ${error.message}\n`);
  process.exit(1);
});
