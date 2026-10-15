import type { Priority, StatusCategory } from '../../shared/types';

/* Hand-tuned status and priority glyphs in the spirit of Linear; everything else comes from lucide. */

export function StatusIcon({ category, color, size = 14, progress }: { category: StatusCategory; color: string; size?: number; progress?: number }) {
  const r = 6;
  const c = 2 * Math.PI * 3;
  const style = { color, flexShrink: 0 };
  switch (category) {
    case 'backlog':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" style={style} aria-hidden="true">
          <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2.2 2.2" />
        </svg>
      );
    case 'unstarted':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" style={style} aria-hidden="true">
          <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" stroke-width="1.5" />
        </svg>
      );
    case 'started': {
      const p = progress ?? 0.5;
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" style={style} aria-hidden="true">
          <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" stroke-width="1.5" />
          <circle
            cx="8"
            cy="8"
            r="3"
            fill="none"
            stroke="currentColor"
            stroke-width="6"
            stroke-dasharray={`${c * p} ${c}`}
            transform="rotate(-90 8 8)"
          />
        </svg>
      );
    }
    case 'completed':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" style={style} aria-hidden="true">
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="M5 8.2l2 2 4-4.2" fill="none" stroke="var(--bg)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      );
    case 'canceled':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" style={style} aria-hidden="true">
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="M5.7 5.7l4.6 4.6M10.3 5.7l-4.6 4.6" stroke="var(--bg)" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      );
  }
}

export function PriorityIcon({ priority, size = 14 }: { priority: Priority; size?: number }) {
  if (priority === 1) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" class="prio-icon urgent" aria-hidden="true">
        <rect x="1" y="1" width="14" height="14" rx="3.5" fill="currentColor" />
        <path d="M8 4.2v4.6" stroke="#fff" stroke-width="1.8" stroke-linecap="round" />
        <circle cx="8" cy="11.4" r="1.05" fill="#fff" />
      </svg>
    );
  }
  if (priority === 0) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" class="prio-icon none" aria-hidden="true">
        <rect x="1.5" y="7.25" width="3" height="1.5" rx="0.75" fill="currentColor" />
        <rect x="6.5" y="7.25" width="3" height="1.5" rx="0.75" fill="currentColor" />
        <rect x="11.5" y="7.25" width="3" height="1.5" rx="0.75" fill="currentColor" />
      </svg>
    );
  }
  // high = 3 bars, medium = 2, low = 1 (the rest are dimmed)
  const filled = 5 - priority;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" class="prio-icon" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={1.5 + i * 5}
          y={10 - i * 3.5}
          width="3"
          height={4.5 + i * 3.5}
          rx="1"
          fill="currentColor"
          opacity={i < filled ? 1 : 0.28}
        />
      ))}
    </svg>
  );
}
