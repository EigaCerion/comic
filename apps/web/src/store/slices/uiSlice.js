import { createSlice } from '@reduxjs/toolkit';

const STORAGE_KEY = 'naruread:ui';

const loadPersisted = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
};

const persisted = loadPersisted();

const initialState = {
  theme: persisted.theme ?? 'dark', // light | dark
  viewMode: persisted.viewMode ?? 'grid', // grid | list
  sidebarOpen: false,
  toast: null,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setTheme(state, action) {
      state.theme = action.payload;
    },
    toggleTheme(state) {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
    },
    setViewMode(state, action) {
      state.viewMode = action.payload;
    },
    toggleSidebar(state) {
      state.sidebarOpen = !state.sidebarOpen;
    },
    closeSidebar(state) {
      state.sidebarOpen = false;
    },
    showToast(state, action) {
      state.toast = { id: Date.now(), ...action.payload };
    },
    dismissToast(state) {
      state.toast = null;
    },
  },
});

export const {
  setTheme,
  toggleTheme,
  setViewMode,
  toggleSidebar,
  closeSidebar,
  showToast,
  dismissToast,
} = uiSlice.actions;

/** Middleware kecil: simpan preferensi UI ke localStorage. */
export const uiPersistMiddleware = (store) => (next) => (action) => {
  const result = next(action);
  if (action.type?.startsWith('ui/')) {
    const { theme, viewMode } = store.getState().ui;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme, viewMode }));
    } catch {
      /* storage penuh / private mode — abaikan */
    }
  }
  return result;
};

export default uiSlice.reducer;
