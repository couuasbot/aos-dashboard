import { describe, expect, it } from 'vitest';
import { getTasksState, type AOSEvent } from '../src/index';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

function evt(type: string, payload: any, ts = '2026-01-01T00:00:00.000Z'): AOSEvent {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    timestamp: ts,
    type,
    agent: 'god',
    payload,
    schemaVersion: 1
  };
}

describe('getTasksState (snapshot + offset incremental)', () => {
  it('loads snapshot tasks and applies only complete new lines; ignores partial last line', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-dashboard-'));
    const aosDir = path.join(dir, '.aos');
    await fs.mkdir(aosDir, { recursive: true });

    // Snapshot: one task already Ready
    const snap = {
      schemaVersion: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      logPath: path.join(dir, 'workflow-events.jsonl'),
      offset: 10, // pretend offset
      tasks: {
        '#1': {
          taskId: '#1',
          title: 't1',
          state: 'Ready',
          lane: 'execution',
          roleHint: 'cto',
          slaMinutes: 60,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      }
    };
    await fs.writeFile(path.join(aosDir, 'workflow-snapshot.json'), JSON.stringify(snap, null, 2));

    // Event log content: first 10 bytes ignored; then one full DISPATCH line + one partial line
    const full = JSON.stringify(evt('DISPATCH', { taskId: '#1', runId: 'run_1', role: 'cto', intent: 't1', lane: 'execution' }, '2026-01-01T00:10:00.000Z'));
    const partial = JSON.stringify(evt('TASK_COMPLETE', { taskId: '#1', runId: 'run_1', status: 'DONE' }, '2026-01-01T00:20:00.000Z')).slice(0, 20);

    // pad 10 bytes so offset points right before `full`.
    await fs.writeFile(path.join(dir, 'workflow-events.jsonl'), '0123456789' + full + '\n' + partial);

    const tasks = await getTasksState(dir);
    const t1 = tasks.get('#1');

    expect(t1).toBeTruthy();
    // DISPATCH should have been applied (state becomes In Progress)
    expect(t1!.state).toBe('In Progress');
    expect(t1!.lastDispatch?.runId).toBe('run_1');

    // TASK_COMPLETE should NOT be applied due to partial line
    expect(t1!.state).not.toBe('Done');
  });
});
