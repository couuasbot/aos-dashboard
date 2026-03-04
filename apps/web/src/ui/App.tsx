import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  HardDrive,
  ShieldCheck,
  ArrowRight,
  Zap,
  Gauge,
  Download
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import clsx from 'clsx';
import { toCSV, downloadJSON, downloadCSV, taskColumns, transformCollabRoles, collabRoleExportColumns } from './export';

type Lane = 'execution' | 'ops';

type Task = {
  taskId: string;
  title: string;
  state: string;
  lane?: Lane;
  roleHint?: string;
  slaMinutes?: number;
  inProgressAt?: string | null;
  lastDispatch?: { runId?: string | null } | null;
};

type Lock = {
  path: string;
  exists: boolean;
  pid?: number;
  startTs?: string;
  ttlMs?: number;
  stale?: boolean;
  ageMs?: number;
};

type LaneMetrics = {
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

type BottleneckAnalysis = {
  lanes: LaneMetrics[];
  overallRisk: 'low' | 'medium' | 'high';
  criticalBottleneck: Lane | null;
  recommendations: string[];
};

type Metrics = {
  byState: Record<string, number>;
  byLane: Record<string, number>;
  byRole: Record<string, number>;
  slaBreachesCount: number;
  slaBreaches: Array<{ taskId: string; ageMin: number; slaMinutes: number; lane?: Lane; role?: string }>;
};

type Collab = {
  windowHours: number;
  roles: Array<{
    role: string;
    current: { ready: number; inProgress: number; review: number; failed: number; done: number };
    recent: { dispatched: number; completedDone: number; completedFailed: number; avgCycleTimeMin: number | null };
  }>;
  signals: { validationErrors: number; mismatchesToReview: number };
};

type Overview = {
  workspaceRoot: string;
  lock: Lock;
  metrics: Metrics;
  collab: Collab;
  tasks: Task[];
};

type AOSEvent = {
  id: string;
  timestamp: string;
  type: string;
  agent?: string;
  payload?: any;
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

function Card(props: {
  title: string;
  value: string | number;
  icon: any;
  tone?: 'ok' | 'warn' | 'info';
  subtitle?: string;
}) {
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide opacity-70">{props.title}</div>
          <div className="mt-1 text-2xl font-semibold">{props.value}</div>
          {props.subtitle ? <div className="mt-1 text-xs opacity-70">{props.subtitle}</div> : null}
        </div>
        <div className="rounded-lg bg-white/50 p-2">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function pill(tone: 'ok' | 'warn' | 'info') {
  return tone === 'ok'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
    : tone === 'warn'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-slate-200 bg-slate-50 text-slate-700';
}

export default function App() {
  const overviewQ = useApi<Overview>('/api/overview');
  const eventsQ = useApi<{ events: AOSEvent[] }>('/api/events?limit=80');
  const lanesQ = useApi<{ laneMetrics: LaneMetrics[]; bottleneckAnalysis: BottleneckAnalysis }>('/api/lanes');

  const overview = overviewQ.data;
  const tasks = overview?.tasks || [];
  const metrics = overview?.metrics;
  const collab = overview?.collab;
  const lanesData = lanesQ.data;
  const laneMetrics = lanesData?.laneMetrics || [];
  const bottleneckAnalysis = lanesData?.bottleneckAnalysis;

  const chartData = useMemo(() => {
    if (!metrics) return [];
    return Object.entries(metrics.byState)
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count);
  }, [metrics]);

  const roleData = useMemo(() => {
    if (!collab) return [];
    return collab.roles.map((r) => ({
      role: r.role,
      inProgress: r.current.inProgress,
      ready: r.current.ready,
      review: r.current.review
    }));
  }, [collab]);

  const breachTone = metrics && metrics.slaBreachesCount > 0 ? 'warn' : 'ok';

  // Export handlers
  const handleExportTasksJSON = () => {
    downloadJSON(tasks, `tasks-${new Date().toISOString().slice(0,10)}.json`);
  };

  const handleExportTasksCSV = () => {
    const csv = toCSV(tasks, taskColumns);
    downloadCSV(csv, `tasks-${new Date().toISOString().slice(0,10)}.csv`);
  };

  const handleExportMetricsJSON = () => {
    downloadJSON(metrics, `metrics-${new Date().toISOString().slice(0,10)}.json`);
  };

  const handleExportCollabJSON = () => {
    downloadJSON(collab, `collab-${new Date().toISOString().slice(0,10)}.json`);
  };

  const handleExportCollabCSV = () => {
    if (!collab) return;
    const exportData = transformCollabRoles(collab.roles);
    const csv = toCSV(exportData, collabRoleExportColumns);
    downloadCSV(csv, `collab-roles-${new Date().toISOString().slice(0,10)}.csv`);
  };

  return (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div>
            <div className="text-lg font-semibold">AOS Dashboard</div>
            <div className="text-sm text-slate-600">
              Read-only • local-first • reliable metrics
            </div>
          </div>
          <div className="text-right text-xs text-slate-500">
            <div>refresh: 5s</div>
            {overview?.workspaceRoot ? <div className="mt-1">root: {overview.workspaceRoot}</div> : null}
          </div>
        </div>
      </header>

      {/* Export Controls */}
      <div className="bg-slate-50 border-b px-4 py-2">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="text-xs text-slate-500">Export Data:</div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportTasksJSON}
              className="flex items-center gap-1 rounded border bg-white px-2 py-1 text-xs hover:bg-slate-100"
            >
              <Download className="h-3 w-3" /> Tasks JSON
            </button>
            <button
              onClick={handleExportTasksCSV}
              className="flex items-center gap-1 rounded border bg-white px-2 py-1 text-xs hover:bg-slate-100"
            >
              <Download className="h-3 w-3" /> Tasks CSV
            </button>
            <button
              onClick={handleExportMetricsJSON}
              className="flex items-center gap-1 rounded border bg-white px-2 py-1 text-xs hover:bg-slate-100"
            >
              <Download className="h-3 w-3" /> Metrics JSON
            </button>
            <button
              onClick={handleExportCollabJSON}
              className="flex items-center gap-1 rounded border bg-white px-2 py-1 text-xs hover:bg-slate-100"
            >
              <Download className="h-3 w-3" /> Collab JSON
            </button>
            <button
              onClick={handleExportCollabCSV}
              className="flex items-center gap-1 rounded border bg-white px-2 py-1 text-xs hover:bg-slate-100"
            >
              <Download className="h-3 w-3" /> Collab CSV
            </button>
          </div>
        </div>
      </div>

      <main className="mx-auto grid max-w-6xl gap-4 px-4 py-6">
        <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Card title="Total Tasks" value={tasks.length} icon={Activity} />
          <Card title="Ready" value={metrics?.byState['Ready'] ?? '-'} icon={Clock} tone="info" />
          <Card title="In Progress" value={metrics?.byState['In Progress'] ?? '-'} icon={Activity} tone="info" />
          <Card
            title="SLA Breaches"
            value={metrics ? metrics.slaBreachesCount : '-'}
            icon={breachTone === 'warn' ? AlertTriangle : CheckCircle2}
            tone={breachTone}
          />
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card
            title="Validation Errors (recent)"
            value={collab?.signals.validationErrors ?? '-'}
            icon={ShieldCheck}
            tone={(collab?.signals.validationErrors || 0) > 0 ? 'warn' : 'ok'}
            subtitle={collab ? `window: ${collab.windowHours}h` : ''}
          />
          <Card
            title="Review Signals (recent)"
            value={collab?.signals.mismatchesToReview ?? '-'}
            icon={AlertTriangle}
            tone={(collab?.signals.mismatchesToReview || 0) > 0 ? 'warn' : 'ok'}
            subtitle="mismatch / validation->review"
          />
          <Card
            title="Autopilot Lock"
            value={overview?.lock.exists ? (overview.lock.stale ? 'STALE' : 'HELD/OK') : 'NONE'}
            icon={HardDrive}
            tone={overview?.lock.exists ? (overview.lock.stale ? 'warn' : 'ok') : 'info'}
            subtitle={overview?.lock.exists ? `${overview.lock.path}` : 'no lock file'}
          />
        </section>

        {/* Lane View & Bottleneck Detection */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Lane Cards */}
          <div className="space-y-4">
            <div className="text-sm font-semibold">Lane View</div>
            {laneMetrics.length === 0 ? (
              <div className="text-sm text-slate-600">Loading lane metrics...</div>
            ) : (
              laneMetrics.map((lm) => {
                const laneTone = lm.slaRiskCount > 0 ? 'warn' : lm.bottleneckScore > 40 ? 'warn' : 'ok';
                return (
                  <div
                    key={lm.lane}
                    className={clsx(
                      'rounded-xl border p-4 shadow-sm',
                      laneTone === 'warn' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'
                    )}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-semibold capitalize">{lm.lane}</span>
                        {bottleneckAnalysis?.criticalBottleneck === lm.lane && (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                            BOTTLENECK
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Gauge className="h-4 w-4" />
                        <span className="text-sm font-medium">
                          Score: {lm.bottleneckScore}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-center text-sm">
                      <div>
                        <div className="text-xs text-slate-500">Backlog</div>
                        <div className="font-semibold">{lm.backlog}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">In Progress</div>
                        <div className="font-semibold">{lm.inProgress}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">SLA Risk</div>
                        <div className={clsx('font-semibold', lm.slaRiskCount > 0 ? 'text-amber-700' : 'text-slate-700')}>
                          {lm.slaRiskCount}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">Saturation</div>
                        <div className="font-semibold">{lm.saturationPercent}%</div>
                      </div>
                    </div>
                    {lm.oldestInProgressMin !== null && (
                      <div className="mt-2 pt-2 border-t text-xs text-slate-600">
                        Oldest in-progress: {lm.oldestInProgressMin}min
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Bottleneck Analysis Chart */}
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold">Bottleneck Analysis</div>
              <div className={clsx(
                'rounded px-2 py-0.5 text-xs font-medium',
                bottleneckAnalysis?.overallRisk === 'high' ? 'bg-red-100 text-red-700' :
                bottleneckAnalysis?.overallRisk === 'medium' ? 'bg-amber-100 text-amber-700' :
                'bg-emerald-100 text-emerald-700'
              )}>
                Risk: {bottleneckAnalysis?.overallRisk || 'unknown'}
              </div>
            </div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={laneMetrics}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="lane" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="bottleneckScore" name="Bottleneck Score" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 space-y-1">
              {bottleneckAnalysis?.recommendations.slice(0, 3).map((rec, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs text-slate-600">
                  <ArrowRight className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  <span>{rec}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold">Tasks by State</div>
              <div className="text-xs text-slate-500">projected from workflow-events.jsonl</div>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="state" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#334155" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold">Agent Collaboration (current)</div>
              <div className="text-xs text-slate-500">by roleHint</div>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={roleData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="role" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="inProgress" stackId="a" fill="#0f172a" />
                  <Bar dataKey="ready" stackId="a" fill="#64748b" />
                  <Bar dataKey="review" stackId="a" fill="#f59e0b" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="mb-3 text-sm font-semibold">SLA Breaches</div>
            {!metrics || metrics.slaBreaches.length === 0 ? (
              <div className="text-sm text-slate-600">No breaches.</div>
            ) : (
              <div className="space-y-2">
                {metrics.slaBreaches.slice(0, 10).map((b) => (
                  <div
                    key={b.taskId}
                    className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm"
                  >
                    <div className="font-medium">
                      {b.taskId}{' '}
                      <span className="ml-2 rounded border px-1.5 py-0.5 text-xs text-slate-700">
                        {b.lane || 'execution'} / {b.role || 'unknown'}
                      </span>
                    </div>
                    <div className="text-slate-700">
                      {b.ageMin}m / SLA {b.slaMinutes}m
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold">Roles (recent {collab?.windowHours ?? 24}h)</div>
              <div className="text-xs text-slate-500">dispatch & cycle time</div>
            </div>
            {!collab ? (
              <div className="text-sm text-slate-600">Loading…</div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="border-b text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-2 pr-3">Role</th>
                      <th className="py-2 pr-3">InProg</th>
                      <th className="py-2 pr-3">Ready</th>
                      <th className="py-2 pr-3">Review</th>
                      <th className="py-2 pr-3">Dispatched</th>
                      <th className="py-2 pr-3">Done</th>
                      <th className="py-2 pr-3">Failed</th>
                      <th className="py-2 pr-3">Avg Cycle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {collab.roles.map((r) => (
                      <tr key={r.role} className="border-b last:border-0">
                        <td className="py-2 pr-3 font-medium">{r.role}</td>
                        <td className="py-2 pr-3">{r.current.inProgress}</td>
                        <td className="py-2 pr-3">{r.current.ready}</td>
                        <td className="py-2 pr-3">{r.current.review}</td>
                        <td className="py-2 pr-3">{r.recent.dispatched}</td>
                        <td className="py-2 pr-3">{r.recent.completedDone}</td>
                        <td className="py-2 pr-3">{r.recent.completedFailed}</td>
                        <td className="py-2 pr-3 text-slate-600">
                          {r.recent.avgCycleTimeMin === null ? '-' : `${r.recent.avgCycleTimeMin}m`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold">Queue</div>
            <div className="text-xs text-slate-500">
              {overviewQ.isLoading ? 'loading…' : overviewQ.isError ? 'error' : `${tasks.length} tasks`}
            </div>
          </div>

          <div className="overflow-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Task</th>
                  <th className="py-2 pr-3">State</th>
                  <th className="py-2 pr-3">Lane</th>
                  <th className="py-2 pr-3">Role</th>
                  <th className="py-2 pr-3">SLA</th>
                  <th className="py-2 pr-3">InProgressAt</th>
                  <th className="py-2 pr-3">runId</th>
                </tr>
              </thead>
              <tbody>
                {tasks
                  .slice()
                  .sort((a, b) => String(b.inProgressAt || '').localeCompare(String(a.inProgressAt || '')))
                  .map((t) => (
                    <tr key={t.taskId} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium">
                        <Link to={`/task/${encodeURIComponent(t.taskId)}`} className="hover:underline hover:text-blue-600">
                          {t.title} <span className="text-slate-500">{t.taskId}</span>
                        </Link>
                      </td>
                      <td className="py-2 pr-3">
                        <span className={clsx('rounded border px-2 py-0.5 text-xs', pill(t.state === 'Failed' || t.state === 'Review' ? 'warn' : t.state === 'Done' ? 'ok' : 'info'))}>
                          {t.state}
                        </span>
                      </td>
                      <td className="py-2 pr-3">{t.lane || 'execution'}</td>
                      <td className="py-2 pr-3">{t.roleHint || '-'}</td>
                      <td className="py-2 pr-3">{t.slaMinutes || 60}m</td>
                      <td className="py-2 pr-3 text-slate-600">{t.inProgressAt || '-'}</td>
                      <td className="py-2 pr-3 font-mono text-xs text-slate-600">{t.lastDispatch?.runId || '-'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold">Recent Events (tail)</div>
            <div className="text-xs text-slate-500">audit trail • last {eventsQ.data?.events.length ?? 0}</div>
          </div>

          <div className="space-y-2">
            {(eventsQ.data?.events || []).slice().reverse().slice(0, 60).map((e) => {
              const p = e.payload || {};
              const taskId = p.taskId || '';
              const runId = p.runId || '';
              return (
                <div key={e.id} className="flex items-start justify-between gap-3 rounded-lg border bg-slate-50 p-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-mono text-slate-700">{e.timestamp}</div>
                    <div className="mt-0.5">
                      <span className="rounded border bg-white px-2 py-0.5 font-semibold">{e.type}</span>
                      {taskId ? <span className="ml-2 font-mono text-slate-700">{taskId}</span> : null}
                      {runId ? <span className="ml-2 font-mono text-slate-500">runId={runId}</span> : null}
                    </div>
                  </div>
                  <div className="max-w-[50%] truncate font-mono text-slate-500">{e.agent || ''}</div>
                </div>
              );
            })}
          </div>
        </section>

        <footer className="pb-6 text-center text-xs text-slate-500">
          <div className="flex items-center justify-center gap-2">
            <Database className="h-4 w-4" />
            <span>Read-only dashboard. No control-plane actions.</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
