import { useEffect, useRef, useState } from 'preact/hooks';
import type { Task } from '../../shared/types';
import { t } from '../lib/i18n';
import { createTask } from '../store/actions';

/** Inline "type a title, press Enter" creator used at the top of board columns and list groups. */
export function QuickAdd({ defaults, onDone, position }: { defaults: Partial<Task> & { projectId: string; statusId: string }; onDone: () => void; position?: () => number }) {
  const [title, setTitle] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);

  const submit = () => {
    const value = title.trim();
    if (!value) return onDone();
    void createTask({ ...defaults, title: value, ...(position ? { position: position() } : {}) });
    setTitle('');
  };

  return (
    <div class="quick-add">
      <input
        ref={ref}
        class="input"
        value={title}
        placeholder={t('task.quickAddPlaceholder')}
        onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onDone();
          }
        }}
        onBlur={() => !title.trim() && onDone()}
      />
      <div class="quick-add-hint">{t('task.quickAddHint')}</div>
    </div>
  );
}
