import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../src/index';
describe('computeMetrics', () => {
    it('counts states/lanes and detects SLA breaches', () => {
        const now = Date.now();
        const tasks = [
            {
                taskId: '#1',
                title: 't1',
                state: 'In Progress',
                lane: 'execution',
                slaMinutes: 10,
                inProgressAt: new Date(now - 11 * 60000).toISOString()
            },
            {
                taskId: '#2',
                title: 't2',
                state: 'Ready',
                lane: 'ops'
            }
        ];
        const m = computeMetrics(tasks);
        expect(m.byState['In Progress']).toBe(1);
        expect(m.byState['Ready']).toBe(1);
        expect(m.byLane.execution).toBe(1);
        expect(m.byLane.ops).toBe(1);
        expect(m.slaBreachesCount).toBe(1);
        expect(m.slaBreaches[0].taskId).toBe('#1');
    });
});
