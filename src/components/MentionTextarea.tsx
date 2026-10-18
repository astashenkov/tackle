import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { pastedFiles } from '../lib/files';
import { userList } from '../store/data';
import { Avatar } from './Avatar';
import { matchScore } from './Picker';

type Props = Omit<JSX.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onInput'> & {
  value: string;
  onValue: (v: string) => void;
  minRows?: number;
  textareaRef?: { current: HTMLTextAreaElement | null };
  /** Takes files pasted or dropped into the field; the text it returns is inserted at the cursor. */
  onFiles?: (files: File[]) => string;
};

/** Auto-growing textarea with @mention autocomplete. */
export function MentionTextarea({ value, onValue, minRows = 3, textareaRef, onKeyDown, onFiles, class: cls, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [active, setActive] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);

  // Preact doesn't emulate autofocus for elements mounted after page load.
  useEffect(() => {
    const el = ref.current;
    if (!rest.autoFocus || !el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const suggestions = useMemo(() => {
    if (!mention) return [];
    return userList.value
      .map((u) => ({ u, score: matchScore(`${u.handle} ${u.name}`, mention.query) }))
      .filter((x) => x.score !== null)
      .sort((a, b) => a.score! - b.score!)
      .slice(0, 6)
      .map((x) => x.u);
  }, [mention?.query, userList.value]);

  const detect = (el: HTMLTextAreaElement) => {
    const before = el.value.slice(0, el.selectionStart ?? 0);
    const m = /(^|[\s(])@([a-z0-9._-]*)$/i.exec(before);
    if (m) {
      setMention({ query: m[2], start: before.length - m[2].length - 1 });
      setActive(0);
    } else setMention(null);
  };

  const insert = (handle: string) => {
    const el = ref.current;
    if (!el || !mention) return;
    const caret = el.selectionStart ?? value.length;
    const next = `${value.slice(0, mention.start)}@${handle} ${value.slice(caret)}`;
    onValue(next);
    setMention(null);
    const pos = mention.start + handle.length + 2;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const takeFiles = (e: Event, files: File[]) => {
    const el = ref.current;
    if (!onFiles || !files.length || !el) return;
    e.preventDefault();
    const text = onFiles(files);
    if (!text) return;
    const start = el.selectionStart ?? value.length;
    const next = value.slice(0, start) + text + value.slice(el.selectionEnd ?? start);
    // Update the field right away so the caret lands after the link even if typing continues at once;
    // the re-render then finds the value unchanged and leaves the caret alone.
    el.value = next;
    el.focus();
    el.setSelectionRange(start + text.length, start + text.length);
    onValue(next);
  };

  const handleKey = (e: JSX.TargetedKeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && suggestions.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => (a + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if ((e.key === 'Enter' && !e.metaKey && !e.ctrlKey) || e.key === 'Tab') {
        e.preventDefault();
        insert(suggestions[active].handle);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setMention(null);
        return;
      }
    }
    onKeyDown?.(e);
  };

  return (
    <div class="mention-wrap">
      <textarea
        {...rest}
        ref={(el) => {
          ref.current = el;
          if (textareaRef) textareaRef.current = el;
        }}
        class={`textarea ${cls ?? ''}`}
        rows={minRows}
        value={value}
        onInput={(e) => {
          const el = e.currentTarget;
          onValue(el.value);
          detect(el);
        }}
        onKeyDown={handleKey}
        onPaste={(e) => takeFiles(e, pastedFiles(e.clipboardData))}
        onDrop={(e) => takeFiles(e, [...(e.dataTransfer?.files ?? [])])}
        onBlur={() => setTimeout(() => setMention(null), 120)}
        onClick={(e) => detect(e.currentTarget)}
      />
      {mention && suggestions.length > 0 && (
        <div class="mention-menu">
          {suggestions.map((u, i) => (
            <div
              key={u.id}
              class={`picker-item${i === active ? ' active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                insert(u.handle);
              }}
              onMouseMove={() => setActive(i)}
            >
              <Avatar user={u} size={18} />
              <span class="picker-label">{u.name}</span>
              <span class="picker-hint">@{u.handle}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
