import type {
  CreateTaskInput,
  Message,
  Task,
  TaskDetail,
  TaskStatus,
} from '@collabots/shared';

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  tasks: () => req<Task[]>('/api/tasks'),

  detail: (id: string) => req<TaskDetail>(`/api/tasks/${id}`),

  create: (input: CreateTaskInput) =>
    req<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(input) }),

  start: (id: string) =>
    req<{ ok: true }>(`/api/tasks/${id}/start`, { method: 'POST' }),

  send: (id: string, text: string, mode: 'queue' | 'interrupt') =>
    req<Message>(`/api/tasks/${id}/message`, {
      method: 'POST',
      body: JSON.stringify({ text, mode }),
    }),

  stop: (id: string) =>
    req<{ ok: true }>(`/api/tasks/${id}/stop`, { method: 'POST' }),

  setStatus: (id: string, status: TaskStatus) =>
    req<{ ok: true }>(`/api/tasks/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),

  archive: (id: string) =>
    req<{ ok: true }>(`/api/tasks/${id}/archive`, { method: 'POST' }),

  diff: (id: string) => req<{ diff: string }>(`/api/tasks/${id}/diff`),
};
