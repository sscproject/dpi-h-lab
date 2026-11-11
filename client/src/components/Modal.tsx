// Centred pop-up dialog: focus moves in, Tab stays inside, Esc or the scrim closes it,
// and focus returns to whatever opened it.

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useContent } from '../content';

export function Modal({ title, onClose, children, closeLabel, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; closeLabel?: string; wide?: boolean }) {
  const { t } = useContent();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // The latest onClose, so a parent that re-renders (e.g. on every keystroke saved in the
  // dialog) doesn't re-run the setup below, which would pull focus out of the field.
  const close = useRef(onClose);
  close.current = onClose;

  // Runs once per opening: focus the first field (else the first button), trap Tab, and
  // give focus back to whatever opened the dialog when it closes.
  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    (ref.current?.querySelector<HTMLElement>('textarea, input, select') ?? ref.current?.querySelector<HTMLElement>('button'))?.focus();
    const onKey = (e: KeyboardEvent) => {
      // Esc inside an info popover closes only that popover.
      if (e.key === 'Escape' && !document.querySelector('.popover')) close.current();
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('button, input, textarea, select')].filter((x) => !x.hasAttribute('disabled'));
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      returnTo?.focus();
    };
  }, []);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div ref={ref} className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="head">
          <h2 id={titleId} className="modal-title">{title}</h2>
          <button type="button" className="btn small" onClick={onClose}>{closeLabel ?? t('info.close')}</button>
        </div>
        {children}
      </div>
    </>
  );
}
