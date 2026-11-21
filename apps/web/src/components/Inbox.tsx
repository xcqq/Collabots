import type { Task } from '@collabots/shared';
import { API_ACTIONABLE } from '../constants.ts';
import { shortDuration } from './Board.tsx';

export function Inbox({
  tasks,
  onSelect,
}: {
  tasks: Task[];
  onSelect: (id: string) => void;
}) {
  const items = tasks
    .filter((t) => t.archived === 0 && API_ACTIONABLE.includes(t.status))
    .sort((a, b) => severity(a) - severity(b) || (a.lastEventAt ?? 0) - (b.lastEventAt ?? 0));

  return (
    <div className="inbox">
      <h2>Inbox</h2>
      <div className="sub">
        {items.length === 0
          ? 'Nothing needs you. Everything is either running or done.'
          : `${items.length} task${items.length === 1 ? '' : 's'} waiting on you.`}
      </div>

      <div className="triage">
        {items.map((t) => (
          <div className="triage-item" key={t.id} onClick={() => onSelect(t.id)}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
              <strong style={{ fontSize: 13.5 }}>{t.title}</strong>
              <span className="hint" style={{ marginLeft: 'auto' }}>
                {t.status} · {shortDuration(t)}
              </span>
            </div>

            {t.question && <div className="q">{t.question}</div>}

            {!t.question && t.lastLine && (
              <div className="why">{t.lastLine}</div>
            )}

            <div className="hint" style={{ marginTop: 8 }}>
              {t.branch ?? t.repoPath ?? 'no repo'} · {t.turns} turn
              {t.turns === 1 ? '' : 's'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Lower sorts first: questions block an agent, failures block nothing. */
function severity(t: Task): number {
  if (t.status === 'needs_input') return 0;
  if (t.status === 'stalled') return 1;
  if (t.status === 'failed') return 2;
  return 3; // review
}
