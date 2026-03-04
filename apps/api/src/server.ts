import Fastify from 'fastify';
import cors from '@fastify/cors';
import fs from 'node:fs/promises';

import {
  readEventsTail,
  getTasksState,
  computeTaskMetrics,
  computeCollabMetricsFrom,
  computeLaneMetrics,
  computeBottleneckAnalysis,
  readAutopilotLock,
  resolveWorkspaceRoot,
  getEventLogPath
} from '@aos-dashboard/aos-core';

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 8787);

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

// Helper to get workspaceRoot from query params or default
function getWorkspaceRootFromQuery(query: Record<string, unknown>): string {
  const ws = query.workspaceRoot;
  return typeof ws === 'string' && ws.trim() ? ws.trim() : resolveWorkspaceRoot();
}

// Health endpoint - returns current workspace root
app.get('/api/health', async (req) => {
  const workspaceRoot = resolveWorkspaceRoot();
  const eventLogPath = getEventLogPath(workspaceRoot);
  const lock = await readAutopilotLock(workspaceRoot);
  return {
    status: 'ok',
    workspaceRoot,
    eventLogPath,
    lock
  };
});

// Tasks endpoint with optional workspaceRoot override
app.get('/api/tasks', async (req) => {
  const workspaceRoot = getWorkspaceRootFromQuery(req.query as Record<string, unknown>);
  const tasks = await getTasksState(workspaceRoot);
  return { tasks: [...tasks.values()] };
});

// Metrics endpoint with optional workspaceRoot override
app.get('/api/metrics', async (req) => {
  const workspaceRoot = getWorkspaceRootFromQuery(req.query as Record<string, unknown>);
  const tasks = await getTasksState(workspaceRoot);
  return computeTaskMetrics([...tasks.values()]);
});

// Collab endpoint with optional workspaceRoot override
app.get('/api/collab', async (req) => {
  const workspaceRoot = getWorkspaceRootFromQuery(req.query as Record<string, unknown>);
  const windowHours = Math.min(168, Math.max(1, Number((req.query as any)?.windowHours || 24)));
  const tasks = await getTasksState(workspaceRoot);
  const events = await readEventsTail(workspaceRoot, 5000);
  return computeCollabMetricsFrom([...tasks.values()], events, { windowHours });
});

// Overview endpoint with optional workspaceRoot override
app.get('/api/overview', async (req) => {
  const workspaceRoot = getWorkspaceRootFromQuery(req.query as Record<string, unknown>);
  const windowHours = Math.min(168, Math.max(1, Number((req.query as any)?.windowHours || 24)));

  const [tasksMap, events, lock] = await Promise.all([
    getTasksState(workspaceRoot),
    readEventsTail(workspaceRoot, 2000),
    readAutopilotLock(workspaceRoot)
  ]);

  const tasks = [...tasksMap.values()];
  const metrics = computeTaskMetrics(tasks);
  const collab = computeCollabMetricsFrom(tasks, events, { windowHours });

  return { workspaceRoot, lock, metrics, collab, tasks };
});

// Events endpoint with optional filtering and search
// Query params: limit, type (comma-separated), role, runId, search (text search in payload)
app.get('/api/events', async (req) => {
  const workspaceRoot = getWorkspaceRootFromQuery(req.query as Record<string, unknown>);
  const limit = Math.min(1000, Math.max(1, Number((req.query as any)?.limit || 200)));
  
  // Filter params
  const typeFilter = (req.query as any)?.type;
  const roleFilter = (req.query as any)?.role;
  const runIdFilter = (req.query as any)?.runId;
  const searchFilter = (req.query as any)?.search;
  
  let events = await readEventsTail(workspaceRoot, 1000); // Fetch more to filter
  
  // Apply filters
  if (typeFilter) {
    const types = typeFilter.split(',').map((t: string) => t.trim().toUpperCase());
    events = events.filter(e => types.includes(String(e.type).toUpperCase()));
  }
  
  if (roleFilter) {
    const role = roleFilter.trim().toLowerCase();
    events = events.filter(e => {
      const p = e.payload || {};
      return String(p.role || '').toLowerCase() === role;
    });
  }
  
  if (runIdFilter) {
    const runId = runIdFilter.trim();
    events = events.filter(e => {
      const p = e.payload || {};
      return String(p.runId || '') === runId;
    });
  }
  
  if (searchFilter) {
    const search = searchFilter.trim().toLowerCase();
    events = events.filter(e => {
      const p = e.payload || {};
      // Search in all payload values as strings
      return Object.values(p).some(v => 
        String(v).toLowerCase().includes(search)
      );
    });
  }
  
  // Apply limit after filtering
  events = events.slice(-limit);
  
  return { events };
});

// Lanes endpoint with optional workspaceRoot override
app.get('/api/lanes', async (req) => {
  const workspaceRoot = getWorkspaceRootFromQuery(req.query as Record<string, unknown>);
  const tasks = await getTasksState(workspaceRoot);
  const laneMetrics = computeLaneMetrics([...tasks.values()]);
  const bottleneckAnalysis = computeBottleneckAnalysis([...tasks.values()]);
  return { laneMetrics, bottleneckAnalysis };
});

// Task detail endpoint with optional workspaceRoot override
app.get('/api/task/:taskId', async (req) => {
  const workspaceRoot = getWorkspaceRootFromQuery(req.query as Record<string, unknown>);
  const taskId = (req.params as Record<string, string>).taskId;
  
  if (!taskId) {
    return { error: 'taskId is required' };
  }

  const [tasksMap, allEvents] = await Promise.all([
    getTasksState(workspaceRoot),
    readEventsTail(workspaceRoot, 5000)
  ]);

  const task = tasksMap.get(taskId);
  
  if (!task) {
    return { error: `Task ${taskId} not found`, taskId };
  }

  // Filter events for this task
  const taskEvents = allEvents.filter(e => {
    const p = e.payload || {};
    return p.taskId === taskId;
  });

  // Compute dispatch history
  const dispatchHistory: Array<{
    runId: string | null;
    role: string | null;
    at: string;
    cycleTimeMin: number | null;
    outcome: 'done' | 'failed' | 'unknown' | 'pending';
  }> = [];

  for (const e of taskEvents) {
    const p = e.payload || {};
    if (e.type === 'DISPATCH' && p.taskId === taskId) {
      const runId = p.runId || null;
      const role = p.role || null;
      const at = e.timestamp;
      
      // Find corresponding completion
      const completionEvent = taskEvents.find(ev => {
        const cp = ev.payload || {};
        return ev.type === 'TASK_COMPLETE' && 
               cp.taskId === taskId && 
               cp.runId === runId;
      });
      
      let outcome: 'done' | 'failed' | 'unknown' | 'pending' = 'pending';
      let cycleTimeMin: number | null = null;
      
      if (completionEvent) {
        const cp = completionEvent.payload || {};
        const status = String(cp.status || '').toUpperCase();
        outcome = status === 'DONE' ? 'done' : status === 'FAILED' ? 'failed' : 'unknown';
        
        const dispatchMs = new Date(at).getTime();
        const completeMs = new Date(completionEvent.timestamp).getTime();
        if (dispatchMs && completeMs && completeMs >= dispatchMs) {
          cycleTimeMin = Math.floor((completeMs - dispatchMs) / 60000);
        }
      }
      
      dispatchHistory.push({ runId, role, at, cycleTimeMin, outcome });
    }
  }

  // Sort by most recent first
  dispatchHistory.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  // Calculate derived metrics
  const attemptCount = task.attempts || 0;
  const completedDispatches = dispatchHistory.filter(d => d.outcome !== 'pending');
  const avgCycleTimeMin = completedDispatches.length > 0
    ? completedDispatches
        .filter(d => d.cycleTimeMin !== null)
        .reduce((sum, d, _, arr) => sum + (d.cycleTimeMin || 0) / arr.length, 0)
    : null;

  // Current task state details
  const currentAgeMin = task.inProgressAt
    ? Math.floor((Date.now() - new Date(task.inProgressAt).getTime()) / 60000)
    : null;

  const resultPath = task.resultPath;
  const lastError = task.lastError;

  return {
    task,
    taskId,
    events: taskEvents,
    dispatchHistory,
    metrics: {
      attemptCount,
      avgCycleTimeMin: avgCycleTimeMin !== null ? Math.round(avgCycleTimeMin * 10) / 10 : null,
      currentAgeMin,
      lastRunId: task.lastDispatch?.runId || null,
      lastDispatchAt: task.lastDispatch?.at || null,
      resultPath,
      lastError
    }
  };
});

// Endpoint to fetch human-readable summary for a task run
app.get('/api/task/:taskId/run/:runId/summary', async (req) => {
  const workspaceRoot = getWorkspaceRootFromQuery(req.query as Record<string, unknown>);
  const taskId = (req.params as Record<string, string>).taskId;
  const runId = (req.params as Record<string, string>).runId;

  if (!taskId || !runId) {
    return { error: 'taskId and runId are required' };
  }

  // Artifacts directory structure: /artifacts/aos-tasks/{taskId}/{runId}/
  // The summary.md is at: {artifactsDir}/{runId}/summary.md
  // And result.json is at: {artifactsDir}/{runId}/result.json

  const tasksMap = await getTasksState(workspaceRoot);
  const task = tasksMap.get(taskId);

  if (!task) {
    return { error: `Task ${taskId} not found`, taskId };
  }

  // Use task's artifactsDir if available, otherwise construct from taskId
  const artifactsDir = task.artifactsDir || `${workspaceRoot}/artifacts/aos-tasks/${taskId.replace('#', '')}`;
  const runDir = `${artifactsDir}/${runId}`;

  // Try to read summary.md
  const summaryPath = `${runDir}/summary.md`;
  let summaryContent: string | null = null;
  let resultJson: any = null;

  try {
    summaryContent = await fs.readFile(summaryPath, 'utf8');
  } catch {
    // Summary not found, try result.json as fallback
  }

  // Try to read result.json
  const resultPath = `${runDir}/result.json`;
  try {
    const resultContent = await fs.readFile(resultPath, 'utf8');
    resultJson = JSON.parse(resultContent);
  } catch {
    // result.json not found
  }

  return {
    taskId,
    runId,
    summary: summaryContent,
    result: resultJson
  };
});

app.listen({ host, port });
