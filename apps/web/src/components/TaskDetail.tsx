import { useEffect, useMemo, useRef, useState } from 'react';
import type { Message, Task } from '@collabots/shared';
import { api } from '../api.ts';
import { shortDuration } from './Board.tsx';

export function TaskDetail({
  task,
  liveMessages,
  delta,
  onClose,
  onSend,
  onStop,
  onStatus,
  onArchive,
}: {
  task: Task;
  liveMessages: Message[];
  delta: string;
  onClose: () => void;
  onSend: (text: string, mode: 'queue' | 'interrupt') => Promise<void>;
  onStop: () => void;
  onStatus: (status: Task['status']) => void;
  onArchive: () => void;
}) {
  const [seed, setSeed] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [diff, setDiff] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    setSeed([]);
    setDiff('');
    api
      .detail(task.id)
      .then((d) => {
        if (!cancelled) setSeed(d.messages);
      })
      .catch(() => {});
    api
      .diff(task.id)
      .then((d) => {
        if (!cancelled) setDiff(d.diff);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [task.id]);

  const messages = useMemo(() => {
    const byId = new Map<number, Message>();
    for (const m of seed) byId.set(m.id, m);
    for (const m of liveMessages) byId.set(m.id, m);
    return [...byId.values()].sort((a, b) => a.id - b.id);
  }, [seed, liveMessages]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages.length, delta]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [task.id]);

  const submit = async (mode: 'queue' | 'interrupt') => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      await onSend(value, mode);
      setText('');
    } finally {
      setSending(false);
    }
  };

  const busy = task.status === 'running';

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header className="drawer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{task.title}</h2>
            <div className="drawer-sub">
              <span className={`status-tag ${statusClass(task.status)}`}>
                <span className="d" />
                {task.status.replace('_', ' ')}
              </span>
              <span>
                <span className="k">turns</span> {task.turns}
              </span>
              <span>
                <span className="k">elapsed</span> {shortDuration(task)}
              </span>
              {task.branch && (
                <span>
                  <span className="k">branch</span> {task.branch}
                </span>
              )}
              {task.worktreePath && (
                <span title={task.worktreePath}>
                  <span className="k">cwd</span> {task.worktreePath}
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            {busy ? (
              <button className="btn" onClick={onStop}>
                Stop
              </button>
            ) : (
              <button className="btn" onClick={() => onStatus('queued')}>
                Re-run
              </button>
            )}
            <button className="btn ghost" onClick={onClose}>
              ✕
            </button>
          </div>
        </header>

        <div className="thread" ref={threadRef}>
          {task.question && (
            <div className="msg agent ask">
              <span className="who">waiting on your answer</span>
              <div className="body">{task.question}</div>
            </div>
          )}

          {messages.length === 0 && !delta && (
            <div className="empty">No messages yet.</div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              className={`msg ${m.role} ${m.kind === 'ask' ? 'ask' : ''}`}
            >
              <span className="who">
                {m.role === 'agent' ? 'agent' : m.role}
                {m.kind === 'ask' && ' · asking'}
                {m.kind === 'interrupt' && ' · interrupt'}
              </span>
              <div className="body">{displayText(m)}</div>
            </div>
          ))}

          {busy && delta && (
            <div className="msg agent">
              <span className="who">agent · streaming</span>
              <div className="body">{delta}</div>
            </div>
          )}

          {diff && (
            <div className="msg system">
              <div className="body">
                <div style={{ marginBottom: 6 }}>working tree changes</div>
                <pre style={{ margin: 0, fontSize: 11, color: 'var(--muted)' }}>
                  {diff}
                </pre>
              </div>
            </div>
          )}
        </div>

        <div className="composer">
          <textarea
            ref={inputRef}
            value={text}
            placeholder={
              busy
                ? 'Queue a message for the next turn, or ⌘↵ to interrupt…'
                : 'Talk to this session…'
            }
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit(busy ? 'interrupt' : 'queue');
              } else if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit('queue');
              }
            }}
          />
          <div className="row">
            <button
              className="btn primary"
              disabled={!text.trim() || sending}
              onClick={() => void submit('queue')}
            >
              {busy ? 'Queue' : 'Send'}
            </button>
            {busy && (
              <button
                className="btn"
                disabled={!text.trim() || sending}
                onClick={() => void submit('interrupt')}
              >
                Interrupt
              </button>
            )}
            <span className="hint">↵ queue · ⌘↵ interrupt · ⇧↵ newline</span>
            <div className="spacer" />
            {task.status === 'review' && (
              <button className="btn" onClick={onArchive}>
                Accept & archive
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

/** Older records may still carry the ASK: marker; the question is shown separately. */
function displayText(m: Message): string {
  if (m.kind !== 'ask') return m.text;
  const cleaned = m.text.replace(/^\s*ASK:.*$/im, '').trim();
  return cleaned || m.text;
}

function statusClass(status: string): string {  return (
    {
      needs_input: 's-needs',
      stalled: 's-needs',
      running: 's-running',
      review: 's-review',
      failed: 's-failed',
      queued: 's-queued',
    }[status] ?? 's-queued'
  );
}
