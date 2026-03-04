/**
 * Client-side settings persistence using localStorage
 * Handles: workspaceRoot, theme, refreshInterval
 */

// Settings keys
const STORAGE_KEYS = {
  WORKSPACE_ROOT: 'aos-dashboard-workspace-root',
  THEME: 'aos-dashboard-theme',
  REFRESH_INTERVAL: 'aos-dashboard-refresh-interval',
} as const;

// Default values
const DEFAULTS = {
  REFRESH_INTERVAL: 5000, // 5 seconds
  THEME: 'light' as 'light' | 'dark',
};

// Type for settings
export type DashboardSettings = {
  workspaceRoot: string | null;
  theme: 'light' | 'dark';
  refreshInterval: number;
};

export type SettingsKey = keyof DashboardSettings;

// Get a setting from localStorage
export function getSetting<K extends SettingsKey>(key: K): DashboardSettings[K] {
  if (typeof window === 'undefined') return DEFAULTS[key as keyof typeof DEFAULTS] as DashboardSettings[K];
  
  switch (key) {
    case 'workspaceRoot':
      return localStorage.getItem(STORAGE_KEYS.WORKSPACE_ROOT) as DashboardSettings[K] | null;
    case 'theme': {
      const stored = localStorage.getItem(STORAGE_KEYS.THEME);
      return (stored === 'dark' || stored === 'light' ? stored : DEFAULTS.THEME) as DashboardSettings[K];
    }
    case 'refreshInterval': {
      const stored = localStorage.getItem(STORAGE_KEYS.REFRESH_INTERVAL);
      const parsed = stored ? parseInt(stored, 10) : null;
      return (parsed && parsed > 0 ? parsed : DEFAULTS.REFRESH_INTERVAL) as DashboardSettings[K];
    }
  }
}

// Set a setting in localStorage
export function setSetting<K extends SettingsKey>(key: K, value: DashboardSettings[K]): void {
  if (typeof window === 'undefined') return;
  
  switch (key) {
    case 'workspaceRoot':
      if (value === null || value === '') {
        localStorage.removeItem(STORAGE_KEYS.WORKSPACE_ROOT);
      } else {
        localStorage.setItem(STORAGE_KEYS.WORKSPACE_ROOT, String(value));
      }
      break;
    case 'theme':
      localStorage.setItem(STORAGE_KEYS.THEME, value);
      break;
    case 'refreshInterval':
      localStorage.setItem(STORAGE_KEYS.REFRESH_INTERVAL, String(value));
      break;
  }
}

// Get all settings
export function getAllSettings(): DashboardSettings {
  return {
    workspaceRoot: getSetting('workspaceRoot'),
    theme: getSetting('theme'),
    refreshInterval: getSetting('refreshInterval'),
  };
}

// Apply theme to document
export function applyTheme(theme: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return;
  
  const root = document.documentElement;
  
  if (theme === 'dark') {
    root.classList.add('dark');
    root.style.colorScheme = 'dark';
  } else {
    root.classList.remove('dark');
    root.style.colorScheme = 'light';
  }
}

// Theme toggle helper
export function toggleTheme(): 'light' | 'dark' {
  const current = getSetting('theme');
  const next = current === 'light' ? 'dark' : 'light';
  setSetting('theme', next);
  applyTheme(next);
  return next;
}

// Common refresh interval options (in milliseconds)
export const REFRESH_OPTIONS = [
  { label: '3s', value: 3000 },
  { label: '5s', value: 5000 },
  { label: '10s', value: 10000 },
  { label: '30s', value: 30000 },
  { label: '60s', value: 60000 },
  { label: 'Off', value: 0 },
] as const;