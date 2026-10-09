// Per-device progress. Browser storage can be unavailable (private mode, blocked
// cookies), so every access is guarded and the game works without it.

const KEY = 'one-shot:v1';

export interface Progress {
  /** Highest level index the player may open. */
  unlocked: number;
  /** Fewest tries used to solve each level, by room id. */
  best: Record<string, number>;
  muted: boolean;
}

export function loadProgress(): Progress {
  const fresh: Progress = { unlocked: 0, best: {}, muted: false };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const p = JSON.parse(raw) as Partial<Progress>;
    return { unlocked: p.unlocked ?? 0, best: p.best ?? {}, muted: p.muted ?? false };
  } catch {
    return fresh;
  }
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // storage unavailable: progress lasts for this session only
  }
}
