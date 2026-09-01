import { createSlice } from '@reduxjs/toolkit';

const STORAGE_KEY = 'naruread:reader';

const loadPersisted = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
};

const persisted = loadPersisted();

const initialState = {
  mode: persisted.mode ?? 'scroll', // scroll | single
  pageGap: persisted.pageGap ?? 'none', // none | small — webtoon butuh rapat tanpa celah
  fit: persisted.fit ?? 'width', // width | height | original
  zoom: persisted.zoom ?? 100, // persen, hanya untuk fit=original
  brightness: persisted.brightness ?? 100,
  contrast: persisted.contrast ?? 100,
  showControls: true,
};

const readerSlice = createSlice({
  name: 'reader',
  initialState,
  reducers: {
    setMode(state, action) {
      state.mode = action.payload;
    },
    setPageGap(state, action) {
      state.pageGap = action.payload;
    },
    setFit(state, action) {
      state.fit = action.payload;
    },
    setZoom(state, action) {
      state.zoom = Math.min(400, Math.max(25, action.payload));
    },
    setBrightness(state, action) {
      state.brightness = action.payload;
    },
    setContrast(state, action) {
      state.contrast = action.payload;
    },
    toggleControls(state) {
      state.showControls = !state.showControls;
    },
    resetImageAdjustments(state) {
      state.brightness = 100;
      state.contrast = 100;
      state.zoom = 100;
    },
  },
});

export const {
  setMode,
  setPageGap,
  setFit,
  setZoom,
  setBrightness,
  setContrast,
  toggleControls,
  resetImageAdjustments,
} = readerSlice.actions;

export const readerPersistMiddleware = (store) => (next) => (action) => {
  const result = next(action);
  if (action.type?.startsWith('reader/')) {
    const { mode, fit, zoom, brightness, contrast, pageGap } = store.getState().reader;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ mode, fit, zoom, brightness, contrast, pageGap }),
      );
    } catch {
      /* abaikan */
    }
  }
  return result;
};

export default readerSlice.reducer;
