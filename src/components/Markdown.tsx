import { useEffect, useMemo, useRef } from 'preact/hooks';
import { renderMarkdown, toggleCheckbox, type MarkdownContext } from '../lib/markdown';
import { attachments, findTaskByRef, isClosed, usersByHandle, tasks, users } from '../store/data';
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
  const ref = useRef<HTMLDivElement>(null);

  // An image pasted into a text can be shown before its upload has finished: load it again
  // once the attachment arrives.
  useEffect(() => {
    for (const img of ref.current?.querySelectorAll<HTMLImageElement>('img[data-failed]') ?? []) {
      delete img.dataset.failed;
      img.src = `${img.src.split('?')[0]}?retry=${Date.now()}`;
    }
  }, [attachments.value]);

  const onClick = (e: MouseEvent) => {
    const el = e.target as HTMLElement;
    if (el instanceof HTMLInputElement && el.type === 'checkbox' && el.dataset.line) {
      e.stopPropagation();
      if (onChange) onChange(toggleCheckbox(source, Number(el.dataset.line)));
      else e.preventDefault();
    }
  };

  return (
    <div
      ref={ref}
      class={`markdown ${cls}`}
      onClick={onClick}
      onErrorCapture={(e) => {
        const img = e.target;
        if (img instanceof HTMLImageElement && new URL(img.src).pathname.startsWith('/api/attachments/')) img.dataset.failed = '';
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
