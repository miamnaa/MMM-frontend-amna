/**
 * Small per-dataset UI preferences (slider thresholds, toggle states) that
 * should survive closing and reopening the browser - unlike TunnelService,
 * which is deliberately in-memory only and resets on a fresh tab. Scoped
 * by datasetId since a threshold that makes sense for a 5-channel dataset
 * doesn't for a 20-channel one, and different datasets shouldn't bleed
 * into each other's saved values.
 *
 * Best-effort by design: a private/incognito window or a browser with
 * storage disabled just means the setting doesn't persist, not a broken
 * page - every read/write is wrapped so that failure is silent.
 */

function prefKey(datasetId: string, key: string): string {
  return `pref:${datasetId}:${key}`;
}

export function getLocalPref<T>(datasetId: string, key: string, fallback: T): T {
  if (!datasetId) return fallback;
  try {
    const raw = localStorage.getItem(prefKey(datasetId, key));
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setLocalPref<T>(datasetId: string, key: string, value: T): void {
  if (!datasetId) return;
  try {
    localStorage.setItem(prefKey(datasetId, key), JSON.stringify(value));
  } catch {
    // Storage full/unavailable - the UI keeps working, it just won't remember this.
  }
}
