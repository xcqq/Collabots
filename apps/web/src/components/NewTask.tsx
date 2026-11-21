import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { PROMPT_TEMPLATES } from '../constants.ts';

export function NewTask({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [startNow, setStartNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim() || !prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.create({
        title: title.trim(),
        prompt: prompt.trim(),
        repoPath: repoPath.trim() || null,
        startNow,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="dialog" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2>New task</h2>

        <div className="field">
          <label>Title</label>
          <input
            autoFocus
            value={title}
            placeholder="What is this task about?"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="field">
          <label>Prompt</label>
          <div className="chips">
            {PROMPT_TEMPLATES.map((t) => (
              <button
                key={t.label}
                className="chip"
                onClick={() => setPrompt(t.text)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <textarea
            value={prompt}
            placeholder={'Give the agent the full brief. It cannot ask before starting.\n\nTip: tell it to end with "ASK: <question>" when it needs a decision from you.'}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div className="field">
          <label>Repository</label>
          <input
            value={repoPath}
            placeholder="/path/to/repo"
            onChange={(e) => setRepoPath(e.target.value)}
          />
          <span className="hint">
            A git repo gets its own worktree and branch per task, so agents never
            fight over the same checkout.
          </span>
        </div>

        <div className="field">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none', letterSpacing: 0, fontSize: 12.5 }}>
            <input
              type="checkbox"
              checked={startNow}
              onChange={(e) => setStartNow(e.target.checked)}
              style={{ width: 'auto' }}
            />
            Start immediately (uncheck to leave it as a draft)
          </label>
        </div>

        {error && (
          <div className="hint" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        <div className="actions">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!title.trim() || !prompt.trim() || busy}
            onClick={() => void submit()}
          >
            {startNow ? 'Create & start' : 'Save draft'}
          </button>
        </div>
      </div>
    </>
  );
}
