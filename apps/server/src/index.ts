import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { WebSocketServer, WebSocket } from 'ws';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { ServerMessage } from '@collabots/shared';
import {
  getTask,
  listEvents,
  listMessages,
  listTasks,
} from './db.ts';
import { board } from './board.ts';
import { dshInfo } from './dsh.ts';
import { diffStat } from './worktree.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const WEB_DIST = join(HERE, '..', '..', 'web', 'dist');

const app = Fastify({ logger: { level: 'warn' } });

/* ── websocket fan-out ───────────────────────────────────────────────── */

const wss = new WebSocketServer({ server: app.server, path: '/ws' });

function broadcast(msg: ServerMessage) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

board.on('message', broadcast);

wss.on('connection', (socket) => {
  socket.send(
    JSON.stringify({ type: 'snapshot', tasks: listTasks() } satisfies ServerMessage),
  );
});

/* ── routes ──────────────────────────────────────────────────────────── */

app.get('/api/config', async () => ({
  dsh: dshInfo,
  concurrency: Number(process.env.COLLABOTS_CONCURRENCY ?? 2),
}));

app.get('/api/tasks', async () => listTasks());

app.get<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
  const task = getTask(req.params.id);
  if (!task) return reply.code(404).send({ error: 'not found' });
  return {
    task,
    messages: listMessages(task.id),
    events: listEvents(task.id),
  };
});

const createSchema = z.object({
  title: z.string().min(1),
  prompt: z.string().min(1),
  repoPath: z.string().nullish(),
  priority: z.number().int().optional(),
  startNow: z.boolean().optional(),
});

app.post('/api/tasks', async (req, reply) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'bad input' });
  }
  const task = await board.createTask(parsed.data);
  return task;
});

app.post<{ Params: { id: string } }>('/api/tasks/:id/start', async (req, reply) => {
  if (!getTask(req.params.id)) return reply.code(404).send({ error: 'not found' });
  await board.startTask(req.params.id);
  return { ok: true };
});

const messageSchema = z.object({
  text: z.string().min(1),
  mode: z.enum(['queue', 'interrupt']).default('queue'),
});

app.post<{ Params: { id: string } }>('/api/tasks/:id/message', async (req, reply) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: 'bad input' });
  if (!getTask(req.params.id)) return reply.code(404).send({ error: 'not found' });
  const message = await board.sendMessage(
    req.params.id,
    parsed.data.text,
    parsed.data.mode,
  );
  return message;
});

app.post<{ Params: { id: string } }>('/api/tasks/:id/stop', async (req) => {
  board.stopTask(req.params.id);
  return { ok: true };
});

const statusSchema = z.object({
  status: z.enum(['queued', 'running', 'needs_input', 'review', 'failed', 'stalled', 'archived']),
});

app.post<{ Params: { id: string } }>('/api/tasks/:id/status', async (req, reply) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: 'bad input' });
  board.setStatus(req.params.id, parsed.data.status);
  return { ok: true };
});

app.post<{ Params: { id: string } }>('/api/tasks/:id/archive', async (req) => {
  board.archive(req.params.id);
  return { ok: true };
});

app.get<{ Params: { id: string } }>('/api/tasks/:id/diff', async (req, reply) => {
  const task = getTask(req.params.id);
  if (!task) return reply.code(404).send({ error: 'not found' });
  return { diff: await diffStat(task.worktreePath) };
});

/* ── static web build (production) ───────────────────────────────────── */

if (existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, { root: WEB_DIST, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/ws')) {
      return reply.code(404).send({ error: 'not found' });
    }
    return reply.sendFile('index.html');
  });
}

/* ── boot ────────────────────────────────────────────────────────────── */

setInterval(() => board.sweep(), 30_000).unref();

await app.listen({ port: PORT, host: '127.0.0.1' });
console.log(`collabots board → http://localhost:${PORT}`);
console.log(`harness: ${dshInfo.bin} (profile ${dshInfo.profile})`);
