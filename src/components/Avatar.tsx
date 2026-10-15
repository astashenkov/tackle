import type { User } from '../../shared/types';

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

export function Avatar({ user, size = 20, title }: { user: User | null | undefined; size?: number; title?: string }) {
  const style = { width: `${size}px`, height: `${size}px`, fontSize: `${Math.max(9, Math.round(size * 0.42))}px` };
  if (!user) {
    return (
      <span class="avatar empty" style={style} title={title} aria-hidden="true">
        <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
          <circle cx="8" cy="5.5" r="2.6" />
          <path d="M2.8 14c.6-2.8 2.7-4.3 5.2-4.3s4.6 1.5 5.2 4.3" stroke-linecap="round" />
        </svg>
      </span>
    );
  }
  return (
    <span class={`avatar${user.active ? '' : ' inactive'}`} style={{ ...style, background: user.color }} title={title ?? user.name}>
      {initials(user.name)}
    </span>
  );
}
