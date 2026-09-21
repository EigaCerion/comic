import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

// Dev: kosong (Vite proxy /api -> :3000). Prod: set VITE_API_URL.
const BASE_URL = `${import.meta.env.VITE_API_URL ?? ''}/api`;

export const api = createApi({
  reducerPath: 'api',
  // credentials: 'include' wajib — tanpa itu cookie sesi tidak pernah ikut
  // terkirim, dan setiap permintaan akan terlihat sebagai tamu.
  baseQuery: fetchBaseQuery({ baseUrl: BASE_URL, credentials: 'include' }),
  tagTypes: [
    'Comic',
    'Comics',
    'Chapters',
    'Chapter',
    'Downloads',
    'Bookmarks',
    'Stats',
    'Genres',
    'ImportScan',
    'ImportJobs',
    'Scout',
    'Audit',
    'Auth',
    'Users',
    'Rating',
    'Comments',
  ],
  keepUnusedDataFor: 120,
  endpoints: (builder) => ({
    health: builder.query({ query: () => '/health' }),

    // ── Comics ──────────────────────────────────────────────────────
    getComics: builder.query({
      query: (params = {}) => ({ url: '/comics', params }),
      providesTags: ['Comics'],
    }),
    getContinueReading: builder.query({
      query: (limit = 8) => ({ url: '/comics/continue', params: { limit } }),
      providesTags: ['Comics'],
    }),
    getComic: builder.query({
      query: (idOrSlug) => `/comics/${idOrSlug}`,
      providesTags: (result, error, arg) => [{ type: 'Comic', id: arg }],
    }),
    getChapters: builder.query({
      // ringkas: bentuk hemat tanpa slug/sumber/ukuran berkas — dipakai pemilih
      // chapter di reader, yang bisa memuat ratusan baris sekaligus.
      query: ({ comicId, order = 'asc', ringkas = false }) => ({
        url: `/comics/${comicId}/chapters`,
        params: ringkas ? { order, ringkas: 1 } : { order },
      }),
      providesTags: (result, error, arg) => [{ type: 'Chapters', id: arg.comicId }],
    }),
    toggleFavorite: builder.mutation({
      query: (comicId) => ({ url: `/comics/${comicId}/favorite`, method: 'POST' }),
      invalidatesTags: (result, error, comicId) => [{ type: 'Comic', id: comicId }, 'Comics'],
    }),
    updateComic: builder.mutation({
      query: ({ comicId, ...patch }) => ({ url: `/comics/${comicId}`, method: 'PATCH', body: patch }),
      invalidatesTags: (result, error, arg) => [{ type: 'Comic', id: arg.comicId }, 'Comics'],
    }),
    setCoverFromPage: builder.mutation({
      query: (comicId) => ({ url: `/comics/${comicId}/cover/from-page`, method: 'POST' }),
      invalidatesTags: (result, error, comicId) => [{ type: 'Comic', id: comicId }, 'Comics'],
    }),
    setCoverFromUrl: builder.mutation({
      query: ({ comicId, url }) => ({
        url: `/comics/${comicId}/cover/from-url`,
        method: 'POST',
        body: { url },
      }),
      invalidatesTags: (result, error, arg) => [{ type: 'Comic', id: arg.comicId }, 'Comics'],
    }),
    deleteComic: builder.mutation({
      query: (comicId) => ({ url: `/comics/${comicId}`, method: 'DELETE' }),
      invalidatesTags: ['Comics', 'Stats'],
    }),

    // ── Chapters ────────────────────────────────────────────────────
    getChapter: builder.query({
      query: (chapterId) => `/chapters/${chapterId}`,
      providesTags: (result, error, arg) => [{ type: 'Chapter', id: arg }],
    }),
    saveProgress: builder.mutation({
      query: ({ chapterId, lastPageRead }) => ({
        url: `/chapters/${chapterId}/progress`,
        method: 'PUT',
        body: { last_page_read: lastPageRead },
      }),
    }),
    // Server ikut menghapus posisi baca, bookmark, dan job antrian chapter ini
    // lewat ON DELETE CASCADE. Tanpa 'Bookmarks' dan 'Downloads' di sini, daftar
    // bookmark masih menawarkan tautan ke chapter yang sudah tidak ada; tanpa
    // 'Comic', chip "N chapter" di halaman detail tetap menyebut angka lama.
    deleteChapter: builder.mutation({
      query: (chapterId) => ({ url: `/chapters/${chapterId}`, method: 'DELETE' }),
      invalidatesTags: ['Comic', 'Comics', 'Chapters', 'Stats', 'Bookmarks', 'Downloads'],
    }),
    // Unduh ulang ke baris chapter yang SAMA. Halaman barunya baru ada setelah
    // worker selesai, tapi tautan sumber chapter bisa langsung berubah dan job
    // barunya langsung tampil di antrian — dua itu yang perlu segar sekarang.
    gantiChapter: builder.mutation({
      query: ({ chapterId, chapterUrl, imageUrls }) => ({
        url: `/chapters/${chapterId}/ganti`,
        method: 'POST',
        body: {
          ...(chapterUrl ? { chapter_url: chapterUrl } : {}),
          ...(imageUrls?.length ? { image_urls: imageUrls } : {}),
        },
      }),
      invalidatesTags: (_r, _e, { chapterId }) => [{ type: 'Chapter', id: chapterId }, 'Chapters', 'Downloads'],
    }),

    // ── Search ──────────────────────────────────────────────────────
    search: builder.query({
      query: (q) => ({ url: '/search', params: { q } }),
    }),
    getGenres: builder.query({
      query: () => '/search/genres',
      providesTags: ['Genres'],
    }),

    // ── Downloads ───────────────────────────────────────────────────
    getDownloads: builder.query({
      query: (status = '') => ({ url: '/downloads', params: status ? { status } : {} }),
      providesTags: ['Downloads'],
    }),
    enqueueDownload: builder.mutation({
      query: (body) => ({ url: '/downloads', method: 'POST', body }),
      invalidatesTags: ['Downloads', 'Chapters', 'Comics'],
    }),
    retryDownload: builder.mutation({
      query: (id) => ({ url: `/downloads/${id}/retry`, method: 'POST' }),
      invalidatesTags: ['Downloads'],
    }),
    cancelDownload: builder.mutation({
      query: (id) => ({ url: `/downloads/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Downloads'],
    }),
    pauseQueue: builder.mutation({
      query: () => ({ url: '/downloads/pause', method: 'POST' }),
      invalidatesTags: ['Downloads'],
    }),
    resumeQueue: builder.mutation({
      query: () => ({ url: '/downloads/resume', method: 'POST' }),
      invalidatesTags: ['Downloads'],
    }),
    clearQueue: builder.mutation({
      query: () => ({ url: '/downloads/clear', method: 'POST' }),
      invalidatesTags: ['Downloads'],
    }),

    // ── Upload manual (multipart, jangan set Content-Type manual) ────
    uploadComic: builder.mutation({
      query: (formData) => ({ url: '/uploads/comic', method: 'POST', body: formData }),
      invalidatesTags: ['Comics', 'Genres', 'Stats'],
    }),
    uploadChapter: builder.mutation({
      query: (formData) => ({ url: '/uploads/chapter', method: 'POST', body: formData }),
      invalidatesTags: ['Comics', 'Chapters', 'Stats'],
    }),

    // ── Import lokal (folder / CBZ) ──────────────────────────────────
    getImportConfig: builder.query({ query: () => '/imports/config' }),
    scanImport: builder.query({
      query: () => '/imports/scan',
      providesTags: ['ImportScan'],
    }),
    importLocal: builder.mutation({
      query: (body) => ({ url: '/imports/local', method: 'POST', body }),
      invalidatesTags: ['ImportJobs'],
    }),
    importArchive: builder.mutation({
      query: (formData) => ({ url: '/imports/archive', method: 'POST', body: formData }),
      invalidatesTags: ['ImportJobs'],
    }),
    getImportJobs: builder.query({
      query: () => '/imports/jobs',
      providesTags: ['ImportJobs'],
    }),

    // ── Import dari URL ─────────────────────────────────────────────
    previewSeries: builder.mutation({
      query: (url) => ({ url: '/imports/url/preview', method: 'POST', body: { url } }),
    }),
    previewChapterUrl: builder.mutation({
      query: (url) => ({ url: '/imports/url/chapter-preview', method: 'POST', body: { url } }),
    }),
    importFromUrl: builder.mutation({
      query: (body) => ({ url: '/imports/url', method: 'POST', body }),
      invalidatesTags: ['Comics', 'Chapters', 'Downloads', 'Genres'],
    }),

    // ── Scout (etalase situs sumber) ────────────────────────────────
    getScout: builder.query({
      query: (params = {}) => ({ url: '/scout', params }),
      providesTags: ['Scout'],
    }),
    // Balasan POST ini bentuknya sama dengan GET, tapi sengaja dibuang dan
    // diganti refetch lewat tag: halaman memegang satu entri cache per bagian,
    // dan menulis hasil refresh ke salah satunya saja membuat bagian lain basi
    // tanpa ada yang memberi tahu.
    refreshScout: builder.mutation({
      query: () => ({ url: '/scout/refresh', method: 'POST', body: {} }),
      invalidatesTags: ['Scout'],
    }),
    // Sama seperti import dari URL, ini melahirkan komik dan mengantre chapter
    // sekaligus — jadi rak, daftar chapter, dan antrian unduhan ikut berubah.
    importScoutItem: builder.mutation({
      query: ({ id, hanyaBaru = false }) => ({
        url: `/scout/${id}/import`,
        method: 'POST',
        body: hanyaBaru ? { hanyaBaru: true } : {},
      }),
      invalidatesTags: ['Scout', 'Comics', 'Chapters', 'Downloads', 'Genres'],
    }),
    // Sengaja tanpa providesTags. Tag 'Scout' dibatalkan oleh setiap Segarkan
    // dan setiap impor; kalau hasil cari ikut memegangnya, kotak hasil akan
    // menembak ulang situs sumber tanpa ada yang menekan Cari — dan tiap
    // tembakan memakan jatah 20 pencarian per menit milik akun ini. Kartu yang
    // baru diimpor dari sini ditandai "sudah diantre" oleh halamannya sendiri.
    cariScout: builder.query({
      query: (q) => ({ url: '/scout/cari', params: { q } }),
    }),
    // Kembaran importScoutItem untuk kartu hasil cari: kartu itu tidak punya
    // baris scout_items, jadi yang dirujuk adalah URL serinya, bukan id.
    imporScoutUrl: builder.mutation({
      query: ({ seriesUrl, hanyaBaru = false }) => ({
        url: '/scout/impor-url',
        method: 'POST',
        body: hanyaBaru ? { seriesUrl, hanyaBaru: true } : { seriesUrl },
      }),
      invalidatesTags: ['Scout', 'Comics', 'Chapters', 'Downloads', 'Genres'],
    }),

    // ── Sambungkan perangkat ────────────────────────────────────────
    getConnect: builder.query({ query: () => '/connect' }),

    // ── Pengawas (audit) ────────────────────────────────────────────
    getAudit: builder.query({
      query: () => '/audit',
      providesTags: ['Audit'],
    }),
    auditComic: builder.mutation({
      query: ({ comicId, full = false }) => ({
        url: `/audit/comics/${comicId}${full ? '?full=1' : ''}`,
        method: 'POST',
      }),
      invalidatesTags: ['Audit'],
    }),
    resyncComic: builder.mutation({
      query: ({ comicId, seriesUrl }) => ({
        url: `/audit/comics/${comicId}/resync`,
        method: 'POST',
        body: seriesUrl ? { series_url: seriesUrl } : {},
      }),
      invalidatesTags: ['Audit', 'Downloads', 'Chapters', 'Comics'],
    }),
    // Cek update seluruh koleksi. Statusnya di-poll saat berjalan; hasilnya
    // menyentuh antrian, daftar chapter, dan komik sekaligus.
    getResyncAll: builder.query({
      query: () => '/audit/resync-all',
    }),
    startResyncAll: builder.mutation({
      query: () => ({ url: '/audit/resync-all', method: 'POST' }),
    }),
    stopResyncAll: builder.mutation({
      query: () => ({ url: '/audit/resync-all/stop', method: 'POST' }),
    }),

    dismissFinding: builder.mutation({
      query: ({ id, alasan }) => ({
        url: `/audit/findings/${id}/dismiss`,
        method: 'POST',
        body: alasan ? { alasan } : {},
      }),
      invalidatesTags: ['Audit'],
    }),
    repairAudit: builder.mutation({
      query: (comicId = null) => ({
        url: '/audit/repair',
        method: 'POST',
        body: comicId ? { comic_id: comicId } : {},
      }),
      invalidatesTags: ['Audit', 'Downloads'],
    }),

    // ── Akun & peran ────────────────────────────────────────────────
    me: builder.query({
      query: () => '/auth/me',
      providesTags: ['Auth'],
    }),
    login: builder.mutation({
      query: (body) => ({ url: '/auth/login', method: 'POST', body }),
      // Hampir semua daftar berubah isinya begitu peran berubah, jadi cache
      // lama dibuang seluruhnya daripada menebak mana yang masih sahih.
      invalidatesTags: ['Auth', 'Users', 'Downloads', 'Audit', 'Comments', 'Rating'],
    }),
    register: builder.mutation({
      query: (body) => ({ url: '/auth/register', method: 'POST', body }),
      invalidatesTags: ['Auth'],
    }),
    logout: builder.mutation({
      query: () => ({ url: '/auth/logout', method: 'POST' }),
      invalidatesTags: ['Auth', 'Users', 'Downloads', 'Audit', 'Comments', 'Rating'],
    }),
    gantiSandi: builder.mutation({
      query: (body) => ({ url: '/auth/password', method: 'POST', body }),
      invalidatesTags: ['Auth'],
    }),

    getUsers: builder.query({
      query: () => '/users',
      providesTags: ['Users'],
    }),
    createUser: builder.mutation({
      query: (body) => ({ url: '/users', method: 'POST', body }),
      invalidatesTags: ['Users'],
    }),
    updateUser: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/users/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Users'],
    }),
    deleteUser: builder.mutation({
      query: (id) => ({ url: `/users/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Users'],
    }),

    // ── Rating & komentar ───────────────────────────────────────────
    getRating: builder.query({
      query: (comicId) => `/comics/${comicId}/rating`,
      providesTags: (_r, _e, comicId) => [{ type: 'Rating', id: comicId }],
    }),
    setRating: builder.mutation({
      query: ({ comicId, value }) => ({ url: `/comics/${comicId}/rating`, method: 'PUT', body: { value } }),
      invalidatesTags: (_r, _e, { comicId }) => [{ type: 'Rating', id: comicId }, 'Comics', 'Comic'],
    }),
    hapusRating: builder.mutation({
      query: (comicId) => ({ url: `/comics/${comicId}/rating`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, comicId) => [{ type: 'Rating', id: comicId }, 'Comics', 'Comic'],
    }),
    getComments: builder.query({
      query: (comicId) => `/comics/${comicId}/comments`,
      providesTags: (_r, _e, comicId) => [{ type: 'Comments', id: comicId }],
    }),
    addComment: builder.mutation({
      query: ({ comicId, body }) => ({ url: `/comics/${comicId}/comments`, method: 'POST', body: { body } }),
      invalidatesTags: (_r, _e, { comicId }) => [{ type: 'Comments', id: comicId }],
    }),
    deleteComment: builder.mutation({
      query: ({ id }) => ({ url: `/comments/${id}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, { comicId }) => [{ type: 'Comments', id: comicId }],
    }),
    hideComment: builder.mutation({
      query: ({ id, sembunyikan }) => ({ url: `/comments/${id}/hide`, method: 'POST', body: { sembunyikan } }),
      invalidatesTags: (_r, _e, { comicId }) => [{ type: 'Comments', id: comicId }],
    }),

    // ── Bookmarks & stats ───────────────────────────────────────────
    getBookmarks: builder.query({
      query: (comicId) => ({ url: '/bookmarks', params: comicId ? { comic_id: comicId } : {} }),
      providesTags: ['Bookmarks'],
    }),
    addBookmark: builder.mutation({
      query: (body) => ({ url: '/bookmarks', method: 'POST', body }),
      invalidatesTags: ['Bookmarks'],
    }),
    deleteBookmark: builder.mutation({
      query: (id) => ({ url: `/bookmarks/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Bookmarks'],
    }),
    getStats: builder.query({ query: () => '/stats', providesTags: ['Stats'] }),
  }),
});

export const {
  useHealthQuery,
  useGetComicsQuery,
  useGetContinueReadingQuery,
  useGetComicQuery,
  useGetChaptersQuery,
  useToggleFavoriteMutation,
  useUpdateComicMutation,
  useSetCoverFromPageMutation,
  useSetCoverFromUrlMutation,
  useDeleteComicMutation,
  useGetChapterQuery,
  useSaveProgressMutation,
  useDeleteChapterMutation,
  useGantiChapterMutation,
  useSearchQuery,
  useGetGenresQuery,
  useGetDownloadsQuery,
  useEnqueueDownloadMutation,
  useRetryDownloadMutation,
  useCancelDownloadMutation,
  usePauseQueueMutation,
  useResumeQueueMutation,
  useClearQueueMutation,
  useUploadComicMutation,
  useUploadChapterMutation,
  useGetImportConfigQuery,
  useScanImportQuery,
  useImportLocalMutation,
  useImportArchiveMutation,
  useGetImportJobsQuery,
  usePreviewSeriesMutation,
  usePreviewChapterUrlMutation,
  useImportFromUrlMutation,
  useGetScoutQuery,
  useRefreshScoutMutation,
  useImportScoutItemMutation,
  useLazyCariScoutQuery,
  useImporScoutUrlMutation,
  useGetConnectQuery,
  useGetAuditQuery,
  useAuditComicMutation,
  useResyncComicMutation,
  useGetResyncAllQuery,
  useStartResyncAllMutation,
  useStopResyncAllMutation,
  useDismissFindingMutation,

  // Akun & peran
  useMeQuery,
  useLoginMutation,
  useRegisterMutation,
  useLogoutMutation,
  useGantiSandiMutation,
  useGetUsersQuery,
  useCreateUserMutation,
  useUpdateUserMutation,
  useDeleteUserMutation,

  // Rating & komentar
  useGetRatingQuery,
  useSetRatingMutation,
  useHapusRatingMutation,
  useGetCommentsQuery,
  useAddCommentMutation,
  useDeleteCommentMutation,
  useHideCommentMutation,
  useRepairAuditMutation,
  useGetBookmarksQuery,
  useAddBookmarkMutation,
  useDeleteBookmarkMutation,
  useGetStatsQuery,
} = api;
