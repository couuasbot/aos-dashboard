import Fastify from 'fastify';
import cors from '@fastify/cors';

import {
  readEventsTail,
  getTasksState,
  computeTaskMetrics,
  computeCollabMetricsFrom,
  readAutopilotLock,
  resolveWorkspaceRoot,
  getEventLogPath
} from '@aos-dashboard/aos-core';

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 8787);

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get('/api/health', async () => {
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

app.get('/api/tasks', async () => {
  const workspaceRoot = resolveWorkspaceRoot();
  const tasks = await getTasksState(workspaceRoot);
  return { tasks: [...tasks.values()] };
});

app.get('/api/metrics', async () => {
  const workspaceRoot = resolveWorkspaceRoot();
  const tasks = await getTasksState(workspaceRoot);
  return computeTaskMetrics([...tasks.values()]);
});

app.get('/api/collab', async (req) => {
  const workspaceRoot = resolveWorkspaceRoot();
  const windowHours = Math.min(168, Math.max(1, Number((req.query as any)?.windowHours || 24)));
  const tasks = await getTasksState(workspaceRoot);
  const events = await readEventsTail(workspaceRoot, 5000);
  return computeCollabMetricsFrom([...tasks.values()], events, { windowHours });
});

app.get('/api/overview', async (req) => {
  const workspaceRoot = resolveWorkspaceRoot();
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

app.get('/api/events', async (req) => {
  const workspaceRoot = resolveWorkspaceRoot();
  const limit = Math.min(1000, Math.max(1, Number((req.query as any)?.limit || 200)));
  const events = await readEventsTail(workspaceRoot, limit);
  return { events };
});

app.listen({ host, port });
