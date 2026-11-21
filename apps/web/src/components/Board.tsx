import { useMemo } from 'react';
import type { Task } from '@collabots/shared';
import { STATUS_LABEL } from '@collabots/shared';
import { COLUMNS, STATUS_CLASS } from '../constants.ts';

export function Board({
  tasks,
  selectedId,
  onSelect,
}: {
  tasks: Task[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="board">
      {COLUMNS.map((col) => {
        const items = tasks.filter(
          (t) => t.archived === 0 && col.match.includes(t.status),
        );
        return (
          <section className="col" key={col.status}>
            <header className="col-head">
              <span>{col.label}</span>
              <span className="n">{items.length}</span>
            </header>
            <div className="col-body">
              {items.length === 0 && <div className="empty">—</div>}
              {items.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  selected={t.id === selectedId}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TaskCard({
  task,
  selected,
  onSelect,
}: {
  task: Task;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const age = useMemo(() => shortDuration(task), [task.lastEventAt, task.createdAt]);
  const cls =
    task.status === 'needs_input' || task.status === 'stalled'
      ? 'needs'
      : task.status === 'failed'
        ? 'failed'
        : task.status === 'running'
          ? 'running'
          : task.status === 'review'
            ? 'reviewc'
            : '';

  return (
    <article
      className={`card ${cls} ${selected ? 'selected' : ''}`}
      onClick={() => onSelect(task.id)}
    >
      <div className="card-title">{task.title}</div>

      {task.lastLine && <div className="card-line">{task.lastLine}</div>}

      <div className="card-meta">
        {task.status === 'running' && <span className="pulse" />}
        <span className={`status-tag ${STATUS_CLASS[task.status] ?? ''}`}>
          <span className="d" />
          {STATUS_LABEL[task.status]}
        </span>
        {task.branch && <span className="br">⎇ {task.branch}</span>}
        <span style={{ marginLeft: 'auto' }}>{age}</span>
        {task.tokens > 0 && <span>{fmtTokens(task.tokens)}</span>}
      </div>
    </article>
  );
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M tok`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k tok`;
  return `${n} tok`;
}

export function shortDuration(task: Task): string {
  const start = task.startedAt ?? task.createdAt;
  const end = task.endedAt ?? Date.now();
  const s = Math.max(0, Math.round((end - start) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}
