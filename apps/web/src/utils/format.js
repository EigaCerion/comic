export const formatBytes = (bytes) => {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[unit]}`;
};

export const formatChapterNumber = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
};

export const formatRelativeTime = (input) => {
  if (!input) return '—';
  // SQLite datetime('now') = UTC tanpa timezone suffix
  const iso = String(input).includes('T') ? input : `${String(input).replace(' ', 'T')}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} hari lalu`;
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
};

/**
 * Durasi dalam detik -> teks singkat: "11 menit", "3 jam 12 menit", "2 hari".
 * Dipakai penanda status server, di mana yang penting adalah rasa "sudah berapa
 * lama", bukan angka presisi.
 */
export const formatDurasi = (detik) => {
  const total = Math.max(0, Math.floor(Number(detik) || 0));
  if (total < 60) return `${total} detik`;

  const menit = Math.floor(total / 60);
  if (menit < 60) return `${menit} menit`;

  const jam = Math.floor(menit / 60);
  const sisaMenit = menit % 60;
  if (jam < 24) return sisaMenit > 0 ? `${jam} jam ${sisaMenit} menit` : `${jam} jam`;

  const hari = Math.floor(jam / 24);
  const sisaJam = jam % 24;
  return sisaJam > 0 ? `${hari} hari ${sisaJam} jam` : `${hari} hari`;
};

export const statusColor = (status) => {
  switch ((status ?? '').toLowerCase()) {
    case 'completed':
      return 'text-shinobi border-shinobi/40';
    case 'hiatus':
      return 'text-danger border-danger/40';
    default:
      return 'text-leaf-light border-leaf/40';
  }
};

export const jobStatusLabel = {
  pending: 'Menunggu',
  downloading: 'Mengunduh',
  completed: 'Selesai',
  failed: 'Gagal',
  paused: 'Dijeda',
};
