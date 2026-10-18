import { useEffect, useState } from 'preact/hooks';
import { AtSign, CheckCheck, CircleDot, Eye, MessageSquare, UserPlus, Mail, MailOpen, Inbox as InboxIcon } from 'lucide-preact';
import type { Notification } from '../../shared/types';
import { relativeTime } from '../lib/date';
import { t, tx } from '../lib/i18n';
import { notifications, statuses, tasks, unreadCount, users, findTaskByRef } from '../store/data';
import { loadNotifications, markRead } from '../store/actions';
import { openTaskRef } from '../store/ui';
import { Avatar } from '../components/Avatar';
import { StatusIcon } from '../components/Icons';
import { EmptyState, PageHeader } from '../components/PageHeader';
import { openTaskPanel } from '../components/TaskPanel';
import { useHotkeys } from '../lib/hotkeys';

const KIND_ICON = {
  assigned: <UserPlus size={12} />,
  review: <Eye size={12} />,
  comment: <MessageSquare size={12} />,
  mention: <AtSign size={12} />,
  status: <CircleDot size={12} />,
};

function describe(n: Notification) {
  const actor = <strong>{(n.actorId && users.value[n.actorId]?.name) || t('common.someone')}</strong>;
  if (n.kind === 'status') {
    const s = n.data.statusId ? statuses.value[n.data.statusId] : null;
    return tx('inbox.status', {
      actor,
      status: s ? (
        <strong class="inline-status">
          <StatusIcon category={s.category} color={s.color} size={12} />
          {s.name}
        </strong>
      ) : (
        <strong>—</strong>
      ),
    });
  }
  return tx(`inbox.${n.kind}`, { actor });
}

export function Inbox() {
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  useEffect(() => void loadNotifications(), []);
  const list = (notifications.value ?? []).filter((n) => tasks.value[n.taskId] && (filter === 'all' || !n.readAt));

  const open = (n: Notification) => {
    if (!n.readAt) void markRead([n.id]);
    const task = tasks.value[n.taskId] ?? (n.data.taskRef ? findTaskByRef(n.data.taskRef) : undefined);
    if (task) openTaskPanel(task);
  };

  useHotkeys({
    'shift+r': () => {
      void markRead('all');
    },
  });

  return (
    <div class="page">
      <PageHeader
        title={t('nav.inbox')}
        tabs={
          <>
            <button class={`tab${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>
              {t('inbox.all')}
            </button>
            <button class={`tab${filter === 'unread' ? ' active' : ''}`} onClick={() => setFilter('unread')}>
              {t('inbox.unread')}
              {unreadCount.value > 0 && <span class="tab-badge">{unreadCount.value}</span>}
            </button>
          </>
        }
        actions={
          <button class="btn sm" disabled={!unreadCount.value} onClick={() => markRead('all')} title="Shift+R">
            <CheckCheck size={14} />
            <span class="hide-sm">{t('inbox.markAll')}</span>
          </button>
        }
      />
      <div class="page-scroll">
        {notifications.value && !list.length ? (
          <EmptyState icon={<InboxIcon size={28} />} title={filter === 'unread' ? t('inbox.emptyUnread') : t('inbox.empty')} text={t('inbox.emptyText')} />
        ) : (
          <div class="inbox-list">
            {list.map((n) => {
              const actor = n.actorId ? users.value[n.actorId] : null;
              const task = tasks.value[n.taskId];
              return (
                <div
                  key={n.id}
                  class={`inbox-item${n.readAt ? '' : ' unread'}${openTaskRef.value && openTaskRef.value === n.data.taskRef ? ' open' : ''}`}
                  onClick={() => open(n)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && open(n)}
                >
                  <span class="unread-dot" />
                  <span class="inbox-avatar">
                    <Avatar user={actor} size={28} />
                    <span class={`kind-badge ${n.kind}`}>{KIND_ICON[n.kind]}</span>
                  </span>
                  <div class="inbox-main">
                    <div class="inbox-line">
                      <span class="inbox-ref">{n.data.taskRef}</span>
                      <span class="inbox-title">{task?.title ?? n.data.taskTitle}</span>
                    </div>
                    <div class="inbox-desc">
                      {describe(n)}
                      {n.data.excerpt && <span class="inbox-excerpt"> — {n.data.excerpt.replace(/\s+/g, ' ').slice(0, 140)}</span>}
                    </div>
                  </div>
                  <span class="inbox-time">{relativeTime(n.createdAt)}</span>
                  <button
                    class="icon-btn sm inbox-toggle"
                    title={n.readAt ? t('inbox.markUnread') : t('inbox.markRead')}
                    onClick={(e) => {
                      e.stopPropagation();
                      void markRead([n.id], !!n.readAt);
                    }}
                  >
                    {n.readAt ? <Mail size={14} /> : <MailOpen size={14} />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
