import { useState, useMemo, useEffect } from 'react';
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
  Download,
  Menu,
  X,
  Settings,
  Sun,
  Moon,
  RotateCw
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
import { getSetting, setSetting, applyTheme, toggleTheme, getAllSettings, REFRESH_OPTIONS } from './settings';

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

// Event filter state
type EventFilters = {
  type: string;
  role: string;
  runId: string;
  search: string;
};

function useApi<T>(path: string, refetchInterval?: number) {
  const interval = refetchInterval ?? getSetting('refreshInterval');
  return useQuery({
    queryKey: [path, interval],
    queryFn: async () => {
      const res = await fetch(path);
      if (!res.ok) throw new Error(await res.text());
      return (await res.json()) as T;
    },
    refetchInterval: interval > 0 ? interval : false
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
    <div className={clsx('rounded-xl border p-3 shadow-sm sm:p-4', toneCls)}>
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide opacity-70">{props.title}</div>
          <div className="mt-1 text-xl font-semibold sm:text-2xl">{props.value}</div>
          {props.subtitle ? <div className="mt-1 text-xs opacity-70 truncate">{props.subtitle}</div> : null}
        </div>
        <div className="rounded-lg bg-white/50 p-1.5 sm:p-2">
          <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  
  // Initialize settings from localStorage on mount
  const [settings, setSettings] = useState(() => getAllSettings());
  
  // Event filters state
  const [eventFilters, setEventFilters] = useState<EventFilters>({
    type: '',
    role: '',
    runId: '',
    search: ''
  });
  
  // Apply theme on mount and when it changes
  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);
  
  // Update API calls to use workspace root from settings if set
  const baseApiUrl = settings.workspaceRoot 
    ? `/api?workspaceRoot=${encodeURIComponent(settings.workspaceRoot)}` 
    : '/api';
  
  const overviewQ = useApi<Overview>(`${baseApiUrl}/overview`, settings.refreshInterval);
  const lanesQ = useApi<{ laneMetrics: LaneMetrics[]; bottleneckAnalysis: BottleneckAnalysis }>(`${baseApiUrl}/lanes`, settings.refreshInterval);

  // Build events API URL with filters
  const eventsApiUrl = useMemo(() => {
    const base = `${baseApiUrl}/events?limit=80`;
    const params = new URLSearchParams();
    if (eventFilters.type) params.set('type', eventFilters.type);
    if (eventFilters.role) params.set('role', eventFilters.role);
    if (eventFilters.runId) params.set('runId', eventFilters.runId);
    if (eventFilters.search) params.set('search', eventFilters.search);
    const queryString = params.toString();
    return queryString ? `${base}&${queryString}` : base;
  }, [baseApiUrl, eventFilters]);
  
  const eventsQ = useApi<{ events: AOSEvent[] }>(eventsApiUrl, settings.refreshInterval);

  const overview = overviewQ.data;
  const tasks = overview?.tasks || [];
  const metrics = overview?.metrics;
  const collab = overview?.collab;
  const lanesData = lanesQ.data;
  const laneMetrics = lanesData?.laneMetrics || [];
  const bottleneckAnalysis = lanesData?.bottleneckAnalysis;

  // Settings handlers
  const handleThemeToggle = () => {
    const newTheme = toggleTheme();
    setSettings(prev => ({ ...prev, theme: newTheme }));
  };

  const handleRefreshChange = (interval: number) => {
    setSetting('refreshInterval', interval);
    setSettings(prev => ({ ...prev, refreshInterval: interval }));
  };

  const handleWorkspaceChange = (root: string) => {
    setSetting('workspaceRoot', root.trim() || null);
    setSettings(prev => ({ ...prev, workspaceRoot: root.trim() || null }));
    // Force refetch by invalidating queries
    overviewQ.refetch();
    eventsQ.refetch();
    lanesQ.refetch();
  };

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

  // Event filter handlers
  const handleEventFilterChange = (key: keyof EventFilters, value: string) => {
    setEventFilters(prev => ({ ...prev, [key]: value }));
  };

  const clearEventFilters = () => {
    setEventFilters({ type: '', role: '', runId: '', search: '' });
  };

  const hasActiveFilters = eventFilters.type || eventFilters.role || eventFilters.runId || eventFilters.search;

  return (
    <div className="min-h-screen">
      {/* Skip link for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-blue-600 focus:text-white focus:px-4 focus:py-2 focus:rounded-lg focus:outline-none"
      >
        Skip to main content
      </a>

      {/* Mobile Header with Hamburger */}
      <header className="border-b bg-white sticky top-0 z-50" role="banner">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-3 py-3 sm:px-4 sm:py-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="rounded-lg border p-2 hover:bg-slate-50 lg:hidden"
              aria-label="Toggle menu"
            >
              {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <div>
              <div className="text-base font-semibold sm:text-lg">AOS Dashboard</div>
              <div className="text-xs text-slate-600 hidden sm:block">
                Read-only • local-first • reliable metrics
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right text-xs text-slate-500">
              <div className="hidden sm:block">
                {settings.refreshInterval > 0 ? `refresh: ${settings.refreshInterval / 1000}s` : 'refresh: off'}
              </div>
              {settings.workspaceRoot ? (
                <div className="mt-1 hidden sm:block truncate max-w-[200px]" title={settings.workspaceRoot}>
                  root: {settings.workspaceRoot}
                </div>
              ) : overview?.workspaceRoot ? (
                <div className="mt-1 hidden sm:block truncate max-w-[200px]" title={overview.workspaceRoot}>
                  root: {overview.workspaceRoot}
                </div>
              ) : null}
            </div>
            <button
              onClick={() => setSettingsOpen(!settingsOpen)}
              className={clsx(
                'rounded-lg border p-2 hover:bg-slate-50',
                settingsOpen ? 'bg-slate-100 border-slate-300' : ''
              )}
              aria-label="Settings"
            >
              <Settings className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Settings Panel */}
      {settingsOpen && (
        <div className="border-b bg-slate-50 px-3 py-3 sm:px-4">
          <div className="mx-auto max-w-6xl space-y-3">
            <div className="text-sm font-semibold">Settings</div>
            <div className="flex flex-wrap items-center gap-4">
              {/* Theme Toggle */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600">Theme:</span>
                <button
                  onClick={handleThemeToggle}
                  className="flex items-center gap-1.5 rounded border bg-white px-2 py-1 text-xs hover:bg-slate-100"
                >
                  {settings.theme === 'dark' ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
                  {settings.theme === 'dark' ? 'Dark' : 'Light'}
                </button>
              </div>
              
              {/* Refresh Interval */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600">Refresh:</span>
                <div className="flex rounded border bg-white overflow-hidden">
                  {REFRESH_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => handleRefreshChange(opt.value)}
                      className={clsx(
                        'px-2 py-1 text-xs hover:bg-slate-100',
                        settings.refreshInterval === opt.value ? 'bg-slate-200 font-medium' : ''
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              
              {/* Workspace Root */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600">Workspace:</span>
                <input
                  type="text"
                  placeholder="Auto-detect"
                  value={settings.workspaceRoot || ''}
                  onChange={(e) => handleWorkspaceChange(e.target.value)}
                  className="w-48 rounded border px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar - Mobile */}
      <div className={clsx(
        'fixed inset-0 z-40 bg-slate-900/50 lg:hidden transition-opacity',
        sidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )}>
        <div className={clsx(
          'fixed left-0 top-0 h-full w-64 bg-white shadow-xl transition-transform duration-300',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}>
          <div className="flex items-center justify-between border-b p-4">
            <span className="font-semibold">Menu</span>
            <button onClick={() => setSidebarOpen(false)} className="p-1">
              <X className="h-5 w-5" />
            </button>
          </div>
          <nav className="p-4 space-y-2">
            <div className="text-xs font-semibold uppercase text-slate-500 mb-2">Export Data</div>
            <button
              onClick={() => { handleExportTasksJSON(); setSidebarOpen(false); }}
              className="flex w-full items-center gap-2 rounded-lg border p-2 text-sm hover:bg-slate-50"
            >
              <Download className="h-4 w-4" /> Tasks JSON
            </button>
            <button
              onClick={() => { handleExportTasksCSV(); setSidebarOpen(false); }}
              className="flex w-full items-center gap-2 rounded-lg border p-2 text-sm hover:bg-slate-50"
            >
              <Download className="h-4 w-4" /> Tasks CSV
            </button>
            <button
              onClick={() => { handleExportMetricsJSON(); setSidebarOpen(false); }}
              className="flex w-full items-center gap-2 rounded-lg border p-2 text-sm hover:bg-slate-50"
            >
              <Download className="h-4 w-4" /> Metrics JSON
            </button>
            <button
              onClick={() => { handleExportCollabJSON(); setSidebarOpen(false); }}
              className="flex w-full items-center gap-2 rounded-lg border p-2 text-sm hover:bg-slate-50"
            >
              <Download className="h-4 w-4" /> Collab JSON
            </button>
            <button
              onClick={() => { handleExportCollabCSV(); setSidebarOpen(false); }}
              className="flex w-full items-center gap-2 rounded-lg border p-2 text-sm hover:bg-slate-50"
            >
              <Download className="h-4 w-4" /> Collab CSV
            </button>
          </nav>
        </div>
      </div>

      {/* Export Controls - Desktop */}
      <div className="bg-slate-50 border-b px-3 py-2 sm:px-4 hidden lg:block">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="text-xs text-slate-500">Export Data:</div>
          <div className="flex items-center gap-2 flex-wrap">
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

      <main id="main-content" className="mx-auto grid max-w-6xl gap-3 px-3 py-4 sm:gap-4 sm:px-4 sm:py-6" role="main" aria-label="Dashboard content">
        {/* Stats Cards - Stack on mobile */}
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-4">
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

        <section className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-4">
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
        <section className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
          {/* Lane Cards */}
          <div className="space-y-3 sm:space-y-4">
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
                      'rounded-xl border p-3 shadow-sm sm:p-4',
                      laneTone === 'warn' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'
                    )}
                  >
                    <div className="flex flex-col gap-2 mb-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-semibold capitalize sm:text-lg">{lm.lane}</span>
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
                    <div className="grid grid-cols-2 gap-2 text-center text-sm sm:grid-cols-4">
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
          <div className="rounded-xl border bg-white p-3 shadow-sm sm:p-4" role="figure" aria-label="Bottleneck Analysis Chart">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
            <div className="h-40 sm:h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={laneMetrics}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="lane" tick={{ fontSize: 10 }} interval={0} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
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

        {/* Charts Section */}
        <section className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
          <div className="rounded-xl border bg-white p-3 shadow-sm sm:p-4" role="figure" aria-label="Tasks by State Chart">
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm font-semibold">Tasks by State</div>
              <div className="text-xs text-slate-500">projected from workflow-events.jsonl</div>
            </div>
            <div className="h-48 sm:h-64" role="img" aria-label="Bar chart showing task counts by state">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                  <YAxis dataKey="state" type="category" tick={{ fontSize: 10 }} width={80} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Bar dataKey="count" fill="#334155" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-xl border bg-white p-3 shadow-sm sm:p-4" role="figure" aria-label="Agent Collaboration Chart">
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm font-semibold">Agent Collaboration (current)</div>
              <div className="text-xs text-slate-500">by roleHint</div>
            </div>
            <div className="h-48 sm:h-64" role="img" aria-label="Stacked bar chart showing agent collaboration by role">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={roleData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                  <YAxis dataKey="role" type="category" tick={{ fontSize: 10 }} width={60} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Bar dataKey="inProgress" stackId="a" fill="#0f172a" name="In Progress" />
                  <Bar dataKey="ready" stackId="a" fill="#64748b" name="Ready" />
                  <Bar dataKey="review" stackId="a" fill="#f59e0b" name="Review" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
          <div className="rounded-xl border bg-white p-3 shadow-sm sm:p-4">
            <div className="mb-3 text-sm font-semibold">SLA Breaches</div>
            {!metrics || metrics.slaBreaches.length === 0 ? (
              <div className="text-sm text-slate-600">No breaches.</div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {metrics.slaBreaches.slice(0, 10).map((b) => (
                  <div
                    key={b.taskId}
                    className="flex flex-col gap-1 rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="font-medium">
                      {b.taskId}{' '}
                      <span className="ml-1 sm:ml-2 rounded border px-1.5 py-0.5 text-xs text-slate-700">
                        {b.lane || 'execution'} / {b.role || 'unknown'}
                      </span>
                    </div>
                    <div className="text-slate-700 text-xs sm:text-sm">
                      {b.ageMin}m / SLA {b.slaMinutes}m
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border bg-white p-3 shadow-sm sm:p-4">
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm font-semibold">Roles (recent {collab?.windowHours ?? 24}h)</div>
              <div className="text-xs text-slate-500">dispatch & cycle time</div>
            </div>
            {!collab ? (
              <div className="text-sm text-slate-600">Loading…</div>
            ) : (
              <div className="overflow-x-auto -mx-3 px-3 sm:-mx-4 sm:px-4">
                <table className="w-full min-w-[600px] text-left text-xs sm:text-sm" role="table" aria-label="Agent roles and metrics">
                  <thead className="border-b text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th scope="col" className="py-2 pr-2">Role</th>
                      <th scope="col" className="py-2 pr-2">InProg</th>
                      <th scope="col" className="py-2 pr-2">Ready</th>
                      <th scope="col" className="py-2 pr-2">Review</th>
                      <th scope="col" className="py-2 pr-2">Dispatched</th>
                      <th scope="col" className="py-2 pr-2">Done</th>
                      <th scope="col" className="py-2 pr-2">Failed</th>
                      <th scope="col" className="py-2 pr-2">Avg Cycle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {collab.roles.map((r) => (
                      <tr key={r.role} className="border-b last:border-0">
                        <td className="py-2 pr-2 font-medium">{r.role}</td>
                        <td className="py-2 pr-2">{r.current.inProgress}</td>
                        <td className="py-2 pr-2">{r.current.ready}</td>
                        <td className="py-2 pr-2">{r.current.review}</td>
                        <td className="py-2 pr-2">{r.recent.dispatched}</td>
                        <td className="py-2 pr-2">{r.recent.completedDone}</td>
                        <td className="py-2 pr-2">{r.recent.completedFailed}</td>
                        <td className="py-2 pr-2 text-slate-600">
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

        <section className="rounded-xl border bg-white p-3 shadow-sm sm:p-4">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm font-semibold">Queue</div>
            <div className="text-xs text-slate-500">
              {overviewQ.isLoading ? 'loading…' : overviewQ.isError ? 'error' : `${tasks.length} tasks`}
            </div>
          </div>

          <div className="overflow-x-auto -mx-3 px-3 sm:-mx-4 sm:px-4">
            <table className="w-full min-w-[700px] text-left text-xs sm:text-sm" role="table" aria-label="Task queue">
              <thead className="border-b text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="py-2 pr-2">Task</th>
                  <th scope="col" className="py-2 pr-2">State</th>
                  <th scope="col" className="py-2 pr-2">Lane</th>
                  <th scope="col" className="py-2 pr-2">Role</th>
                  <th scope="col" className="py-2 pr-2">SLA</th>
                  <th scope="col" className="py-2 pr-2">InProgressAt</th>
                  <th scope="col" className="py-2 pr-2">runId</th>
                </tr>
              </thead>
              <tbody>
                {tasks
                  .slice()
                  .sort((a, b) => String(b.inProgressAt || '').localeCompare(String(a.inProgressAt || '')))
                  .map((t) => (
                    <tr key={t.taskId} className="border-b last:border-0">
                      <td className="py-2 pr-2 font-medium max-w-[150px] sm:max-w-none">
                        <Link to={`/task/${encodeURIComponent(t.taskId)}`} className="hover:underline hover:text-blue-600 truncate block">
                          {t.title} <span className="text-slate-500">{t.taskId}</span>
                        </Link>
                      </td>
                      <td className="py-2 pr-2">
                        <span className={clsx('rounded border px-1.5 py-0.5 text-xs', pill(t.state === 'Failed' || t.state === 'Review' ? 'warn' : t.state === 'Done' ? 'ok' : 'info'))}>
                          {t.state}
                        </span>
                      </td>
                      <td className="py-2 pr-2">{t.lane || 'execution'}</td>
                      <td className="py-2 pr-2">{t.roleHint || '-'}</td>
                      <td className="py-2 pr-2">{t.slaMinutes || 60}m</td>
                      <td className="py-2 pr-2 text-slate-600">{t.inProgressAt || '-'}</td>
                      <td className="py-2 pr-2 font-mono text-xs text-slate-600">{t.lastDispatch?.runId || '-'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border bg-white p-3 shadow-sm sm:p-4">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm font-semibold">Event Timeline</div>
            <div className="text-xs text-slate-500">
              {hasActiveFilters ? 'filtered • ' : 'audit trail • '}
              last {eventsQ.data?.events.length ?? 0}
            </div>
          </div>

          {/* Event Filters */}
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2">
            <div className="flex items-center gap-1">
              <span className="text-xs text-slate-600">Type:</span>
              <input
                type="text"
                placeholder="DISPATCH, TASK_STATE..."
                value={eventFilters.type}
                onChange={(e) => handleEventFilterChange('type', e.target.value)}
                className="w-28 rounded border px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-slate-600">Role:</span>
              <input
                type="text"
                placeholder="cto, god..."
                value={eventFilters.role}
                onChange={(e) => handleEventFilterChange('role', e.target.value)}
                className="w-20 rounded border px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-slate-600">runId:</span>
              <input
                type="text"
                placeholder="run_xxx"
                value={eventFilters.runId}
                onChange={(e) => handleEventFilterChange('runId', e.target.value)}
                className="w-28 rounded border px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-slate-600">Search:</span>
              <input
                type="text"
                placeholder="text in payload..."
                value={eventFilters.search}
                onChange={(e) => handleEventFilterChange('search', e.target.value)}
                className="w-36 rounded border px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {hasActiveFilters && (
              <button
                onClick={clearEventFilters}
                className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100"
              >
                Clear
              </button>
            )}
          </div>

          {eventsQ.isLoading && (
            <div className="py-4 text-center text-sm text-slate-500">Loading events...</div>
          )}

          {eventsQ.isError && (
            <div className="py-4 text-center text-sm text-red-600">Error loading events</div>
          )}

          {!eventsQ.isLoading && (eventsQ.data?.events || []).length === 0 && (
            <div className="py-4 text-center text-sm text-slate-500">No events found</div>
          )}

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {(eventsQ.data?.events || []).slice().reverse().slice(0, 60).map((e) => {
              const p = e.payload || {};
              const taskId = p.taskId || '';
              const runId = p.runId || '';
              return (
                <div key={e.id} className="flex flex-col gap-2 rounded-lg border bg-slate-50 p-2 text-xs sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="font-mono text-slate-700">{e.timestamp}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      <span className="rounded border bg-white px-2 py-0.5 font-semibold">{e.type}</span>
                      {taskId ? <span className="font-mono text-slate-700">{taskId}</span> : null}
                      {runId ? <span className="font-mono text-slate-500">runId={runId}</span> : null}
                    </div>
                  </div>
                  <div className="max-w-[50%] truncate font-mono text-slate-500">{e.agent || ''}</div>
                </div>
              );
            })}
          </div>
        </section>

        <footer className="pb-4 text-center text-xs text-slate-500 sm:pb-6">
          <div className="flex items-center justify-center gap-2">
            <Database className="h-4 w-4" />
            <span>Read-only dashboard. No control-plane actions.</span>
          </div>
        </footer>
      </main>
    </div>
  );
}