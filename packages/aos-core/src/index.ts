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

export type AOSEvent = {
  id: string;
  timestamp: string;
  type: string;
  agent?: string;
  payload?: any;
  schemaVersion?: number;
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

export type TaskMetrics = {
  byState: Record<string, number>;
  byLane: Record<string, number>;
  byRole: Record<string, number>;
  slaBreachesCount: number;
  slaBreaches: Array<{ taskId: string; ageMin: number; slaMinutes: number; lane?: Lane; role?: string }>;
};

export type CollabMetrics = {
  windowHours: number;
  roles: Array<{
    role: string;
    current: {
      ready: number;
      inProgress: number;
      review: number;
      failed: number;
      done: number;
    };
    recent: {
      dispatched: number;
      completedDone: number;
      completedFailed: number;
      avgCycleTimeMin: number | null;
    };
  }>;
  signals: {
    validationErrors: number;
    mismatchesToReview: number;
  };
};

export type LaneMetrics = {
  lane: Lane;
  totalTasks: number;
  backlog: number;
  inProgress: number;
  review: number;
  done: number;
  failed: number;
  slaRiskCount: number;
  oldestInProgressMin: number | null;
  saturationPercent: number;
  bottleneckScore: number;
  slaBreaches: Array<{ taskId: string; ageMin: number; slaMinutes: number; role?: string }>;
};

export type BottleneckAnalysis = {
  lanes: LaneMetrics[];
  overallRisk: 'low' | 'medium' | 'high';
  criticalBottleneck: Lane | null;
  recommendations: string[];
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

export function getSnapshotPath(workspaceRoot: string): string {
  return `${workspaceRoot}/.aos/workflow-snapshot.json`;
}

function safeJsonParse(line: string): any | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function normalizeEvent(e: any, idx: number): AOSEvent | null {
  if (!e || typeof e !== 'object') return null;
  if (!e.id) e.id = `legacy_${idx}`;
  if (!e.timestamp) e.timestamp = new Date(0).toISOString();
  if (e.type) e.type = String(e.type).toUpperCase();
  if (!('payload' in e)) e.payload = {};
  return e as AOSEvent;
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

function laneNorm(v: any): Lane {
  return v === 'ops' || v === 'operations' ? 'ops' : 'execution';
}

function applyEvent(tasks: Map<string, Task>, e: AOSEvent) {
  const ts = e.timestamp as string;
  const type = String(e.type || '').toUpperCase();
  const p = (e as any).payload || {};

  if (type === 'TASK_CREATE') {
    const id = p.taskId;
    if (!id) return;
    const t = tasks.get(id) || defaultTask(id);
    t.title = p.title || t.title;
    t.details = p.details || t.details;
    t.roleHint = p.roleHint || t.roleHint;
    t.priority = p.priority || t.priority;
    t.lane = laneNorm(p.lane || t.lane);
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
    if (p.lane) t.lane = laneNorm(p.lane);
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
    if (p.lane) t.lane = laneNorm(p.lane);
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
    if (p.lane) t.lane = laneNorm(p.lane);
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
    if (p.lane) t.lane = laneNorm(p.lane);
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

async function readSnapshot(workspaceRoot: string): Promise<{ offset: number; tasks: Record<string, Task> } | null> {
  const p = getSnapshotPath(workspaceRoot);
  const txt = await readFileText(p);
  if (!txt) return null;
  const obj = safeJsonParse(txt);
  if (!obj || typeof obj !== 'object') return null;
  if (!Number.isFinite(obj.offset)) return null;
  if (!obj.tasks || typeof obj.tasks !== 'object') return null;
  return { offset: Number(obj.offset), tasks: obj.tasks };
}

async function readNewEventsSinceOffset(filePath: string, startOffset: number): Promise<{ events: AOSEvent[]; newOffset: number }> {
  const fs = await import('node:fs/promises');
  const st = await fs.stat(filePath);
  const size = st.size;
  let offset = Number.isFinite(startOffset) && startOffset >= 0 ? startOffset : 0;

  if (offset > size) offset = 0; // log rotated/truncated
  if (offset === size) return { events: [], newOffset: offset };

  const fd = await fs.open(filePath, 'r');
  try {
    const len = size - offset;
    const buf = Buffer.alloc(len);
    await fd.read(buf, 0, len, offset);

    const lastNL = buf.lastIndexOf(0x0a); // '\n'
    if (lastNL === -1) return { events: [], newOffset: offset };

    const completeBuf = buf.subarray(0, lastNL);
    const text = completeBuf.toString('utf8');
    const lines = text.split('\n').filter(Boolean);

    const events: AOSEvent[] = [];
    for (let i = 0; i < lines.length; i++) {
      const e = normalizeEvent(safeJsonParse(lines[i]), i);
      if (e) events.push(e);
    }

    return { events, newOffset: offset + lastNL + 1 };
  } finally {
    await fd.close();
  }
}

async function readAllEventsSafe(filePath: string): Promise<AOSEvent[]> {
  const fs = await import('node:fs/promises');
  const buf = await fs.readFile(filePath);
  const lastNL = buf.lastIndexOf(0x0a);
  if (lastNL === -1) return [];
  const text = buf.subarray(0, lastNL).toString('utf8');
  const lines = text.split('\n').filter(Boolean);
  const events: AOSEvent[] = [];
  for (let i = 0; i < lines.length; i++) {
    const e = normalizeEvent(safeJsonParse(lines[i]), i);
    if (e) events.push(e);
  }
  return events;
}

/**
 * Project tasks from event log.
 *
 * Fidelity notes:
 * - Uses AOS snapshot (if present) + byte offset incremental scan
 * - Never writes to disk (dashboard is read-only)
 * - Safely ignores partial trailing lines
 */
export async function getTasksState(workspaceRoot: string): Promise<Map<string, Task>> {
  const fs = await import('node:fs/promises');
  const logPath = getEventLogPath(workspaceRoot);

  let tasks = new Map<string, Task>();
  let offset = 0;

  const snap = await readSnapshot(workspaceRoot);
  if (snap) {
    offset = snap.offset;
    for (const [taskId, t] of Object.entries(snap.tasks)) {
      // snapshot tasks are already projected by AOS; normalize lane defaults
      const lane = laneNorm((t as any).lane);
      tasks.set(taskId, { ...t, lane });
    }
  }

  try {
    await fs.stat(logPath);
  } catch {
    return tasks;
  }

  if (!snap) {
    const events = await readAllEventsSafe(logPath);
    for (const e of events) applyEvent(tasks, e);
    return tasks;
  }

  const { events: newEvents } = await readNewEventsSinceOffset(logPath, offset);
  for (const e of newEvents) applyEvent(tasks, e);
  return tasks;
}

export async function readEventsTail(workspaceRoot: string, limit = 200): Promise<AOSEvent[]> {
  // Simple + safe: full read, ignore partial last line, then take tail.
  const logPath = getEventLogPath(workspaceRoot);
  const events = await readAllEventsSafe(logPath);
  return events.slice(Math.max(0, events.length - limit));
}

export function computeTaskMetrics(tasks: Task[]): TaskMetrics {
  const byState: Record<string, number> = {};
  const byLane: Record<string, number> = { execution: 0, ops: 0 };
  const byRole: Record<string, number> = {};

  const now = Date.now();
  const slaBreaches: Array<{ taskId: string; ageMin: number; slaMinutes: number; lane?: Lane; role?: string }> = [];

  for (const t of tasks) {
    byState[t.state] = (byState[t.state] || 0) + 1;

    const lane = (t.lane || 'execution') as Lane;
    byLane[lane] = (byLane[lane] || 0) + 1;

    const role = t.roleHint || 'unknown';
    byRole[role] = (byRole[role] || 0) + 1;

    if (t.state === 'In Progress' && t.inProgressAt) {
      const ageMin = Math.floor((now - new Date(t.inProgressAt).getTime()) / 60000);
      const slaMinutes = Number(t.slaMinutes || 60);
      if (ageMin > slaMinutes) slaBreaches.push({ taskId: t.taskId, ageMin, slaMinutes, lane, role });
    }
  }

  slaBreaches.sort((a, b) => b.ageMin - a.ageMin);

  return { byState, byLane, byRole, slaBreachesCount: slaBreaches.length, slaBreaches };
}

// Back-compat export name
export const computeMetrics = computeTaskMetrics;

function keyFor(taskId: any, runId: any): string {
  return `${String(taskId || '')}::${String(runId || '')}`;
}

function toMs(iso: any): number {
  const t = new Date(String(iso || '')).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function computeCollabMetricsFrom(tasks: Task[], events: AOSEvent[], { windowHours = 24 }: { windowHours?: number } = {}): CollabMetrics {
  const cutoffMs = Date.now() - windowHours * 3600 * 1000;

  // current counts by role from tasks
  const roles = new Map<
    string,
    {
      role: string;
      current: { ready: number; inProgress: number; review: number; failed: number; done: number };
      recent: { dispatched: number; completedDone: number; completedFailed: number; cycleTimesMin: number[] };
    }
  >();

  function ensure(role: string) {
    if (!roles.has(role)) {
      roles.set(role, {
        role,
        current: { ready: 0, inProgress: 0, review: 0, failed: 0, done: 0 },
        recent: { dispatched: 0, completedDone: 0, completedFailed: 0, cycleTimesMin: [] }
      });
    }
    return roles.get(role)!;
  }

  for (const t of tasks) {
    const role = t.roleHint || 'unknown';
    const r = ensure(role);
    if (t.state === 'Ready') r.current.ready += 1;
    else if (t.state === 'In Progress') r.current.inProgress += 1;
    else if (t.state === 'Review') r.current.review += 1;
    else if (t.state === 'Failed') r.current.failed += 1;
    else if (t.state === 'Done') r.current.done += 1;
  }

  // recent event-based metrics
  const dispatchByKey = new Map<string, { tsMs: number; role: string }>();
  const completeByKey = new Map<string, { tsMs: number; status: 'DONE' | 'FAILED' | 'OTHER' }>();

  let validationErrors = 0;
  let mismatchesToReview = 0;

  for (const e of events) {
    const tsMs = toMs(e.timestamp);
    if (tsMs && tsMs < cutoffMs) continue;

    const type = String(e.type || '').toUpperCase();
    const p = (e as any).payload || {};

    if (type === 'VALIDATION_ERROR') validationErrors += 1;
    if (type === 'TASK_STATE' && String(p.state || '').toLowerCase() === 'review') {
      const dk = String(p.dedupeKey || '');
      if (dk.startsWith('mismatch::') || dk.startsWith('validation_review::')) mismatchesToReview += 1;
    }

    if (type === 'DISPATCH') {
      const taskId = p.taskId;
      const runId = p.runId;
      const role = String(p.role || 'unknown');
      dispatchByKey.set(keyFor(taskId, runId), { tsMs, role });
      ensure(role).recent.dispatched += 1;
    }

    if (type === 'TASK_COMPLETE') {
      const taskId = p.taskId;
      const runId = p.runId;
      const statusUpper = String(p.status || '').toUpperCase();
      const status = statusUpper === 'DONE' ? 'DONE' : statusUpper === 'FAILED' ? 'FAILED' : 'OTHER';
      completeByKey.set(keyFor(taskId, runId), { tsMs, status });
    }
  }

  // join dispatch + complete to compute cycle times and completion counts per role
  for (const [k, c] of completeByKey.entries()) {
    const d = dispatchByKey.get(k);
    if (!d) continue;
    const role = d.role;
    const r = ensure(role);

    if (c.status === 'DONE') r.recent.completedDone += 1;
    else if (c.status === 'FAILED') r.recent.completedFailed += 1;

    if (d.tsMs && c.tsMs && c.tsMs >= d.tsMs) {
      r.recent.cycleTimesMin.push(Math.floor((c.tsMs - d.tsMs) / 60000));
    }
  }

  const out = [...roles.values()].map((r) => {
    const times = r.recent.cycleTimesMin;
    const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
    return {
      role: r.role,
      current: r.current,
      recent: {
        dispatched: r.recent.dispatched,
        completedDone: r.recent.completedDone,
        completedFailed: r.recent.completedFailed,
        avgCycleTimeMin: avg !== null ? Math.round(avg * 10) / 10 : null
      }
    };
  });

  // stable sort: most in-progress first
  out.sort((a, b) => b.current.inProgress - a.current.inProgress);

  return {
    windowHours,
    roles: out,
    signals: { validationErrors, mismatchesToReview }
  };
}

export function computeLaneMetrics(tasks: Task[]): LaneMetrics[] {
  const now = Date.now();
  const lanes: Lane[] = ['execution', 'ops'];
  const result: LaneMetrics[] = [];

  for (const lane of lanes) {
    const laneTasks = tasks.filter(t => (t.lane || 'execution') === lane);
    const totalTasks = laneTasks.length;
    
    const backlog = laneTasks.filter(t => t.state === 'Ready' || t.state === 'Inbox').length;
    const inProgress = laneTasks.filter(t => t.state === 'In Progress').length;
    const review = laneTasks.filter(t => t.state === 'Review').length;
    const done = laneTasks.filter(t => t.state === 'Done').length;
    const failed = laneTasks.filter(t => t.state === 'Failed').length;

    // SLA risk: tasks in progress > 50% of their SLA
    const slaRiskTasks: Array<{ taskId: string; ageMin: number; slaMinutes: number; role?: string }> = [];
    let oldestInProgressMs: number | null = null;

    for (const t of laneTasks) {
      if (t.state === 'In Progress' && t.inProgressAt) {
        const ageMs = now - new Date(t.inProgressAt).getTime();
        const ageMin = Math.floor(ageMs / 60000);
        const slaMinutes = Number(t.slaMinutes || 60);
        
        if (oldestInProgressMs === null || ageMs > oldestInProgressMs) {
          oldestInProgressMs = ageMs;
        }
        
        // At risk if > 50% of SLA elapsed
        if (ageMin > slaMinutes * 0.5) {
          slaRiskTasks.push({
            taskId: t.taskId,
            ageMin,
            slaMinutes,
            role: t.roleHint
          });
        }
      }
    }

    // Saturation: % of tasks that are in progress relative to total (excluding done)
    const activeTasks = totalTasks - done;
    const saturationPercent = activeTasks > 0 ? Math.round((inProgress / activeTasks) * 100) : 0;
    
    // Bottleneck score: weighted combination of risk factors
    // - High in-progress + low throughput = bottleneck
    // - SLA breaches increase score
    // - Low done count relative to in-progress indicates stuck
    const throughputRatio = done > 0 ? inProgress / done : inProgress;
    const bottleneckScore = Math.min(100, Math.round(
      (saturationPercent * 0.3) + 
      (slaRiskTasks.length * 20) + 
      (throughputRatio * 10) +
      (failed * 5)
    ));

    result.push({
      lane,
      totalTasks,
      backlog,
      inProgress,
      review,
      done,
      failed,
      slaRiskCount: slaRiskTasks.length,
      oldestInProgressMin: oldestInProgressMs !== null ? Math.floor(oldestInProgressMs / 60000) : null,
      saturationPercent,
      bottleneckScore,
      slaBreaches: slaRiskTasks
    });
  }

  return result;
}

export function computeBottleneckAnalysis(tasks: Task[]): BottleneckAnalysis {
  const laneMetrics = computeLaneMetrics(tasks);
  
  // Determine overall risk
  const totalSlaRisk = laneMetrics.reduce((sum, lm) => sum + lm.slaRiskCount, 0);
  const avgBottleneck = laneMetrics.reduce((sum, lm) => sum + lm.bottleneckScore, 0) / laneMetrics.length;
  
  let overallRisk: 'low' | 'medium' | 'high' = 'low';
  if (totalSlaRisk >= 3 || avgBottleneck >= 60) {
    overallRisk = 'high';
  } else if (totalSlaRisk >= 1 || avgBottleneck >= 30) {
    overallRisk = 'medium';
  }

  // Find critical bottleneck
  const sortedByBottleneck = [...laneMetrics].sort((a, b) => b.bottleneckScore - a.bottleneckScore);
  const criticalBottleneck = sortedByBottleneck[0]?.bottleneckScore > 20 
    ? sortedByBottleneck[0].lane 
    : null;

  // Generate recommendations
  const recommendations: string[] = [];
  
  for (const lm of laneMetrics) {
    if (lm.slaRiskCount > 0) {
      recommendations.push(`[${lm.lane}] ${lm.slaRiskCount} task(s) approaching SLA limit - review priority`);
    }
    if (lm.bottleneckScore >= 50) {
      recommendations.push(`[${lm.lane}] High bottleneck score (${lm.bottleneckScore}) - consider adding resources or clearing blockers`);
    }
    if (lm.oldestInProgressMin !== null && lm.oldestInProgressMin > 120) {
      recommendations.push(`[${lm.lane}] Task stuck for ${lm.oldestInProgressMin}min - oldest in-progress needs attention`);
    }
    if (lm.backlog > 10 && lm.inProgress === 0) {
      recommendations.push(`[${lm.lane}] Large backlog (${lm.backlog}) but nothing in progress - dispatch needed`);
    }
    if (lm.failed > 2) {
      recommendations.push(`[${lm.lane}] ${lm.failed} failed tasks - review errors and retry`);
    }
  }

  if (recommendations.length === 0) {
    recommendations.push('All lanes operating normally');
  }

  return {
    lanes: laneMetrics,
    overallRisk,
    criticalBottleneck,
    recommendations
  };
}
