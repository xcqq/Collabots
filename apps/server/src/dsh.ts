import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const DSH_BIN =
  process.env.DSH_BIN ??
  '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh';

const PATCH_FILE = process.env.DSH_PATCH ?? join(HERE, '..', 'dsh', 'magpie.yml');
const PROFILE = process.env.DSH_PROFILE ?? 'headless';

/** Events the harness emits as newline-delimited JSON on stdout. */
export type DshEvent = { type: string } & Record<string, any>;

export interface TurnHandle {
  child: ChildProcess;
  /** Promise that settles when the process exits. */
  done: Promise<TurnResult>;
  /** Ask the harness to stop; resolves once the process is gone. */
  kill: () => void;
}

export interface TurnResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  finalText: string;
  sessionId: string | null;
  tokens: number;
  error: string | null;
}

export interface RunTurnOptions {
  cwd: string;
  prompt: string;
  sessionId?: string | null;
  onEvent: (e: DshEvent) => void;
  onText: (delta: string) => void;
}

/**
 * Spawns one harness turn: `dsh --profile headless --patch <file> --json [--session-id <id>] <prompt>`.
 *
 * A turn owns the process. Continuation happens by passing the session id
 * reported in the first `session` event, which is how a task keeps a single
 * conversation across many user messages.
 */
export function runTurn(opts: RunTurnOptions): TurnHandle {
  const args = [
    '--profile',
    PROFILE,
    '--patch',
    PATCH_FILE,
    '--json',
    ...(opts.sessionId ? ['--session-id', opts.sessionId] : []),
    opts.prompt,
  ];

  const child = spawn(DSH_BIN, args, {
    cwd: opts.cwd,
    env: {
      ...process.env,
      MAGPIE_GATEWAY_KEY: process.env.MAGPIE_GATEWAY_KEY ?? 'magpie',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let finalText = '';
  let sessionId: string | null = null;
  let tokens = 0;
  let error: string | null = null;

  const rl = createInterface({ input: child.stdout! });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let evt: DshEvent;
    try {
      evt = JSON.parse(trimmed);
    } catch {
      // Non-JSON on stdout is diagnostic noise; keep it visible in the event log.
      opts.onEvent({ type: 'raw', text: trimmed });
      return;
    }

    if (evt.type === 'session' && typeof evt.sessionId === 'string') {
      sessionId = evt.sessionId;
    }
    if (evt.type === 'text' && typeof evt.text === 'string') {
      opts.onText(evt.text);
    }
    if (evt.type === 'status' && evt.phase === 'step_end' && evt.usage) {
      tokens += Number(evt.usage.totalTokens ?? 0) || 0;
    }
    if (evt.type === 'status' && evt.phase === 'turn_end' && evt.reason?.kind === 'error') {
      error = evt.reason.error?.message ?? 'harness turn failed';
    }
    if (evt.type === 'final' && typeof evt.text === 'string') {
      finalText = evt.text;
    }
    opts.onEvent(evt);
  });

  let stderr = '';
  child.stderr!.on('data', (chunk) => {
    stderr += String(chunk);
  });

  const done = new Promise<TurnResult>((resolve) => {
    child.on('close', (code, signal) => {
      if (!error && stderr.trim()) {
        const line = stderr.trim().split('\n').find((l) => l.includes(': '));
        if (line && code !== 0) error = line.replace(/^dsh:\s*/, '');
      }
      resolve({ exitCode: code, signal, finalText, sessionId, tokens, error });
    });
  });

  return {
    child,
    done,
    kill: () => {
      if (!child.killed) child.kill('SIGTERM');
    },
  };
}

export const dshInfo = { bin: DSH_BIN, profile: PROFILE, patch: PATCH_FILE };
