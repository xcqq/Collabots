import { useEffect, useRef, useState } from 'react';
import type { Message, ServerMessage, Task } from '@collabots/shared';
import { API_ACTIONABLE } from './constants.ts';

export interface BoardState {
  tasks: Task[];
  messages: Record<string, Message[]>;
  deltas: Record<string, string>;
  connected: boolean;
  notifyEnabled: boolean;
  enableNotifications: () => void;
}

/**
 * Single source of truth for the UI: one websocket, plus browser notifications
 * fired only on the two transitions that actually need a human.
 */
export function useBoard(): BoardState {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [deltas, setDeltas] = useState<Record<string, string>>({});
  const [connected, setConnected] = useState(false);
  const [notifyEnabled, setNotifyEnabled] = useState(
    typeof Notification !== 'undefined' && Notification.permission === 'granted',
  );

  const prevStatus = useRef<Map<string, string>>(new Map());
  const seenSnapshot = useRef(false);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${proto}://${location.host}/ws`);

      socket.onopen = () => setConnected(true);
      socket.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1500);
      };

      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data) as ServerMessage;
        switch (msg.type) {
          case 'snapshot': {
            setTasks(msg.tasks);
            for (const t of msg.tasks) prevStatus.current.set(t.id, t.status);
            seenSnapshot.current = true;
            break;
          }
          case 'task': {
            setTasks((prev) => {
              const idx = prev.findIndex((t) => t.id === msg.task.id);
              if (idx === -1) return [...prev, msg.task];
              const next = [...prev];
              next[idx] = msg.task;
              return next;
            });

            const before = prevStatus.current.get(msg.task.id);
            prevStatus.current.set(msg.task.id, msg.task.status);

            if (
              seenSnapshot.current &&
              before !== msg.task.status &&
              (msg.task.status === 'needs_input' || msg.task.status === 'failed')
            ) {
              fireNotification(msg.task);
            }
            break;
          }
          case 'message': {
            const { message } = msg;
            setMessages((prev) => ({
              ...prev,
              [message.taskId]: [...(prev[message.taskId] ?? []), message],
            }));
            if (message.role !== 'user') {
              setDeltas((prev) => ({ ...prev, [message.taskId]: '' }));
            }
            break;
          }
          case 'delta': {
            setDeltas((prev) => ({ ...prev, [msg.taskId]: msg.text }));
            break;
          }
          case 'removed': {
            setTasks((prev) => prev.filter((t) => t.id !== msg.taskId));
            break;
          }
        }
      };
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, []);

  // Count actionable tasks in the tab title so a background tab still tells you.
  useEffect(() => {
    const n = tasks.filter(
      (t) => t.archived === 0 && API_ACTIONABLE.includes(t.status),
    ).length;
    document.title = n > 0 ? `(${n}) Collabots` : 'Collabots';
  }, [tasks]);

  const enableNotifications = () => {
    if (typeof Notification === 'undefined') return;
    void Notification.requestPermission().then((p) => setNotifyEnabled(p === 'granted'));
  };

  return {
    tasks,
    messages,
    deltas,
    connected,
    notifyEnabled,
    enableNotifications,
  };
}

function fireNotification(task: Task) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const title =
    task.status === 'needs_input' ? 'Needs your input' : 'Task failed';
  const body = task.question ?? task.lastLine ?? task.title;
  try {
    const n = new Notification(title, {
      body: `${task.title}\n${body}`.slice(0, 220),
      tag: task.id,
      silent: false,
    });
    n.onclick = () => {
      window.focus();
      location.hash = `task/${task.id}`;
      n.close();
    };
  } catch {
    /* Notification can throw on some platforms; never break the board for it */
  }
}
