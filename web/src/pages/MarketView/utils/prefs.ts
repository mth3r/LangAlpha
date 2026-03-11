// --- localStorage persistence helpers (shared across MarketView components) ---
const STORAGE_PREFIX = 'market-chart:';

export function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw !== null ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

export function savePref(key: string, value: unknown): void {
  try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); } catch { /* noop */ }
}
