import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { api } from '../api/apiSlice.js';
import { IS_APP } from '../platform/index.js';
import uiReducer, { uiPersistMiddleware } from './slices/uiSlice.js';
import readerReducer, { readerPersistMiddleware } from './slices/readerSlice.js';
import { unduhanReducer } from './slices/unduhanSlice.js';

// Antrean "simpan ke HP" hanya ada di build Android. Ditulis sebagai sebaran
// objek, bukan cabang di dalam reducer, supaya pada build web ekspresi ini
// runtuh jadi `{}` dan irisannya ikut dibuang Rollup.
const reducerApp = IS_APP ? { unduhan: unduhanReducer } : {};

export const store = configureStore({
  reducer: {
    [api.reducerPath]: api.reducer,
    ui: uiReducer,
    reader: readerReducer,
    ...reducerApp,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      // RTK Query menyimpan objek Request/Response di meta, dan upload memakai
      // FormData — keduanya memang non-serializable dan aman diabaikan.
      serializableCheck: {
        ignoredActions: ['api/executeMutation/pending'],
        ignoredActionPaths: [
          'meta.arg',
          'meta.baseQueryMeta.request',
          'meta.baseQueryMeta.response',
          'payload.formData',
        ],
      },
    }).concat(api.middleware, uiPersistMiddleware, readerPersistMiddleware),
});

setupListeners(store.dispatch);

export default store;
