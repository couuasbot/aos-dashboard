import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Play,
  History,
  Gauge,
  FileText,
  GitBranch,
  ArrowRight
} from 'lucide-react';
import clsx from 'clsx';

type TaskState = 'Inbox' | 'Ready' | 'In Progress' | 'Review' | 'Failed' | 'Done';
type Lane = 'execution' | 'ops';

type Task = {
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

type TaskEvent = {
  id: string;
  timestamp: string;
  type: string;
  agent?: string;
  payload?: any;
};

type DispatchEntry = {
  runId: string | null;
  role: string | null;
  at: string;
  cycleTimeMin: number | null;
  outcome: 'done' | 'failed' | 'unknown' | 'pending';
};

type TaskMetrics = {
  attemptCount: number;
  avgCycleTimeMin: number | null;
  currentAgeMin: number | null;
  lastRunId: string | null;
  lastDispatchAt: string | null;
  resultPath: string | null;
  lastError: any;
};

type TaskDetailData = {
  task: Task;
  taskId: string;
  events: TaskEvent[];
  dispatchHistory: DispatchEntry[];
  metrics: TaskMetrics;
};

type TaskSummary = {
  taskId: string;
  runId: string;
  summary: string | null;
  result: {
    taskId: string;
    runId: string;
    status: string;
    summary: string;
    outputs: string[];
    error: { message: string; stack: string } | null;
  } | null;
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

function pill(tone: 'ok' | 'warn' | 'info') {
  return tone === 'ok'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
    : tone === 'warn'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-slate-200 bg-slate-50 text-slate-700';
}

// State Transition Diagram Component
type StateTransitionDiagramProps = {
  events: TaskEvent[];
  currentState: TaskState;
  dispatchHistory: DispatchEntry[];
};

function StateTransitionDiagram({ events, currentState, dispatchHistory }: StateTransitionDiagramProps) {
  // Calculate time spent in each state from events
  const stateTimes = useMemo(() => {
    const times: Record<string, number> = { 'Inbox': 0, 'Ready': 0, 'In Progress': 0, 'Review': 0 };
    const sortedEvents = [...events].sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    let lastState: string | null = null;
    let lastTime: number | null = null;

    for (const e of sortedEvents) {
      if (e.type === 'TASK_STATE' || e.type === 'TASK_CREATE') {
        const newState = e.payload?.state || (e.type === 'TASK_CREATE' ? 'Inbox' : null);
        if (lastState && lastTime) {
          const currentTime = new Date(e.timestamp).getTime();
          const duration = currentTime - lastTime;
          if (lastState in times) {
            times[lastState] += duration;
          }
        }
        if (newState) {
          lastState = newState;
          lastTime = new Date(e.timestamp).getTime();
        }
      }
    }

    // Add time to current state if still in progress
    if (lastState && lastTime) {
      const now = Date.now();
      if (lastState in times) {
        times[lastState] += now - lastTime;
      }
    }

    return times;
  }, [events]);

  // Format duration in minutes/hours
  const formatDuration = (ms: number) => {
    if (ms < 60000) return '<1m';
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
  };

  // Determine which states have been visited
  const visitedStates = useMemo(() => {
    const visited = new Set<string>();
    for (const e of events) {
      if (e.type === 'TASK_STATE' || e.type === 'TASK_CREATE') {
        const state = e.payload?.state || (e.type === 'TASK_CREATE' ? 'Inbox' : null);
        if (state) visited.add(state);
      }
    }
    if (currentState) visited.add(currentState);
    return visited;
  }, [events, currentState]);

  // States to show in the diagram
  const states = [
    { id: 'Ready', label: 'Ready', icon: Clock, color: 'slate' },
    { id: 'In Progress', label: 'In Progress', icon: Play, color: 'blue' },
    { id: 'Done', label: 'Done', icon: CheckCircle2, color: 'emerald' },
    { id: 'Failed', label: 'Failed', icon: XCircle, color: 'red' }
  ];

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
        <GitBranch className="h-4 w-4" />
        State Transition
      </div>

      {/* SVG Flow Diagram */}
      <div className="mb-4 overflow-x-auto">
        <svg width="600" height="80" className="mx-auto">
          {/* Flow lines */}
          <defs>
            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
            </marker>
          </defs>

          {/* Ready → In Progress */}
          <line x1="80" y1="40" x2="160" y2="40" stroke={visitedStates.has('Ready') && visitedStates.has('In Progress') ? '#3b82f6' : '#e2e8f0'} strokeWidth="2" markerEnd="url(#arrowhead)" />
          
          {/* In Progress → Done */}
          <line x1="260" y1="40" x2="340" y2="40" stroke={currentState === 'Done' || (visitedStates.has('Done')) ? '#10b981' : '#e2e8f0'} strokeWidth="2" markerEnd="url(#arrowhead)" />
          
          {/* In Progress → Failed (branch) */}
          <path d="M 210 40 Q 230 40 230 60 Q 230 80 280 80" stroke={currentState === 'Failed' || visitedStates.has('Failed') ? '#ef4444' : '#e2e8f0'} strokeWidth="2" fill="none" markerEnd="url(#arrowhead)" />

          {/* State nodes */}
          {/* Ready */}
          <g transform="translate(30, 25)">
            <rect width="50" height="30" rx="6" fill={visitedStates.has('Ready') ? '#f1f5f9' : '#f8fafc'} stroke={currentState === 'Ready' ? '#3b82f6' : '#cbd5e1'} strokeWidth="2" />
            <text x="25" y="20" textAnchor="middle" fontSize="10" fill="#475569">Ready</text>
          </g>

          {/* In Progress */}
          <g transform="translate(170, 25)">
            <rect width="80" height="30" rx="6" fill={visitedStates.has('In Progress') ? '#eff6ff' : '#f8fafc'} stroke={currentState === 'In Progress' ? '#3b82f6' : '#cbd5e1'} strokeWidth="2" />
            <text x="40" y="20" textAnchor="middle" fontSize="10" fill="#1e40af">In Progress</text>
          </g>

          {/* Done */}
          <g transform="translate(350, 25)">
            <rect width="50" height="30" rx="6" fill={currentState === 'Done' ? '#d1fae5' : '#f8fafc'} stroke={currentState === 'Done' ? '#10b981' : '#cbd5e1'} strokeWidth="2" />
            <text x="25" y="20" textAnchor="middle" fontSize="10" fill="#065f46">Done</text>
          </g>

          {/* Failed (branch) */}
          <g transform="translate(290, 65)">
            <rect width="50" height="30" rx="6" fill={currentState === 'Failed' ? '#fee2e2' : '#f8fafc'} stroke={currentState === 'Failed' ? '#ef4444' : '#cbd5e1'} strokeWidth="2" />
            <text x="25" y="20" textAnchor="middle" fontSize="10" fill="#991b1b">Failed</text>
          </g>

          {/* Branch label */}
          <text x="245" y="95" textAnchor="middle" fontSize="8" fill="#94a3b8">branch</text>
        </svg>
      </div>

      {/* Time in each state */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {states.map(({ id, label, icon: Icon, color }) => {
          const hasVisited = visitedStates.has(id);
          const isCurrent = currentState === id;
          const timeMs = stateTimes[id] || 0;

          const colorClasses = {
            slate: { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-700' },
            blue: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700' },
            emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700' },
            red: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700' }
          };
          const colors = colorClasses[color as keyof typeof colorClasses];

          return (
            <div
              key={id}
              className={clsx(
                'rounded-lg border p-3 text-center',
                isCurrent ? colors.border : 'border-slate-100',
                hasVisited ? colors.bg : 'bg-slate-25'
              )}
            >
              <div className={clsx('flex justify-center mb-1', isCurrent && colors.text)}>
                <Icon className="h-4 w-4" />
              </div>
              <div className={clsx('text-xs font-medium', hasVisited ? colors.text : 'text-slate-400')}>
                {label}
              </div>
              <div className={clsx('text-sm font-semibold', hasVisited ? 'text-slate-900' : 'text-slate-300')}>
                {hasVisited ? formatDuration(timeMs) : '-'}
              </div>
            </div>
          );
        })}
      </div>

      {/* Dispatch cycles info */}
      {dispatchHistory.length > 0 && (
        <div className="mt-3 pt-3 border-t">
          <div className="text-xs text-slate-500">
            {dispatchHistory.length} dispatch cycle{dispatchHistory.length !== 1 ? 's' : ''} • Current: <span className={currentState === 'Done' ? 'text-emerald-600' : currentState === 'Failed' ? 'text-red-600' : 'text-amber-600'}>{currentState}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(iso: string | null | undefined) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function TaskDetail() {
  const { taskId } = useParams<{ taskId: string }>();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  
  const taskQ = useApi<TaskDetailData>(`/api/task/${encodeURIComponent(taskId || '')}`);
  
  const data = taskQ.data;
  const task = data?.task;
  const events = data?.events || [];
  const dispatchHistory = data?.dispatchHistory || [];
  const metrics = data?.metrics;

  // Auto-select the latest runId if none selected
  const effectiveRunId = selectedRunId || metrics?.lastRunId;
  
  // Fetch summary for the selected run
  const summaryQ = useApi<TaskSummary>(
    effectiveRunId 
      ? `/api/task/${encodeURIComponent(taskId || '')}/run/${encodeURIComponent(effectiveRunId)}/summary`
      : '/api/task/-/run/-/summary', // dummy path, will 404 but won't break
    { enabled: !!effectiveRunId }
  );

  const stateTone = !task 
    ? 'info'
    : task.state === 'Done' ? 'ok'
    : task.state === 'Failed' ? 'warn'
    : task.state === 'In Progress' ? 'warn'
    : 'info';

  // Timeline events sorted by timestamp
  const timelineEvents = useMemo(() => {
    return [...events].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [events]);

  if (taskQ.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (taskQ.error || !task) {
    return (
      <div className="min-h-screen p-6">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 mb-6">
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-red-600 mb-2" />
          <div className="text-red-900 font-medium">Task Not Found</div>
          <div className="text-red-700 text-sm mt-1">{taskId}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-5xl px-4 py-4">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-slate-500 hover:text-slate-700">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <div className="text-lg font-semibold">{task.title}</div>
                <span className={clsx('rounded border px-2 py-0.5 text-xs', pill(stateTone))}>
                  {task.state}
                </span>
              </div>
              <div className="text-sm text-slate-600 mt-0.5">
                <span className="font-mono">{task.taskId}</span>
                <span className="mx-2">•</span>
                <span>{task.lane || 'execution'}</span>
                <span className="mx-2">•</span>
                <span>{task.roleHint || 'unknown role'}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl gap-6 px-4 py-6 grid">
        {/* Key Metrics */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500 mb-1">
              <Play className="h-3 w-3" />
              Attempts
            </div>
            <div className="text-2xl font-semibold">{metrics?.attemptCount ?? 0}</div>
          </div>
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500 mb-1">
              <Clock className="h-3 w-3" />
              Avg Cycle Time
            </div>
            <div className="text-2xl font-semibold">
              {metrics?.avgCycleTimeMin !== null ? `${metrics.avgCycleTimeMin}m` : '-'}
            </div>
          </div>
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500 mb-1">
              <Gauge className="h-3 w-3" />
              Current Age
            </div>
            <div className="text-2xl font-semibold">
              {metrics?.currentAgeMin !== null ? `${metrics.currentAgeMin}m` : '-'}
            </div>
          </div>
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500 mb-1">
              <History className="h-3 w-3" />
              Last runId
            </div>
            <div className="text-sm font-mono truncate" title={metrics?.lastRunId || '-'}>
              {metrics?.lastRunId || '-'}
            </div>
          </div>
        </section>

        {/* State Transition Diagram */}
        <StateTransitionDiagram
          events={events}
          currentState={task.state}
          dispatchHistory={dispatchHistory}
        />

        {/* Dispatch History */}
        <section className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm font-semibold">Dispatch History</div>
            <div className="text-xs text-slate-500">
              {dispatchHistory.length} dispatch{dispatchHistory.length !== 1 ? 'es' : ''}
            </div>
          </div>
          
          {dispatchHistory.length === 0 ? (
            <div className="text-sm text-slate-600">No dispatches yet.</div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">#</th>
                    <th className="py-2 pr-3">runId</th>
                    <th className="py-2 pr-3">Role</th>
                    <th className="py-2 pr-3">Dispatched</th>
                    <th className="py-2 pr-3">Cycle Time</th>
                    <th className="py-2 pr-3">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {dispatchHistory.map((dispatch, idx) => (
                    <tr key={dispatch.runId || idx} className="border-b last:border-0">
                      <td className="py-2 pr-3 text-slate-500">{idx + 1}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{dispatch.runId || '-'}</td>
                      <td className="py-2 pr-3">{dispatch.role || '-'}</td>
                      <td className="py-2 pr-3 text-slate-600">{formatDate(dispatch.at)}</td>
                      <td className="py-2 pr-3">
                        {dispatch.cycleTimeMin !== null ? `${dispatch.cycleTimeMin}m` : '-'}
                      </td>
                      <td className="py-2 pr-3">
                        {dispatch.outcome === 'done' && (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            <CheckCircle2 className="h-4 w-4" /> Done
                          </span>
                        )}
                        {dispatch.outcome === 'failed' && (
                          <span className="inline-flex items-center gap-1 text-red-700">
                            <XCircle className="h-4 w-4" /> Failed
                          </span>
                        )}
                        {dispatch.outcome === 'pending' && (
                          <span className="inline-flex items-center gap-1 text-amber-700">
                            <Loader2 className="h-4 w-4 animate-spin" /> In Progress
                          </span>
                        )}
                        {dispatch.outcome === 'unknown' && (
                          <span className="inline-flex items-center gap-1 text-slate-700">
                            <AlertCircle className="h-4 w-4" /> Unknown
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Run Summary */}
        {effectiveRunId && (
          <section className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <FileText className="h-4 w-4" />
                Run Summary
              </div>
              <div className="flex items-center gap-2">
                {dispatchHistory.length > 1 && (
                  <select
                    value={selectedRunId || metrics?.lastRunId || ''}
                    onChange={(e) => setSelectedRunId(e.target.value || null)}
                    className="text-xs border rounded px-2 py-1 bg-white"
                  >
                    {dispatchHistory.map((d) => (
                      <option key={d.runId} value={d.runId || ''}>
                        {d.runId || 'Unknown'} ({formatDate(d.at)})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            
            {summaryQ.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading summary...
              </div>
            ) : summaryQ.error ? (
              <div className="text-sm text-slate-600">No summary available for this run.</div>
            ) : summaryQ.data?.summary ? (
              <div className="prose prose-sm max-w-none">
                <div className="text-sm text-slate-700 whitespace-pre-wrap">{summaryQ.data.summary}</div>
                {summaryQ.data.result?.status && (
                  <div className="mt-3 pt-3 border-t">
                    <span className={clsx(
                      'inline-flex items-center gap-1 text-xs px-2 py-1 rounded',
                      summaryQ.data.result.status === 'success' 
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-red-100 text-red-800'
                    )}>
                      {summaryQ.data.result.status === 'success' 
                        ? <CheckCircle2 className="h-3 w-3" />
                        : <XCircle className="h-3 w-3" />
                      }
                      {summaryQ.data.result.status}
                    </span>
                  </div>
                )}
              </div>
            ) : summaryQ.data?.result ? (
              <div className="text-sm">
                <div className="text-slate-600 mb-2">{summaryQ.data.result.summary}</div>
                <span className={clsx(
                  'inline-flex items-center gap-1 text-xs px-2 py-1 rounded',
                  summaryQ.data.result.status === 'success' 
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-red-100 text-red-800'
                )}>
                  {summaryQ.data.result.status === 'success' 
                    ? <CheckCircle2 className="h-3 w-3" />
                    : <XCircle className="h-3 w-3" />
                  }
                  {summaryQ.data.result.status}
                </span>
              </div>
            ) : (
              <div className="text-sm text-slate-600">No summary available for this run.</div>
            )}
          </section>
        )}

        {/* Task Details */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="mb-3 text-sm font-semibold">Details</div>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">SLA</dt>
                <dd className="font-medium">{task.slaMinutes || 60}m</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Priority</dt>
                <dd className="font-medium">{task.priority || 'P1'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Artifacts Dir</dt>
                <dd className="font-mono text-xs truncate max-w-[200px]">{task.artifactsDir || '-'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Result Path</dt>
                <dd className="font-mono text-xs truncate max-w-[200px]">{task.resultPath || '-'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Created</dt>
                <dd className="text-slate-700">{formatDate(task.createdAt || null)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Updated</dt>
                <dd className="text-slate-700">{formatDate(task.updatedAt || null)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">In Progress At</dt>
                <dd className="text-slate-700">{formatDate(task.inProgressAt || null)}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="mb-3 text-sm font-semibold">Last Error</div>
            {metrics?.lastError ? (
              <pre className="text-xs bg-slate-50 p-3 rounded-lg overflow-auto max-h-48 font-mono">
                {typeof metrics.lastError === 'string' 
                  ? metrics.lastError 
                  : JSON.stringify(metrics.lastError, null, 2)}
              </pre>
            ) : (
              <div className="text-sm text-slate-600">No errors</div>
            )}
          </div>
        </section>

        {/* Timeline */}
        <section className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm font-semibold">Timeline</div>
            <div className="text-xs text-slate-500">
              {timelineEvents.length} events
            </div>
          </div>
          
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-3 top-0 bottom-0 w-px bg-slate-200" />
            
            <div className="space-y-4">
              {timelineEvents.map((e, idx) => {
                const p = e.payload || {};
                const isDispatch = e.type === 'DISPATCH';
                const isComplete = e.type === 'TASK_COMPLETE';
                const isState = e.type === 'TASK_STATE';
                
                return (
                  <div key={e.id || idx} className="relative flex gap-3 pl-8">
                    {/* Timeline dot */}
                    <div className={clsx(
                      'absolute left-1.5 w-3 h-3 rounded-full border-2 bg-white z-10',
                      isDispatch ? 'border-blue-500' :
                      isComplete ? 'border-emerald-500' :
                      isState ? 'border-amber-500' :
                      'border-slate-300'
                    )} />
                    
                    <div className="flex-1 rounded-lg border bg-slate-50 p-3 text-sm">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium">{e.type}</span>
                        <span className="text-xs text-slate-500">{formatTime(e.timestamp)}</span>
                      </div>
                      <div className="text-xs text-slate-600 font-mono">
                        {p.runId && <span className="mr-2">runId={p.runId}</span>}
                        {p.state && <span className="mr-2">state={p.state}</span>}
                        {p.role && <span className="mr-2">role={p.role}</span>}
                        {p.status && <span className="mr-2">status={p.status}</span>}
                        {p.error && <span className="text-red-600">error</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <footer className="pb-6 text-center text-xs text-slate-500">
          <div className="flex items-center justify-center gap-2">
            <span>Read-only task drill-down. No mutations.</span>
          </div>
        </footer>
      </main>
    </div>
  );
}