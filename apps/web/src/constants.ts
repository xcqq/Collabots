import type { TaskStatus } from '@collabots/shared';

/** Statuses that need a human decision. Order matters: this is inbox priority. */
export const API_ACTIONABLE: TaskStatus[] = ['needs_input', 'failed', 'stalled', 'review'];

export const COLUMNS: { status: TaskStatus; label: string; match: TaskStatus[] }[] = [
  { status: 'needs_input', label: 'Needs you', match: ['needs_input', 'stalled'] },
  { status: 'running', label: 'Running', match: ['running'] },
  { status: 'queued', label: 'Queued', match: ['queued'] },
  { status: 'review', label: 'Review', match: ['review'] },
  { status: 'failed', label: 'Failed', match: ['failed'] },
];

export const STATUS_CLASS: Record<string, string> = {
  needs_input: 's-needs',
  stalled: 's-needs',
  running: 's-running',
  review: 's-review',
  failed: 's-failed',
  queued: 's-queued',
  archived: 's-queued',
};

export const PROMPT_TEMPLATES: { label: string; text: string }[] = [
  {
    label: 'Fix a bug',
    text: 'Fix the following bug. Reproduce it first, then fix it, then add a regression test.\n\nBug: ',
  },
  {
    label: 'Add tests',
    text: 'Add tests for the following area. Cover edge cases and failure modes, not just the happy path.\n\nArea: ',
  },
  {
    label: 'Investigate',
    text: 'Investigate the following and report back with a concrete recommendation. Do not change any code.\n\nQuestion: ',
  },
  {
    label: 'Refactor',
    text: 'Refactor the following without changing behaviour. Keep the change reviewable and explain each step.\n\nTarget: ',
  },
];
