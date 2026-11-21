# Collabots

A multi-agent task board for the DeepSeek Harness. Create tasks from the browser,
watch several `dsh` sessions at once, and get pulled in only when one of them
actually needs you.

```
┌──────────────────────────────────────────────────────────┐
│ Collabots   Board  Inbox(3)          Enable notifications │
├──────────────────────────────────────────────────────────┤
│ Needs you │ Running │ Queued │ Review │ Failed            │
└──────────────────────────────────────────────────────────┘
```

## Why it works the way it does

- **Status is derived, never dragged.** Every column is driven by real harness
  events (`turn_start`, `turn_end`, `final`, exit codes), so the board cannot
  drift away from reality.
- **`needs_input` and `failed` are the only things that interrupt you.**
  Everything else is silent. Notifications merge per task and only fire on those
  two transitions.
- **One task = one session = one worktree.** `dsh` scopes sessions by working
  directory, so each task gets its own git worktree and branch. That also means
  agents never edit the same checkout, and you get a diff to review at the end.
- **Talk to any session, any time.** Enter queues a message for the next turn;
  ⌘↵ interrupts the live turn.

## Run it

```bash
pnpm install
pnpm dev            # server on :8787, vite on :5173
```

Or build the client and use a single port:

```bash
pnpm --filter @collabots/web build
pnpm dev:server     # http://localhost:8787
```

## Talking to the harness

The board drives `dsh` over its headless JSON surface:

```
dsh --profile headless --patch apps/server/dsh/magpie.yml --json [--session-id <id>] <prompt>
```

`apps/server/dsh/magpie.yml` registers the local magpie gateway as an
OpenAI-compatible provider — the shipped `headless` profile has no provider
configured. Override `DSH_BIN`, `DSH_PROFILE`, or `DSH_PATCH` if your setup
differs.

The harness reports progress as newline-delimited events:

```jsonc
{"type":"session","sessionId":"session-…","cwd":"…"}
{"type":"status","phase":"turn_start","turn":1}
{"type":"text","text":"partial assistant output"}
{"type":"status","phase":"step_end","turn":1,"usage":{"totalTokens":6718}}
{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"completed"}}
{"type":"final","text":"the whole reply"}
```

## Asking the user a question

Headless runs are fire-and-forget, so there is no interactive prompt to observe.
The convention is a trailing line in the agent's reply:

```
ASK: which database should this migration target?
```

The board parses it, moves the task to **Needs you**, and puts the question in
the inbox and in your notifications. Put this instruction in your task prompts:

> If you need a decision from me, end your reply with a line starting with `ASK:`.

## Layout

```
apps/server    Fastify + ws + better-sqlite3
  src/dsh.ts       spawn a turn, parse NDJSON into events
  src/board.ts     state machine, queue, concurrency, turn dispatch
  src/worktree.ts  one git worktree per task
  src/db.ts        tasks / sessions / events / messages
apps/web       React + Vite
  src/useBoard.ts  websocket store + browser notifications
packages/shared   the contract both sides share
```

Data lives in `~/.collabots/collabots.db`.

## Keyboard

`j` / `k` walk the board · `Enter` (click) opens · `n` new task · `Esc` close
· `↵` queue a message · `⌘↵` interrupt the live turn
