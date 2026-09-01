import { forwardRef } from 'react';

const fitClass = (fit) => {
  // dvh, bukan vh: di browser HP address bar ikut menghitung tinggi viewport.
  if (fit === 'height') return 'max-h-[calc(100dvh-8rem)] w-auto';
  if (fit === 'original') return 'w-auto max-w-none';
  return 'w-full max-w-4xl';
};

/**
 * Satu halaman komik. Halaman pertama di-load eager, sisanya lazy —
 * cukup untuk target < 1.5s load di mode scroll.
 */
export const PageImage = forwardRef(({ page, fit, zoom, eager = false, onClick }, ref) => (
  <img
    ref={ref}
    src={page.url}
    alt={`Halaman ${page.number}`}
    data-page={page.number}
    onClick={onClick}
    loading={eager ? 'eager' : 'lazy'}
    decoding="async"
    className={`mx-auto block h-auto select-none align-bottom ${fitClass(fit)}`}
    style={fit === 'original' ? { width: `${zoom}%` } : undefined}
  />
));

PageImage.displayName = 'PageImage';

export default PageImage;
