import { signal } from '@preact/signals';
import { X } from 'lucide-preact';

interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
  action?: { label: string; run: () => void };
}

const toasts = signal<Toast[]>([]);
let seq = 0;

export function toast(message: string, opts: { kind?: 'info' | 'error'; action?: Toast['action']; duration?: number } = {}) {
  const id = ++seq;
  toasts.value = [...toasts.value.slice(-3), { id, message, kind: opts.kind ?? 'info', action: opts.action }];
  setTimeout(() => dismiss(id), opts.duration ?? (opts.action ? 6000 : 3500));
}

function dismiss(id: number) {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

export function Toasts() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.value.map((t) => (
        <div key={t.id} class={`toast ${t.kind}`}>
          <span class="toast-msg">{t.message}</span>
          {t.action && (
            <button
              class="toast-action"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button class="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
