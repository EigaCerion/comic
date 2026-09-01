import { useDispatch, useSelector } from 'react-redux';
import {
  resetImageAdjustments,
  setBrightness,
  setContrast,
  setFit,
  setMode,
  setPageGap,
  setZoom,
} from '../../store/slices/readerSlice.js';

const Segmented = ({ label, value, options, onChange }) => (
  <div>
    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-paper/50">{label}</p>
    <div className="flex overflow-hidden rounded-lg border border-night-line">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`flex-1 px-3 py-1.5 text-xs font-semibold transition ${
            value === option.value ? 'bg-naruto text-night' : 'text-paper/70 hover:bg-night-soft'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  </div>
);

const Slider = ({ label, value, min, max, step = 1, suffix = '%', onChange }) => (
  <label className="block">
    <span className="mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-paper/50">
      {label}
      <span className="font-mono text-paper/70">
        {value}
        {suffix}
      </span>
    </span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="w-full accent-naruto"
    />
  </label>
);

export const ReaderSettings = ({ onClose }) => {
  const dispatch = useDispatch();
  const { mode, fit, zoom, brightness, contrast, pageGap } = useSelector((state) => state.reader);

  return (
    <div className="absolute bottom-full right-0 mb-3 w-72 space-y-4 rounded-xl border border-night-line bg-night-card p-4 text-paper shadow-scroll animate-slide-up">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">Pengaturan Baca</h3>
        <button type="button" className="text-paper/50 hover:text-paper" onClick={onClose} aria-label="Tutup">
          ✕
        </button>
      </div>

      <Segmented
        label="Mode"
        value={mode}
        onChange={(value) => dispatch(setMode(value))}
        options={[
          { value: 'scroll', label: 'Scroll' },
          { value: 'single', label: 'Per halaman' },
        ]}
      />

      {mode === 'scroll' && (
        <Segmented
          label="Jarak antar halaman"
          value={pageGap}
          onChange={(value) => dispatch(setPageGap(value))}
          options={[
            { value: 'none', label: 'Rapat' },
            { value: 'small', label: 'Berjarak' },
          ]}
        />
      )}

      <Segmented
        label="Fit"
        value={fit}
        onChange={(value) => dispatch(setFit(value))}
        options={[
          { value: 'width', label: 'Lebar' },
          { value: 'height', label: 'Tinggi' },
          { value: 'original', label: 'Zoom' },
        ]}
      />

      {fit === 'original' && (
        <Slider label="Zoom" value={zoom} min={25} max={400} step={5} onChange={(v) => dispatch(setZoom(v))} />
      )}

      <Slider
        label="Brightness"
        value={brightness}
        min={40}
        max={140}
        onChange={(v) => dispatch(setBrightness(v))}
      />
      <Slider
        label="Contrast"
        value={contrast}
        min={60}
        max={160}
        onChange={(v) => dispatch(setContrast(v))}
      />

      <button type="button" className="btn-ghost w-full" onClick={() => dispatch(resetImageAdjustments())}>
        Reset tampilan
      </button>

      <p className="text-[11px] leading-relaxed text-paper/40">
        Shortcut: ← → halaman · [ ] chapter · Space lanjut · F ganti fit · Esc keluar
      </p>
    </div>
  );
};

export default ReaderSettings;
