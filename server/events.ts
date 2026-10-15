import type { ServerEvent } from '../shared/types';

interface Client {
  userId: string;
  clientId: string;
  send: (payload: string) => void;
}

/**
 * Fan-out hub for Server-Sent Events. Every mutation is broadcast to all connected
 * browsers so boards update live; each event carries the id of the browser tab that
 * caused it, so that tab can skip its own echo (it already applied the change optimistically).
 */
export class EventHub {
  private clients = new Set<Client>();

  /** Defers delivery, e.g. until the database transaction that produced the event commits. */
  constructor(private defer: (send: () => void) => void = (send) => send()) {}

  add(client: Client): () => void {
    this.clients.add(client);
    return () => this.clients.delete(client);
  }

  get size() {
    return this.clients.size;
  }

  broadcast(event: ServerEvent, origin = '') {
    const payload = JSON.stringify({ ...event, origin });
    this.defer(() => {
      for (const c of this.clients) c.send(payload);
    });
  }

  toUser(userId: string, event: ServerEvent, origin = '') {
    const payload = JSON.stringify({ ...event, origin });
    this.defer(() => {
      for (const c of this.clients) if (c.userId === userId) c.send(payload);
    });
  }

  /** Disconnects all sessions of a user (e.g. after deactivation). */
  kick(userId: string) {
    const payload = JSON.stringify({ type: 'resync', data: {}, origin: '' });
    for (const c of this.clients) if (c.userId === userId) c.send(payload);
  }
}
