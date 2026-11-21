/**
 * Shared contract between the Collabots board server and its web client.
 * Everything the UI renders is derived from these shapes.
 */

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'needs_input'
  | 'review'
  | 'failed'
  | 'stalled'
  | 'archived';

/** Statuses that require the user to act. These are what the inbox counts. */
export const ACTIONABLE: TaskStatus[] = ['needs_input', 'failed', 'review'];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  needs_input: 'Needs you',
  review: 'Review',
  failed: 'Failed',
  stalled: 'Stalled',
  archived: 'Archived',
};

export interface Task {
  id: string;
  title: string;
  prompt: string;
  repoPath: string | null;
  worktreePath: string | null;
  branch: string | null;
  agent: string;
  model: string | null;
  status: TaskStatus;
  priority: number;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  lastEventAt: number | null;
  /** total tokens reported by the harness for this task */
  tokens: number;
  /** one-line progress, shown on the card */
  lastLine: string | null;
  /** populated when status === 'needs_input' */
  question: string | null;
  turns: number;
  archived: number;
}

export type MessageRole = 'user' | 'agent' | 'system';

export interface Message {
  id: number;
  taskId: string;
  role: MessageRole;
  text: string;
  ts: number;
  /** 'ask' marks an agent question that blocked the task */
  kind: string | null;
}

/** A single normalized harness event, kept for replay and for the timeline view. */
export interface TaskEvent {
  id: number;
  taskId: string;
  sessionId: string | null;
  seq: number;
  ts: number;
  kind: string;
  payload: unknown;
}

export interface TaskDetail {
  task: Task;
  messages: Message[];
  events: TaskEvent[];
}

export type ServerMessage =
  | { type: 'snapshot'; tasks: Task[] }
  | { type: 'task'; task: Task }
  | { type: 'message'; message: Message }
  | { type: 'delta'; taskId: string; text: string }
  | { type: 'removed'; taskId: string };

export interface CreateTaskInput {
  title: string;
  prompt: string;
  repoPath?: string | null;
  autoWorktree?: boolean;
  priority?: number;
  startNow?: boolean;
}

export interface SendMessageInput {
  text: string;
  /** 'queue' delivers at the next turn boundary; 'interrupt' aborts the live turn */
  mode: 'queue' | 'interrupt';
}
