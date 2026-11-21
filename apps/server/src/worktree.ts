import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface WorktreeResult {
  path: string;
  branch: string | null;
}

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await exec('git', ['rev-parse', '--git-dir'], { cwd: dir });
    return true;
  } catch {
    return false;
  }
}

/**
 * dsh scopes sessions by their working directory, and two agents editing the
 * same checkout will happily clobber each other. Giving every task its own
 * worktree fixes both at once: isolated sessions, isolated files, and a branch
 * you can diff when the task comes up for review.
 */
export async function prepareWorkspace(
  repoPath: string | null,
  taskId: string,
  wantWorktree: boolean,
): Promise<WorktreeResult> {
  if (!repoPath) return { path: process.cwd(), branch: null };
  if (!wantWorktree || !(await isGitRepo(repoPath))) {
    return { path: repoPath, branch: null };
  }

  const short = taskId.slice(0, 8);
  const branch = `task/${short}`;
  const path = join(repoPath, '.collabots', 'tasks', short);

  if (existsSync(path)) return { path, branch };

  try {
    await exec('git', ['worktree', 'add', '-b', branch, path, 'HEAD'], { cwd: repoPath });
    return { path, branch };
  } catch (err) {
    // A pre-existing branch (retry of the same task) is fine; fall back to the repo.
    console.warn('[worktree] failed, running in repo root:', (err as Error).message);
    return { path: repoPath, branch: null };
  }
}

export async function removeWorktree(repoPath: string | null, worktreePath: string | null) {
  if (!repoPath || !worktreePath || worktreePath === repoPath) return;
  try {
    await exec('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoPath });
  } catch {
    /* best effort */
  }
}

export async function diffStat(worktreePath: string | null): Promise<string> {
  if (!worktreePath) return '';
  try {
    const { stdout } = await exec('git', ['diff', '--stat', 'HEAD'], { cwd: worktreePath });
    return stdout.trim();
  } catch {
    return '';
  }
}
