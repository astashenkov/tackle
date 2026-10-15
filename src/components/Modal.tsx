import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { X } from 'lucide-preact';
import { pushLayer } from '../lib/hotkeys';
import { t } from '../lib/i18n';

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 520,
  class: cls = '',
  hideHeader = false,
}: {
  title?: ComponentChildren;
  onClose: () => void;
  children: ComponentChildren;
  footer?: ComponentChildren;
  width?: number;
  class?: string;
  hideHeader?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const pop = pushLayer();
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) {
      (el.querySelector<HTMLElement>('[autofocus], input, textarea, select, button.primary') ?? el).focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.popover-layer')) {
        e.stopPropagation();
        closeRef.current();
      }
      // Keep focus inside the dialog.
      if (e.key === 'Tab' && el) {
        const focusables = [...el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
          (f) => !f.hasAttribute('disabled') && f.offsetParent !== null,
        );
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    el?.addEventListener('keydown', onKey);
    return () => {
      pop();
      el?.removeEventListener('keydown', onKey);
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div class="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} class={`modal ${cls}`} style={{ maxWidth: `${width}px` }} role="dialog" aria-modal="true" tabIndex={-1}>
        {!hideHeader && (
          <div class="modal-header">
            <div class="modal-title">{title}</div>
            <button class="icon-btn" onClick={onClose} aria-label={t('common.close')}>
              <X size={16} />
            </button>
          </div>
        )}
        <div class="modal-body">{children}</div>
        {footer && <div class="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

/* ------------------------------ confirm dialog ------------------------------ */

interface ConfirmState {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

const confirmState = signal<ConfirmState | null>(null);

export function confirm(opts: Omit<ConfirmState, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    confirmState.value = { ...opts, resolve };
  });
}

export function ConfirmDialog() {
  const s = confirmState.value;
  if (!s) return null;
  const done = (ok: boolean) => {
    confirmState.value = null;
    s.resolve(ok);
  };
  return (
    <Modal
      title={s.title}
      onClose={() => done(false)}
      width={420}
      footer={
        <>
          <button class="btn" onClick={() => done(false)}>
            {t('common.cancel')}
          </button>
          <button class={`btn ${s.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => done(true)}>
            {s.confirmLabel ?? t('common.confirm')}
          </button>
        </>
      }
    >
      {s.message && <p class="muted">{s.message}</p>}
    </Modal>
  );
}
