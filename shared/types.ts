// Types shared by the server and the browser client.

export type ID = string;

export type Role = 'admin' | 'member';
export type StatusCategory = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';
/** 0 = no priority, 1 = urgent, 2 = high, 3 = medium, 4 = low (same scale as Linear). */
export type Priority = 0 | 1 | 2 | 3 | 4;
export type SprintState = 'planned' | 'active' | 'completed';

export interface Workspace {
  name: string;
}

export interface User {
  id: ID;
  email: string;
  name: string;
  /** Used for @mentions, e.g. "alex". Unique, lowercase. */
  handle: string;
  role: Role;
  color: string;
  active: boolean;
  createdAt: number;
}

export interface Project {
  id: ID;
  /** Short prefix for task identifiers, e.g. "WEB" → WEB-42. */
  key: string;
  name: string;
  description: string;
  color: string;
  position: number;
  archived: boolean;
  createdAt: number;
}

export interface Status {
  id: ID;
  name: string;
  category: StatusCategory;
  color: string;
  position: number;
}

export interface Label {
  id: ID;
  name: string;
  color: string;
}

export interface SprintStats {
  total: number;
  completed: number;
  points: number;
  completedPoints: number;
}

export interface Sprint {
  id: ID;
  projectId: ID;
  number: number;
  name: string;
  goal: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD, inclusive */
  endDate: string;
  state: SprintState;
  completedAt: number | null;
  /** Frozen numbers captured when the sprint was completed. */
  stats: SprintStats | null;
  createdAt: number;
}

export interface Task {
  id: ID;
  projectId: ID;
  /** Sequential number inside the project. 0 while an optimistic create is in flight. */
  number: number;
  title: string;
  description: string;
  statusId: ID;
  priority: Priority;
  assigneeId: ID | null;
  creatorId: ID | null;
  sprintId: ID | null;
  estimate: number | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
  labelIds: ID[];
  /** Manual ordering inside a column/group. Lower comes first. */
  position: number;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface Comment {
  id: ID;
  taskId: ID;
  authorId: ID | null;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export type ActivityKind =
  | 'created'
  | 'title'
  | 'description'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'sprint'
  | 'estimate'
  | 'due'
  | 'labels'
  | 'deleted'
  | 'restored';

export interface Activity {
  id: number;
  taskId: ID;
  actorId: ID | null;
  kind: ActivityKind;
  /** `from`/`to` values for field changes; label changes use `added`/`removed`. */
  data: { from?: unknown; to?: unknown; added?: ID[]; removed?: ID[] };
  createdAt: number;
}

export type NotificationKind = 'assigned' | 'comment' | 'mention' | 'status';

export interface Notification {
  id: number;
  taskId: ID;
  actorId: ID | null;
  kind: NotificationKind;
  data: { taskTitle?: string; taskRef?: string; excerpt?: string; statusId?: ID };
  createdAt: number;
  readAt: number | null;
}

export interface Invite {
  token: string;
  kind: 'invite' | 'reset';
  role: Role;
  userId: ID | null;
  createdAt: number;
  expiresAt: number;
}

export interface Snapshot {
  workspace: Workspace;
  me: User;
  users: User[];
  projects: Project[];
  statuses: Status[];
  labels: Label[];
  sprints: Sprint[];
  tasks: Task[];
  unread: number;
  serverTime: number;
}

/** Shape of a task patch accepted by PATCH /api/tasks/:id and POST /api/tasks/bulk. */
export interface TaskPatch {
  title?: string;
  description?: string;
  statusId?: ID;
  priority?: Priority;
  assigneeId?: ID | null;
  sprintId?: ID | null;
  estimate?: number | null;
  dueDate?: string | null;
  labelIds?: ID[];
  addLabelIds?: ID[];
  removeLabelIds?: ID[];
  position?: number;
}

export type ServerEvent =
  | { type: 'task.upsert'; data: Task }
  | { type: 'task.delete'; data: { id: ID } }
  | { type: 'project.upsert'; data: Project }
  | { type: 'project.delete'; data: { id: ID } }
  | { type: 'sprint.upsert'; data: Sprint }
  | { type: 'sprint.delete'; data: { id: ID } }
  | { type: 'label.upsert'; data: Label }
  | { type: 'label.delete'; data: { id: ID } }
  | { type: 'status.upsert'; data: Status }
  | { type: 'status.delete'; data: { id: ID } }
  | { type: 'user.upsert'; data: User }
  | { type: 'workspace.update'; data: Workspace }
  | { type: 'timeline'; data: { taskId: ID } }
  | { type: 'notification'; data: Notification }
  | { type: 'notifications.read'; data: { ids: number[] | 'all' } }
  | { type: 'resync'; data: Record<string, never> };

export interface ApiError {
  error: string;
  message: string;
}
