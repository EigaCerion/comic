import { useEffect, useState } from 'react';

export const Spinner = ({ label = 'Memuat…' }) => (
  <div className="flex items-center justify-center gap-3 py-12 text-sm text-night/60 dark:text-paper/60">
    <span className="h-5 w-5 animate-spin rounded-full border-2 border-naruto border-t-transparent" />
    {label}
  </div>
);

export const EmptyState = ({ icon = '🍃', title, description, action }) => (
  <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
    <span className="text-4xl" aria-hidden="true">
      {icon}
    </span>
    <h3 className="text-base font-bold">{title}</h3>
    {description && (
      <p className="max-w-md text-sm text-night/60 dark:text-paper/60">{description}</p>
    )}
    {action}
  </div>
);

export const ErrorState = ({ error, onRetry }) => (
  <div className="card border-danger/40 px-6 py-10 text-center">
    <p className="text-sm font-semibold text-danger">Gagal memuat data</p>
    <p className="mt-2 text-xs text-night/60 dark:text-paper/60">
      {error?.data?.error ?? error?.error ?? 'Pastikan API di http://localhost:3000 sudah jalan.'}
    </p>
    {onRetry && (
      <button type="button" className="btn-ghost mt-4" onClick={onRetry}>
        Coba lagi
      </button>
    )}
  </div>
);

export const Badge = ({ children, className = '' }) => (
  <span className={`chip ${className}`}>{children}</span>
);

export const ProgressBar = ({ value = 0, className = '' }) => (
  <div className={`h-1.5 w-full overflow-hidden rounded-full bg-paper-line dark:bg-night-line ${className}`}>
    <div
      className="h-full rounded-full bg-naruto transition-[width] duration-300"
      style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
    />
  </div>
);

/** Input dengan debounce — dipakai search bar supaya tidak spam request. */
export const DebouncedInput = ({ value, onChange, delay = 300, ...props }) => {
  const [local, setLocal] = useState(value ?? '');

  useEffect(() => {
    setLocal(value ?? '');
  }, [value]);

  useEffect(() => {
    if (local === (value ?? '')) return undefined;
    const timer = setTimeout(() => onChange(local), delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, delay]);

  return <input {...props} value={local} onChange={(event) => setLocal(event.target.value)} />;
};
