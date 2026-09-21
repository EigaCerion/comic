import { useEffect } from 'react';

/**
 * Keyboard shortcut reader: ← → (halaman), space/shift+space, home/end,
 * [ ] (chapter), c (daftar chapter), f (fit), Escape (keluar).
 * Diabaikan saat fokus ada di input supaya tidak bentrok dengan form.
 *
 * `aktif` dipakai saat ada panel yang menutupi reader. Tanpa itu, panah di
 * dalam panel pemilih chapter ikut menggeser halaman di belakangnya dan Escape
 * menutup reader sekaligus panelnya.
 */
export const useKeyboardNav = (handlers, aktif = true) => {
  useEffect(() => {
    if (!aktif) return undefined;

    const onKeyDown = (event) => {
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;

      const map = {
        ArrowRight: handlers.next,
        ArrowDown: handlers.next,
        PageDown: handlers.next,
        ArrowLeft: handlers.prev,
        ArrowUp: handlers.prev,
        PageUp: handlers.prev,
        Home: handlers.first,
        End: handlers.last,
        '[': handlers.prevChapter,
        ']': handlers.nextChapter,
        c: handlers.chapterList,
        C: handlers.chapterList,
        f: handlers.toggleFit,
        Escape: handlers.exit,
      };

      if (event.key === ' ') {
        const action = event.shiftKey ? handlers.prev : handlers.next;
        if (action) {
          event.preventDefault();
          action();
        }
        return;
      }

      const action = map[event.key];
      if (action) {
        event.preventDefault();
        action();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers, aktif]);
};

export default useKeyboardNav;
