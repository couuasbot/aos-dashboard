// Export utilities for AOS Dashboard
// Provides CSV and JSON download functions for tasks, metrics, and collab data

/**
 * Convert object array to CSV string
 */
export function toCSV<T>(data: T[], columns: (keyof T)[]): string {
  if (data.length === 0) return '';
  
  const header = columns.map(col => String(col)).join(',');
  const rows = data.map(row => 
    columns.map(col => {
      const val = row[col];
      if (val === null || val === undefined) return '';
      const str = String(val);
      // Escape quotes and wrap in quotes if contains comma, quote, or newline
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(',')
  );
  
  return [header, ...rows].join('\n');
}

/**
 * Download data as JSON file
 */
export function downloadJSON(data: unknown, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Download data as CSV file
 */
export function downloadCSV(data: string, filename: string): void {
  const blob = new Blob([data], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Task export columns
export const taskColumns: (keyof import('./App').Task)[] = [
  'taskId', 'title', 'state', 'lane', 'roleHint', 'slaMinutes', 'inProgressAt'
];

// Metrics doesn't have array data directly, but we can export breakdown tables

// Collab export - roles array
export const collabRoleColumns: (keyof import('./App')['collab']['roles'][0])[] = [
  'role'
];

// Helper to extract current and recent metrics for collab roles
export interface CollabRoleExport {
  role: string;
  current_ready: number;
  current_inProgress: number;
  current_review: number;
  current_failed: number;
  current_done: number;
  recent_dispatched: number;
  recent_completedDone: number;
  recent_completedFailed: number;
  recent_avgCycleTimeMin: number | null;
}

export function transformCollabRoles(roles: import('./App')['collab']['roles']): CollabRoleExport[] {
  return roles.map(r => ({
    role: r.role,
    current_ready: r.current.ready,
    current_inProgress: r.current.inProgress,
    current_review: r.current.review,
    current_failed: r.current.failed,
    current_done: r.current.done,
    recent_dispatched: r.recent.dispatched,
    recent_completedDone: r.recent.completedDone,
    recent_completedFailed: r.recent.completedFailed,
    recent_avgCycleTimeMin: r.recent.avgCycleTimeMin
  }));
}

export const collabRoleExportColumns: (keyof CollabRoleExport)[] = [
  'role',
  'current_ready',
  'current_inProgress', 
  'current_review',
  'current_failed',
  'current_done',
  'recent_dispatched',
  'recent_completedDone',
  'recent_completedFailed',
  'recent_avgCycleTimeMin'
];