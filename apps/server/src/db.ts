import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  Message,
  Task,
  TaskEvent,
  TaskStatus,
} from '@collabots/shared';

const DATA_DIR = process.env.COLLABOTS_DATA ?? join(homedir(), '.collabots');
mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(join(DATA_DIR, 'collabots.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  prompt        TEXT NOT NULL,
  repo_path     TEXT,
  worktree_path TEXT,
  branch        TEXT,
  agent         TEXT NOT NULL DEFAULT 'dsh',
  model         TEXT,
  status        TEXT NOT NULL,
  priority      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  started_at    INTEGER,
  ended_at      INTEGER,
  last_event_at INTEGER,
  tokens        INTEGER NOT NULL DEFAULT 0,
  last_line     TEXT,
  question      TEXT,
  turns         INTEGER NOT NULL DEFAULT 0,
  archived      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  id             TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  dsh_session_id TEXT,
  cwd            TEXT,
  pid            INTEGER,
  status         TEXT,
  started_at     INTEGER,
  ended_at       INTEGER,
  last_event_at  INTEGER,
  exit_code      INTEGER
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  session_id TEXT,
  seq        INTEGER NOT NULL,
  ts         INTEGER NOT NULL,
  kind       TEXT NOT NULL,
  payload    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  role    TEXT NOT NULL,
  text    TEXT NOT NULL,
  ts      INTEGER NOT NULL,
  kind    TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id, seq);
CREATE INDEX IF NOT EXISTS idx_messages_task ON messages(task_id, id);
`);

/* ── row mapping ─────────────────────────────────────────────────────── */

type TaskRow = Record<string, any>;

function toTask(r: TaskRow): Task {
  return {
    id: r.id,
    title: r.title,
    prompt: r.prompt,
    repoPath: r.repo_path,
    worktreePath: r.worktree_path,
    branch: r.branch,
    agent: r.agent,
    model: r.model,
    status: r.status as TaskStatus,
    priority: r.priority,
    createdAt: r.created_at,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    lastEventAt: r.last_event_at,
    tokens: r.tokens,
    lastLine: r.last_line,
    question: r.question,
    turns: r.turns,
    archived: r.archived,
  };
}

/* ── tasks ───────────────────────────────────────────────────────────── */

export function insertTask(t: Task): Task {
  db.prepare(
    `INSERT INTO tasks (id,title,prompt,repo_path,worktree_path,branch,agent,model,
       status,priority,created_at,started_at,ended_at,last_event_at,tokens,last_line,
       question,turns,archived)
     VALUES (@id,@title,@prompt,@repoPath,@worktreePath,@branch,@agent,@model,
       @status,@priority,@createdAt,@startedAt,@endedAt,@lastEventAt,@tokens,@lastLine,
       @question,@turns,@archived)`,
  ).run(t);
  return t;
}

export function getTask(id: string): Task | null {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
  return row ? toTask(row) : null;
}

export function listTasks(includeArchived = false): Task[] {
  const rows = db
    .prepare(
      `SELECT * FROM tasks ${includeArchived ? '' : 'WHERE archived = 0'}
       ORDER BY priority DESC, created_at ASC`,
    )
    .all() as TaskRow[];
  return rows.map(toTask);
}

const TASK_PATCH_COLUMNS: Record<string, string> = {
  title: 'title',
  prompt: 'prompt',
  repoPath: 'repo_path',
  worktreePath: 'worktree_path',
  branch: 'branch',
  agent: 'agent',
  model: 'model',
  status: 'status',
  priority: 'priority',
  startedAt: 'started_at',
  endedAt: 'ended_at',
  lastEventAt: 'last_event_at',
  tokens: 'tokens',
  lastLine: 'last_line',
  question: 'question',
  turns: 'turns',
  archived: 'archived',
};

export function updateTask(id: string, patch: Partial<Task>): Task | null {
  const sets: string[] = [];
  const values: Record<string, unknown> = { id };
  for (const [key, value] of Object.entries(patch)) {
    const col = TASK_PATCH_COLUMNS[key];
    if (!col) continue;
    sets.push(`${col} = @${key}`);
    values[key] = value ?? null;
  }
  if (sets.length) {
    db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = @id`).run(values);
  }
  return getTask(id);
}

/* ── messages ────────────────────────────────────────────────────────── */

export function insertMessage(
  m: Omit<Message, 'id'>,
): Message {
  const info = db
    .prepare('INSERT INTO messages (task_id,role,text,ts,kind) VALUES (?,?,?,?,?)')
    .run(m.taskId, m.role, m.text, m.ts, m.kind);
  return { id: Number(info.lastInsertRowid), ...m };
}

export function listMessages(taskId: string): Message[] {
  const rows = db
    .prepare('SELECT * FROM messages WHERE task_id = ? ORDER BY id ASC')
    .all(taskId) as any[];
  return rows.map((r) => ({
    id: r.id,
    taskId: r.task_id,
    role: r.role,
    text: r.text,
    ts: r.ts,
    kind: r.kind,
  }));
}

/* ── events ──────────────────────────────────────────────────────────── */

export function insertEvent(e: Omit<TaskEvent, 'id'>): void {
  db.prepare(
    'INSERT INTO events (task_id,session_id,seq,ts,kind,payload) VALUES (?,?,?,?,?,?)',
  ).run(e.taskId, e.sessionId, e.seq, e.ts, e.kind, JSON.stringify(e.payload));
}

export function listEvents(taskId: string, limit = 400): TaskEvent[] {
  const rows = db
    .prepare(
      'SELECT * FROM events WHERE task_id = ? ORDER BY id DESC LIMIT ?',
    )
    .all(taskId, limit) as any[];
  return rows.reverse().map((r) => ({
    id: r.id,
    taskId: r.task_id,
    sessionId: r.session_id,
    seq: r.seq,
    ts: r.ts,
    kind: r.kind,
    payload: JSON.parse(r.payload),
  }));
}

/* ── sessions ────────────────────────────────────────────────────────── */

export function upsertSession(s: {
  id: string;
  taskId: string;
  dshSessionId?: string | null;
  cwd?: string | null;
  pid?: number | null;
  status?: string | null;
  startedAt?: number | null;
  endedAt?: number | null;
  lastEventAt?: number | null;
  exitCode?: number | null;
}): void {
  db.prepare(
    `INSERT INTO sessions (id,task_id,dsh_session_id,cwd,pid,status,started_at,ended_at,last_event_at,exit_code)
     VALUES (@id,@taskId,@dshSessionId,@cwd,@pid,@status,@startedAt,@endedAt,@lastEventAt,@exitCode)
     ON CONFLICT(id) DO UPDATE SET
       dsh_session_id = COALESCE(excluded.dsh_session_id, sessions.dsh_session_id),
       status         = COALESCE(excluded.status, sessions.status),
       ended_at       = COALESCE(excluded.ended_at, sessions.ended_at),
       last_event_at  = COALESCE(excluded.last_event_at, sessions.last_event_at),
       exit_code      = COALESCE(excluded.exit_code, sessions.exit_code)`,
  ).run({
    dshSessionId: null,
    cwd: null,
    pid: null,
    status: null,
    startedAt: null,
    endedAt: null,
    lastEventAt: null,
    exitCode: null,
    ...s,
  });
}

export function latestDshSessionId(taskId: string): string | null {
  const row = db
    .prepare(
      `SELECT dsh_session_id FROM sessions WHERE task_id = ? AND dsh_session_id IS NOT NULL
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get(taskId) as { dsh_session_id: string } | undefined;
  return row?.dsh_session_id ?? null;
}
