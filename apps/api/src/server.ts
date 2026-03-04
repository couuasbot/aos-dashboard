import Fastify from 'fastify';
import cors from '@fastify/cors';

import {
  readEventsTail,
  getTasksState,
  computeMetrics,
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
  return computeMetrics([...tasks.values()]);
});

app.get('/api/events', async (req) => {
  const workspaceRoot = resolveWorkspaceRoot();
  const limit = Math.min(1000, Math.max(1, Number((req.query as any)?.limit || 200)));
  const events = await readEventsTail(workspaceRoot, limit);
  return { events };
});

app.listen({ host, port });
