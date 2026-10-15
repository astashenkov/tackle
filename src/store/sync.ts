import { batch } from '@preact/signals';
import type { ServerEvent, Snapshot } from '../../shared/types';
import { api, clientId } from '../lib/api';
import { isPending, loadNotifications } from './actions';
import {
  applySnapshot,
  connection,
  drop,
  labels,
  me,
  notifications,
  projects,
  put,
  snapshotUnread,
  sprints,
  statuses,
  tasks,
  timelineVersion,
  users,
  workspace,
} from './data';

let source: EventSource | null = null;
let everConnected = false;

export async function loadSnapshot() {
  const snapshot = await api.get<Snapshot>('/sync');
  batch(() => applySnapshot(snapshot));
  void loadNotifications();
}

function handle(event: ServerEvent & { origin: string }) {
  // Our own changes were already applied optimistically.
  if (event.origin && event.origin === clientId && event.type !== 'notification') return;

  switch (event.type) {
    case 'task.upsert':
      if (!isPending(event.data.id)) put(tasks, event.data);
      break;
    case 'task.delete':
      drop(tasks, event.data.id);
      break;
    case 'project.upsert':
      put(projects, event.data);
      break;
    case 'project.delete':
      drop(projects, event.data.id);
      break;
    case 'sprint.upsert':
      put(sprints, event.data);
      break;
    case 'sprint.delete':
      drop(sprints, event.data.id);
      break;
    case 'label.upsert':
      put(labels, event.data);
      break;
    case 'label.delete':
      drop(labels, event.data.id);
      break;
    case 'status.upsert':
      put(statuses, event.data);
      break;
    case 'status.delete':
      drop(statuses, event.data.id);
      break;
    case 'user.upsert':
      put(users, event.data);
      if (me.value?.id === event.data.id) me.value = event.data;
      break;
    case 'workspace.update':
      workspace.value = event.data;
      break;
    case 'timeline': {
      const id = event.data.taskId;
      timelineVersion.value = { ...timelineVersion.value, [id]: (timelineVersion.value[id] ?? 0) + 1 };
      break;
    }
    case 'notification': {
      const list = notifications.value;
      if (list) notifications.value = [event.data, ...list.filter((n) => n.id !== event.data.id)];
      else snapshotUnread.value++;
      break;
    }
    case 'notifications.read': {
      const { ids } = event.data;
      const list = notifications.value;
      if (list) notifications.value = list.map((n) => (ids === 'all' || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? Date.now() } : n));
      break;
    }
    case 'resync':
      void loadSnapshot().catch(() => {});
      break;
  }
}

export function connectEvents() {
  source?.close();
  connection.value = 'connecting';
  source = new EventSource(`/api/events?clientId=${clientId}`);
  source.addEventListener('ready', () => {
    connection.value = 'online';
    // After a reconnect we may have missed events: refresh the snapshot.
    if (everConnected) void loadSnapshot().catch(() => {});
    everConnected = true;
  });
  source.onmessage = (e) => {
    try {
      handle(JSON.parse(e.data));
    } catch (err) {
      console.error('Bad event', err);
    }
  };
  source.onerror = () => {
    connection.value = 'connecting';
    if (source?.readyState === EventSource.CLOSED) {
      // The browser gave up (e.g. the session expired) — retry manually with backoff.
      setTimeout(() => {
        if (me.value) connectEvents();
      }, 5000);
    }
  };
}

export function disconnectEvents() {
  source?.close();
  source = null;
  everConnected = false;
}
