import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { api } from '../api/apiSlice.js';
import uiReducer, { uiPersistMiddleware } from './slices/uiSlice.js';
import readerReducer, { readerPersistMiddleware } from './slices/readerSlice.js';

export const store = configureStore({
  reducer: {
    [api.reducerPath]: api.reducer,
    ui: uiReducer,
    reader: readerReducer,
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
