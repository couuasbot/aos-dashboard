export type Lane = 'execution' | 'ops';

export type TaskState = 'Inbox' | 'Ready' | 'In Progress' | 'Review' | 'Failed' | 'Done';

export type Task = {
  taskId: string;
  title: string;
  details?: string;
  roleHint?: string;
  priority?: string;
  lane?: Lane;
  slaMinutes?: number;
  state: TaskState;
  createdAt?: string | null;
  updatedAt?: string | null;
  inProgressAt?: string | null;
  lastDispatch?: {
    at: string;
    role?: string | null;
    runId?: string | null;
    artifactsBaseDir?: string | null;
  } | null;
  attempts?: number;
  artifactsDir?: string | null;
  resultPath?: string | null;
  lastError?: any;
};

export type AOSLock = {
  path: string;
  exists: boolean;
  pid?: number;
  startTs?: string;
  ttlMs?: number;
  stale?: boolean;
  ageMs?: number;
};

export function resolveWorkspaceRoot(): string {
  const env = process.env.AOS_WORKSPACE_ROOT || process.env.OPENCLAW_WORKSPACE;
  if (env && env.trim()) return env;
  const home = process.env.HOME || '';
  return home ? `${home}/.openclaw/workspace-god` : '/home/ubuntu/.openclaw/workspace-god';
}

export function getEventLogPath(workspaceRoot: string): string {
  return `${workspaceRoot}/workflow-events.jsonl`;
}

function safeJsonParse(line: string): any | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function normalizeEvent(e: any, idx: number) {
  if (!e || typeof e !== 'object') return null;
  if (!e.id) e.id = `legacy_${idx}`;
  if (!e.timestamp) e.timestamp = new Date(0).toISOString();
  if (e.type) e.type = String(e.type).toUpperCase();
  if (!('payload' in e)) e.payload = {};
  return e;
}

async function readFileText(p: string): Promise<string | null> {
  try {
    const fs = await import('node:fs/promises');
    return await fs.readFile(p, 'utf8');
  } catch {
    return null;
  }
}

async function statFile(p: string) {
  try {
    const fs = await import('node:fs/promises');
    return await fs.stat(p);
  } catch {
    return null;
  }
}

export async function readAutopilotLock(workspaceRoot: string): Promise<AOSLock> {
  const lockPath = `${workspaceRoot}/.aos/autopilot.lock`;
  const st = await statFile(lockPath);
  if (!st) return { path: lockPath, exists: false };

  const txt = await readFileText(lockPath);
  const obj = txt ? safeJsonParse(txt) : null;

  const now = Date.now();
  const ageMs = now - st.mtimeMs;

  let pid: number | undefined;
  let startTs: string | undefined;
  let ttlMs: number | undefined;

  if (obj && typeof obj === 'object') {
    if (Number.isFinite(obj.pid)) pid = obj.pid;
    if (typeof obj.startTs === 'string') startTs = obj.startTs;
    if (Number.isFinite(obj.ttlMs)) ttlMs = obj.ttlMs;
  }

  let stale = false;
  if (startTs && ttlMs) {
    const start = new Date(startTs).getTime();
    if (Number.isFinite(start)) stale = now > start + ttlMs;
  }

  return { path: lockPath, exists: true, pid, startTs, ttlMs, stale, ageMs };
}

export async function readEventsTail(workspaceRoot: string, limit = 200): Promise<any[]> {
  const fs = await import('node:fs/promises');
  const p = getEventLogPath(workspaceRoot);
  const txt = await fs.readFile(p, 'utf8');
  const lines = txt.split('\n').filter(Boolean);
  const tail = lines.slice(Math.max(0, lines.length - limit));
  const events: any[] = [];
  for (let i = 0; i < tail.length; i++) {
    const e = normalizeEvent(safeJsonParse(tail[i]), i);
    if (e) events.push(e);
  }
  return events;
}

function defaultTask(taskId: string): Task {
  return {
    taskId,
    title: taskId,
    details: '',
    roleHint: 'cto',
    priority: 'P1',
    lane: 'execution',
    slaMinutes: 60,
    state: 'Inbox',
    createdAt: null,
    updatedAt: null,
    inProgressAt: null,
    lastDispatch: null,
    attempts: 0,
    artifactsDir: null,
    resultPath: null,
    lastError: null
  };
}

function touch(t: Task, ts: string) {
  t.updatedAt = ts;
  if (!t.createdAt) t.createdAt = ts;
}

function applyEvent(tasks: Map<string, Task>, e: any) {
  const ts = e.timestamp as string;
  const type = String(e.type || '').toUpperCase();
  const p = e.payload || {};

  if (type === 'TASK_CREATE') {
    const id = p.taskId;
    if (!id) return;
    const t = tasks.get(id) || defaultTask(id);
    t.title = p.title || t.title;
    t.details = p.details || t.details;
    t.roleHint = p.roleHint || t.roleHint;
    t.priority = p.priority || t.priority;
    t.lane = (p.lane === 'ops' ? 'ops' : 'execution');
    t.slaMinutes = Number(p.slaMinutes || t.slaMinutes || 60);
    t.artifactsDir = p.artifactsDir || t.artifactsDir;
    t.state = 'Inbox';
    touch(t, ts);
    tasks.set(id, t);
    return;
  }

  if (type === 'TASK_STATE') {
    const id = p.taskId;
    if (!id) return;
    const t = tasks.get(id) || defaultTask(id);
    if (p.lane) t.lane = p.lane === 'ops' ? 'ops' : 'execution';
    t.state = (p.state as TaskState) || t.state;
    if (t.state === 'In Progress' && !t.inProgressAt) t.inProgressAt = ts;
    if (t.state !== 'In Progress') t.inProgressAt = null;
    touch(t, ts);
    tasks.set(id, t);
    return;
  }

  if (type === 'DISPATCH') {
    const id = p.taskId;
    if (!id) return;
    const t = tasks.get(id) || defaultTask(id);
    if (p.lane) t.lane = p.lane === 'ops' ? 'ops' : 'execution';
    t.title = p.intent || t.title;
    t.roleHint = p.role || t.roleHint;
    if (p.artifactsBaseDir) t.artifactsDir = p.artifactsBaseDir;
    t.state = t.state === 'Ready' ? 'In Progress' : (t.state || 'In Progress');
    t.inProgressAt = ts;
    t.attempts = Number(t.attempts || 0) + 1;
    t.lastDispatch = {
      at: ts,
      role: p.role || null,
      runId: p.runId || null,
      artifactsBaseDir: p.artifactsBaseDir || t.artifactsDir || null
    };
    touch(t, ts);
    tasks.set(id, t);
    return;
  }

  if (type === 'AGENT_RESULT') {
    const id = p.taskId;
    if (!id) return;
    const t = tasks.get(id) || defaultTask(id);
    if (p.lane) t.lane = p.lane === 'ops' ? 'ops' : 'execution';
    t.resultPath = p.resultPath || t.resultPath;
    if (p.artifactsBaseDir) t.artifactsDir = p.artifactsBaseDir;
    t.lastError = p.error || null;
    touch(t, ts);
    tasks.set(id, t);
    return;
  }

  if (type === 'TASK_COMPLETE') {
    const id = p.taskId;
    if (!id) return;
    const t = tasks.get(id) || defaultTask(id);
    if (p.lane) t.lane = p.lane === 'ops' ? 'ops' : 'execution';
    const status = String(p.status || '').toUpperCase();
    if (status === 'DONE') t.state = 'Done';
    else if (status === 'FAILED') t.state = 'Failed';
    else t.state = 'Done';
    t.inProgressAt = null;
    t.resultPath = p.resultPath || t.resultPath;
    if (p.artifactsBaseDir) t.artifactsDir = p.artifactsBaseDir;
    touch(t, ts);
    tasks.set(id, t);
  }
}

export async function getTasksState(workspaceRoot: string): Promise<Map<string, Task>> {
  // MVP: full load. Later we will implement snapshot+offset for speed.
  const fs = await import('node:fs/promises');
  const p = getEventLogPath(workspaceRoot);
  const txt = await fs.readFile(p, 'utf8');
  const lines = txt.split('\n').filter(Boolean);

  const tasks = new Map<string, Task>();
  for (let i = 0; i < lines.length; i++) {
    const e = normalizeEvent(safeJsonParse(lines[i]), i);
    if (!e) continue;
    applyEvent(tasks, e);
  }
  return tasks;
}

export function computeMetrics(tasks: Task[]) {
  const byState: Record<string, number> = {};
  const byLane: Record<string, number> = { execution: 0, ops: 0 };
  const byRole: Record<string, number> = {};

  const now = Date.now();
  const slaBreaches: Array<{ taskId: string; ageMin: number; slaMinutes: number }> = [];

  for (const t of tasks) {
    byState[t.state] = (byState[t.state] || 0) + 1;
    const lane = t.lane || 'execution';
    byLane[lane] = (byLane[lane] || 0) + 1;

    const role = t.roleHint || 'unknown';
    byRole[role] = (byRole[role] || 0) + 1;

    if (t.state === 'In Progress' && t.inProgressAt) {
      const ageMin = Math.floor((now - new Date(t.inProgressAt).getTime()) / 60000);
      const slaMinutes = Number(t.slaMinutes || 60);
      if (ageMin > slaMinutes) slaBreaches.push({ taskId: t.taskId, ageMin, slaMinutes });
    }
  }

  return { byState, byLane, byRole, slaBreachesCount: slaBreaches.length, slaBreaches };
}
