import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Task } from '@collabots/shared';
import { api } from './api.ts';
import { useBoard } from './useBoard.ts';
import { API_ACTIONABLE, COLUMNS } from './constants.ts';
import { Board } from './components/Board.tsx';
import { Inbox } from './components/Inbox.tsx';
import { TaskDetail } from './components/TaskDetail.tsx';
import { NewTask } from './components/NewTask.tsx';

export function App() {
  const { tasks, messages, deltas, connected, notifyEnabled, enableNotifications } =
    useBoard();

  const [view, setView] = useState<'board' | 'inbox'>('board');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const selected = useMemo(
    () => tasks.find((t) => t.id === selectedId) ?? null,
    [tasks, selectedId],
  );

  const actionable = tasks.filter(
    (t) => t.archived === 0 && API_ACTIONABLE.includes(t.status),
  ).length;

  // Deep link: #task/<id> focuses that task (used by notification clicks).
  useEffect(() => {
    const match = location.hash.match(/^#task\/(.+)$/);
    if (match) setSelectedId(match[1]);
  }, [tasks.length]);

  const openTask = useCallback((id: string) => setSelectedId(id), []);

  // Keyboard: j/k walk the board, Enter opens, n creates, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (selectedId && e.key === 'Escape') {
        setSelectedId(null);
        location.hash = '';
        return;
      }
      if (e.key === 'n' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setCreating(true);
        return;
      }
      if ((e.key === 'j' || e.key === 'k') && view === 'board') {
        const order = visibleOrder(tasks);
        if (!order.length) return;
        const idx = selectedId ? order.indexOf(selectedId) : -1;
        const next =
          e.key === 'j'
            ? order[Math.min(order.length - 1, idx + 1)]
            : order[Math.max(0, idx - 1)];
        setSelectedId(next ?? order[0]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tasks, selectedId, view]);

  const send = async (text: string, mode: 'queue' | 'interrupt') => {
    if (!selected) return;
    await api.send(selected.id, text, mode);
  };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="dot" />
          <span>Collabots</span>
          <span className={`conn ${connected ? 'on' : ''}`} title={connected ? 'connected' : 'disconnected'} />
        </div>

        <nav className="tabs">
          <button
            className={`tab ${view === 'board' ? 'active' : ''}`}
            onClick={() => setView('board')}
          >
            Board
          </button>
          <button
            className={`tab ${view === 'inbox' ? 'active' : ''}`}
            onClick={() => setView('inbox')}
          >
            Inbox
            {actionable > 0 && <span className="badge">{actionable}</span>}
          </button>
        </nav>

        <div className="spacer" />

        {!notifyEnabled && (
          <button className="btn ghost" onClick={enableNotifications}>
            Enable notifications
          </button>
        )}

        <button className="btn primary" onClick={() => setCreating(true)}>
          + New task
        </button>
      </header>

      {view === 'board' ? (
        <Board tasks={tasks} selectedId={selectedId} onSelect={openTask} />
      ) : (
        <Inbox tasks={tasks} onSelect={openTask} />
      )}

      {selected && (
        <TaskDetail
          key={selected.id}
          task={selected}
          liveMessages={messages[selected.id] ?? []}
          delta={deltas[selected.id] ?? ''}
          onClose={() => {
            setSelectedId(null);
            location.hash = '';
          }}
          onSend={send}
          onStop={() => void api.stop(selected.id)}
          onStatus={(status) => void api.setStatus(selected.id, status)}
          onArchive={() => {
            void api.archive(selected.id);
            setSelectedId(null);
          }}
        />
      )}

      {creating && (
        <NewTask
          onClose={() => setCreating(false)}
          onCreated={() => setRefreshKey((k) => k + 1)}
        />
      )}
      <span hidden>{refreshKey}</span>
    </div>
  );
}

function visibleOrder(tasks: Task[]): string[] {
  return COLUMNS.flatMap((col) =>
    tasks
      .filter((t) => t.archived === 0 && col.match.includes(t.status))
      .map((t) => t.id),
  );
}
