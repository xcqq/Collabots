import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  CreateTaskInput,
  Message,
  ServerMessage,
  Task,
  TaskStatus,
} from '@collabots/shared';
import {
  getTask,
  insertEvent,
  insertMessage,
  insertTask,
  latestDshSessionId,
  listMessages,
  listTasks,
  updateTask,
  upsertSession,
} from './db.ts';
import { runTurn, type DshEvent, type TurnHandle } from './dsh.ts';
import { prepareWorkspace } from './worktree.ts';

/** How many harness processes may run at once. */
const CONCURRENCY = Number(process.env.COLLABOTS_CONCURRENCY ?? 2);

/** A turn that has produced nothing for this long is considered stuck. */
const STALL_MS = Number(process.env.COLLABOTS_STALL_MS ?? 10 * 60_000);

/**
 * The agent signals "I need a decision" by ending its reply with a line
 * `ASK: <question>`. Headless runs are fire-and-forget, so there is no
 * interactive prompt to observe — this convention is the honest way to get a
 * reliable needs_input signal without reverse-engineering the harness.
 */
const ASK_RE = /^\s*ASK:\s*(.+)$/im;

interface LiveTurn {
  taskId: string;
  handle: TurnHandle;
  sessionId: string | null;
  text: string;
  startedAt: number;
  interrupted: boolean;
}

interface PendingMessage {
  text: string;
  mode: 'queue' | 'interrupt';
}

export class Board extends EventEmitter {
  private live = new Map<string, LiveTurn>();
  private pending = new Map<string, PendingMessage[]>();
  private seq = new Map<string, number>();

  emitMessage(msg: ServerMessage) {
    this.emit('message', msg);
  }

  private emitTask(task: Task | null, id: string) {
    if (!task) return;
    this.emit('message', { type: 'task', task } satisfies ServerMessage);
  }

  private nextSeq(taskId: string): number {
    const n = (this.seq.get(taskId) ?? 0) + 1;
    this.seq.set(taskId, n);
    return n;
  }

  private touch(task: Task, patch: Partial<Task> = {}): Task {
    const next = updateTask(task.id, {
      lastEventAt: Date.now(),
      ...patch,
    })!;
    this.emitTask(next, task.id);
    return next;
  }

  /* ── task lifecycle ────────────────────────────────────────────────── */

  async createTask(input: CreateTaskInput): Promise<Task> {
    const id = randomUUID();
    const now = Date.now();
    let task: Task = {
      id,
      title: input.title.trim() || 'Untitled task',
      prompt: input.prompt.trim(),
      repoPath: input.repoPath?.trim() || null,
      worktreePath: null,
      branch: null,
      agent: 'dsh',
      model: null,
      status: 'queued',
      priority: input.priority ?? 0,
      createdAt: now,
      startedAt: null,
      endedAt: null,
      lastEventAt: null,
      tokens: 0,
      lastLine: null,
      question: null,
      turns: 0,
      archived: 0,
    };
    insertTask(task);

    if (input.startNow !== false) {
      await this.startTask(id);
    } else {
      this.emitTask(task, id);
    }
    return getTask(id)!;
  }

  async startTask(id: string): Promise<void> {
    const task = getTask(id);
    if (!task || task.status === 'running') return;

    const ws = await prepareWorkspace(task.repoPath, task.id, true);
    const updated = updateTask(id, {
      worktreePath: ws.path,
      branch: ws.branch,
      status: 'queued',
      startedAt: Date.now(),
    })!;
    this.emitTask(updated, id);
    this.pump();
  }

  /** Kick the queue until the concurrency limit is reached. */
  private pump() {
    if (this.live.size >= CONCURRENCY) return;
    const next = listTasks().find(
      (t) => t.status === 'queued' && !this.live.has(t.id),
    );
    if (!next) return;
    void this.beginTurn(next, next.prompt);
  }

  private async beginTurn(task: Task, prompt: string): Promise<void> {
    const cwd = task.worktreePath ?? task.repoPath ?? process.cwd();
    const priorSession = latestDshSessionId(task.id);

    const sessionRowId = randomUUID();
    const startedAt = Date.now();
    upsertSession({
      id: sessionRowId,
      taskId: task.id,
      cwd,
      status: 'running',
      startedAt,
    });

    const handle = runTurn({
      cwd,
      prompt,
      sessionId: priorSession,
      onEvent: (e: DshEvent) => this.recordEvent(task.id, sessionRowId, e),
      onText: (delta) => {
        const live = this.live.get(task.id);
        if (!live) return;
        live.text += delta;
        this.emitMessage({ type: 'delta', taskId: task.id, text: live.text });
      },
    });

    this.live.set(task.id, {
      taskId: task.id,
      handle,
      sessionId: priorSession,
      text: '',
      startedAt,
      interrupted: false,
    });

    this.touch(task, {
      status: 'running',
      lastLine: 'starting harness…',
      question: null,
      turns: task.turns + 1,
      endedAt: null,
    });
    this.emitMessage({ type: 'delta', taskId: task.id, text: '' });

    const result = await handle.done;
    this.live.delete(task.id);

    if (result.sessionId) {
      upsertSession({
        id: sessionRowId,
        taskId: task.id,
        dshSessionId: result.sessionId,
        status: 'ended',
        endedAt: Date.now(),
        exitCode: result.exitCode,
      });
    }

    const current = getTask(task.id);
    if (!current) return;

    const text = result.finalText.trim();

    if (text) {
      const ask = text.match(ASK_RE);
      // Keep the ASK: marker out of the transcript — the question is surfaced
      // separately as `task.question`, so showing it twice is just noise.
      const body = ask ? text.replace(ASK_RE, '').trim() : text;
      insertMessage({
        taskId: task.id,
        role: 'agent',
        text: body || text,
        ts: Date.now(),
        kind: ask ? 'ask' : null,
      });
      this.emitMessage({
        type: 'message',
        message: listMessages(task.id).at(-1)!,
      });
      this.emitMessage({ type: 'delta', taskId: task.id, text: '' });

      if (ask) {
        this.touch(current, {
          status: 'needs_input',
          question: ask[1].trim(),
          lastLine: ask[1].trim(),
          tokens: current.tokens + result.tokens,
          endedAt: Date.now(),
        });
        return;
      }
    }

    if (result.exitCode !== 0 || result.error) {
      this.touch(current, {
        status: 'failed',
        lastLine: result.error ?? `exited with code ${result.exitCode}`,
        tokens: current.tokens + result.tokens,
        endedAt: Date.now(),
      });
      return;
    }

    this.touch(current, {
      status: 'review',
      lastLine: 'done — waiting for review',
      question: null,
      tokens: current.tokens + result.tokens,
      endedAt: Date.now(),
    });

    // A message that arrived while the turn was running gets delivered now.
    if (this.hasPending(task.id)) this.dispatchNext(task.id);
  }

  private recordEvent(taskId: string, sessionId: string, e: DshEvent) {
    insertEvent({
      taskId,
      sessionId,
      seq: this.nextSeq(taskId),
      ts: Date.now(),
      kind: e.type === 'status' ? `status.${e.phase}` : e.type,
      payload: e,
    });

    const task = getTask(taskId);
    if (!task) return;

    // Keep the card's one-liner current without flooding the UI with every event.
    if (e.type === 'text' && typeof e.text === 'string') {
      const line = e.text.trim().split('\n').filter(Boolean).at(-1);
      if (line) {
        updateTask(taskId, { lastLine: line.slice(0, 160), lastEventAt: Date.now() });
      }
    }
  }

  /* ── talking to a session ──────────────────────────────────────────── */

  private hasPending(taskId: string): boolean {
    return (this.pending.get(taskId)?.length ?? 0) > 0;
  }

  async sendMessage(
    taskId: string,
    text: string,
    mode: 'queue' | 'interrupt',
  ): Promise<Message> {
    const task = getTask(taskId);
    if (!task) throw new Error('task not found');

    const message = insertMessage({
      taskId,
      role: 'user',
      text,
      ts: Date.now(),
      kind: mode,
    });
    this.emitMessage({ type: 'message', message });

    const live = this.live.get(taskId);

    if (live) {
      if (mode === 'interrupt') {
        live.interrupted = true;
        this.pending.set(taskId, [{ text, mode }]);
        this.touch(task, { lastLine: 'interrupted by user' });
        live.handle.kill();
        return message;
      }
      this.pending.set(taskId, [...(this.pending.get(taskId) ?? []), { text, mode }]);
      this.touch(task, { lastLine: 'message queued for next turn' });
      return message;
    }

    // Idle: continue the conversation immediately on the same session.
    this.pending.set(taskId, [{ text, mode }]);
    this.dispatchNext(taskId);
    return message;
  }

  private dispatchNext(taskId: string): void {
    const queue = this.pending.get(taskId);
    if (!queue?.length) return;
    const [next, ...rest] = queue;
    if (rest.length) this.pending.set(taskId, rest);
    else this.pending.delete(taskId);

    const task = getTask(taskId);
    if (!task) return;

    // Clear any terminal status so the card moves back into Running.
    const cleared = updateTask(taskId, {
      status: 'running',
      question: null,
      endedAt: null,
    })!;
    this.emitTask(cleared, taskId);
    void this.beginTurn(cleared, next.text);
  }

  /* ── controls ──────────────────────────────────────────────────────── */

  stopTask(taskId: string): void {
    const live = this.live.get(taskId);
    if (live) {
      live.interrupted = true;
      live.handle.kill();
      return;
    }
    const task = getTask(taskId);
    if (!task) return;
    const next = updateTask(taskId, { status: 'review', lastLine: 'stopped' })!;
    this.emitTask(next, taskId);
  }

  setStatus(taskId: string, status: TaskStatus): void {
    const task = getTask(taskId);
    if (!task) return;
    const next = updateTask(taskId, {
      status,
      question: status === 'needs_input' ? task.question : null,
    })!;
    this.emitTask(next, taskId);
    if (status === 'queued') this.pump();
  }

  archive(taskId: string): void {
    const live = this.live.get(taskId);
    if (live) live.handle.kill();
    updateTask(taskId, { archived: 1, status: 'archived' });
    this.emitMessage({ type: 'removed', taskId });
  }

  /** Sweep tasks that stopped producing events while still marked running. */
  sweep(): void {
    const now = Date.now();
    for (const [taskId, live] of this.live) {
      const task = getTask(taskId);
      if (!task) continue;
      if (task.status === 'running' && now - (task.lastEventAt ?? now) > STALL_MS) {
        this.touch(task, {
          status: 'stalled' as TaskStatus,
          lastLine: 'no output for a while — possibly stuck',
        });
      }
      if (!task && live) this.live.delete(taskId);
    }
  }
}

export const board = new Board();
