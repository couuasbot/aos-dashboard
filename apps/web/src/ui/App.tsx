import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, CheckCircle2, TimerReset } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import clsx from 'clsx';

type Task = {
  taskId: string;
  title: string;
  state: string;
  lane?: string;
  roleHint?: string;
  slaMinutes?: number;
  inProgressAt?: string | null;
};

type Metrics = {
  byState: Record<string, number>;
  byLane: Record<string, number>;
  slaBreachesCount: number;
  slaBreaches: Array<{ taskId: string; ageMin: number; slaMinutes: number }>;
};

function useApi<T>(path: string) {
  return useQuery({
    queryKey: [path],
    queryFn: async () => {
      const res = await fetch(path);
      if (!res.ok) throw new Error(await res.text());
      return (await res.json()) as T;
    },
    refetchInterval: 5000
  });
}

function Card(props: { title: string; value: string | number; icon: any; tone?: 'ok' | 'warn' | 'info' }) {
  const Icon = props.icon;
  const tone = props.tone || 'info';
  const toneCls =
    tone === 'ok'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : tone === 'warn'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-slate-200 bg-white text-slate-900';

  return (
    <div className={clsx('rounded-xl border p-4 shadow-sm', toneCls)}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide opacity-70">{props.title}</div>
          <div className="mt-1 text-2xl font-semibold">{props.value}</div>
        </div>
        <div className="rounded-lg bg-white/50 p-2">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const tasksQ = useApi<{ tasks: Task[] }>('/api/tasks');
  const metricsQ = useApi<Metrics>('/api/metrics');

  const tasks = tasksQ.data?.tasks || [];
  const metrics = metricsQ.data;

  const total = tasks.length;
  const inProgress = tasks.filter((t) => t.state === 'In Progress').length;
  const ready = tasks.filter((t) => t.state === 'Ready').length;

  const chartData = metrics
    ? Object.entries(metrics.byState).map(([state, count]) => ({ state, count }))
    : [];

  return (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div>
            <div className="text-lg font-semibold">AOS Dashboard</div>
            <div className="text-sm text-slate-600">Task queue • agent collaboration • reliability metrics</div>
          </div>
          <div className="text-xs text-slate-500">
            refresh: 5s
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-4 px-4 py-6">
        <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Card title="Total Tasks" value={total} icon={Activity} />
          <Card title="Ready" value={ready} icon={TimerReset} tone="info" />
          <Card title="In Progress" value={inProgress} icon={Activity} tone="info" />
          <Card
            title="SLA Breaches"
            value={metrics ? metrics.slaBreachesCount : '-'}
            icon={metrics && metrics.slaBreachesCount > 0 ? AlertTriangle : CheckCircle2}
            tone={metrics && metrics.slaBreachesCount > 0 ? 'warn' : 'ok'}
          />
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="mb-3 text-sm font-semibold">Tasks by State</div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <XAxis dataKey="state" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#334155" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="mb-3 text-sm font-semibold">SLA Breaches</div>
            {!metrics || metrics.slaBreaches.length === 0 ? (
              <div className="text-sm text-slate-600">No breaches.</div>
            ) : (
              <div className="space-y-2">
                {metrics.slaBreaches.slice(0, 8).map((b) => (
                  <div key={b.taskId} className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm">
                    <div className="font-medium">{b.taskId}</div>
                    <div className="text-slate-700">{b.ageMin}m / SLA {b.slaMinutes}m</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold">Queue</div>
            <div className="text-xs text-slate-500">
              {tasksQ.isLoading ? 'loading…' : tasksQ.isError ? 'error' : `${tasks.length} tasks`}
            </div>
          </div>

          <div className="overflow-auto">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="border-b text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Task</th>
                  <th className="py-2 pr-3">State</th>
                  <th className="py-2 pr-3">Lane</th>
                  <th className="py-2 pr-3">Role</th>
                  <th className="py-2 pr-3">SLA</th>
                  <th className="py-2 pr-3">InProgressAt</th>
                </tr>
              </thead>
              <tbody>
                {tasks
                  .slice()
                  .sort((a, b) => String(b.inProgressAt || '').localeCompare(String(a.inProgressAt || '')))
                  .map((t) => (
                    <tr key={t.taskId} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium">{t.title} <span className="text-slate-500">{t.taskId}</span></td>
                      <td className="py-2 pr-3">{t.state}</td>
                      <td className="py-2 pr-3">{t.lane || 'execution'}</td>
                      <td className="py-2 pr-3">{t.roleHint || '-'}</td>
                      <td className="py-2 pr-3">{t.slaMinutes || 60}m</td>
                      <td className="py-2 pr-3 text-slate-600">{t.inProgressAt || '-'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
