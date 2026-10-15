import { useMemo } from 'preact/hooks';
import { renderMarkdown, toggleCheckbox, type MarkdownContext } from '../lib/markdown';
import { findTaskByRef, isClosed, usersByHandle, tasks, users } from '../store/data';
import { route } from '../lib/router';

export function markdownContext(): MarkdownContext {
  const path = route.value.path.startsWith('/p/') || route.value.path === '/my' || route.value.path === '/inbox' ? route.value.path : '/my';
  return {
    task: (ref) => {
      const task = findTaskByRef(ref);
      return task ? { href: `${path}?task=${ref}`, title: task.title, closed: isClosed(task) } : null;
    },
    user: (handle) => usersByHandle.value[handle]?.name ?? null,
  };
}

export function Markdown({ source, onChange, class: cls = '' }: { source: string; onChange?: (next: string) => void; class?: string }) {
  // Re-render when tasks/users change so references stay fresh.
  const deps = [source, tasks.value, users.value, route.value.path];
  const html = useMemo(() => renderMarkdown(source, markdownContext()), deps);

  const onClick = (e: MouseEvent) => {
    const el = e.target as HTMLElement;
    if (el instanceof HTMLInputElement && el.type === 'checkbox' && el.dataset.line) {
      e.stopPropagation();
      if (onChange) onChange(toggleCheckbox(source, Number(el.dataset.line)));
      else e.preventDefault();
    }
  };

  return <div class={`markdown ${cls}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
