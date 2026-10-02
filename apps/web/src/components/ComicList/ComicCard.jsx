import { Link } from 'react-router-dom';
import { formatRelativeTime, statusColor } from '../../utils/format.js';
import { urlMedia } from '../../platform/server.js';
import { ProgressBar } from '../Common/index.jsx';

const Cover = ({ comic, className }) =>
  comic.coverUrl ? (
    <img
      src={urlMedia(comic.coverUrl)}
      alt={`Cover ${comic.title}`}
      className={className}
      loading="lazy"
      decoding="async"
    />
  ) : (
    <div className={`${className} flex items-center justify-center bg-surface-soft text-3xl`}>🍥</div>
  );

export const ComicCard = ({ comic, progress }) => (
  <Link
    to={`/comic/${comic.slug}`}
    className="card group flex flex-col overflow-hidden transition-all duration-200
               hover:-translate-y-1 hover:border-primary/30 hover:shadow-scroll"
  >
    {/* Bingkai sampul memakai Surface Soft, bukan warna garis: saat sampul
        belum selesai dimuat yang terlihat adalah bidang netral seukuran kartu,
        bukan kotak gelap yang terbaca seperti gambar rusak. */}
    <div className="relative aspect-[2/3] overflow-hidden bg-surface-soft">
      <Cover
        comic={comic}
        className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
      />
      {/* Dua penanda ini duduk DI ATAS artwork, jadi keduanya dijaga sekecil
          mungkin dan memakai kerudung netral — bukan warna. Spesifikasinya
          tegas: sampul tidak boleh tertutup overlay berwarna. backdrop-blur
          sengaja TIDAK dipakai; satu layar koleksi memuat belasan kartu, dan
          belasan lapis blur adalah penyebab scroll berat di HP. */}
      {comic.isFavorite && (
        <span className="absolute right-2 top-2 rounded-full bg-night/60 px-2 py-0.5 text-xs">⭐</span>
      )}
      <span
        className={`absolute left-2 top-2 rounded-full border bg-night/60 px-2 py-0.5 text-[10px] font-semibold uppercase ${statusColor(
          comic.status,
        )}`}
      >
        {comic.status ?? 'Ongoing'}
      </span>
    </div>

    <div className="flex flex-1 flex-col gap-1 p-3">
      <h3 className="line-clamp-2 text-sm font-bold leading-snug">{comic.title}</h3>
      <p className="text-xs text-txt-2">
        {comic.totalChapters} chapter
        {comic.downloadedChapters !== undefined && ` · ${comic.downloadedChapters} tersimpan`}
      </p>
      {progress ? (
        <div className="mt-auto pt-2">
          <ProgressBar value={progress.progressPercentage ?? 0} />
          <p className="mt-1 text-[11px] text-txt-2">
            Ch. {progress.chapter?.number} · hal {progress.lastPageRead} ·{' '}
            {formatRelativeTime(progress.readAt)}
          </p>
        </div>
      ) : (
        <p className="mt-auto pt-2 text-[11px] text-txt-2">
          {comic.lastReadAt ? `Dibaca ${formatRelativeTime(comic.lastReadAt)}` : 'Belum dibaca'}
        </p>
      )}
    </div>
  </Link>
);

export const ComicRow = ({ comic }) => (
  <Link
    to={`/comic/${comic.slug}`}
    className="card flex items-center gap-4 p-3 transition-colors hover:border-primary/30 hover:bg-surface-soft"
  >
    <Cover comic={comic} className="h-20 w-14 flex-none rounded object-cover" />
    <div className="min-w-0 flex-1">
      <h3 className="truncate text-sm font-bold">{comic.title}</h3>
      <p className="truncate text-xs text-txt-2">
        {comic.author ?? 'Tanpa author'} · {comic.genres.join(', ') || 'Tanpa genre'}
      </p>
      <p className="mt-1 text-[11px] text-txt-2">
        {comic.totalChapters} chapter · diperbarui {formatRelativeTime(comic.updatedAt)}
      </p>
    </div>
    <span className={`chip flex-none ${statusColor(comic.status)}`}>{comic.status ?? 'Ongoing'}</span>
  </Link>
);

export default ComicCard;
