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
      query: ({ comicId, order = 'asc' }) => ({ url: `/comics/${comicId}/chapters`, params: { order } }),
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
    deleteChapter: builder.mutation({
      query: (chapterId) => ({ url: `/chapters/${chapterId}`, method: 'DELETE' }),
      invalidatesTags: ['Comics', 'Chapters', 'Stats'],
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
