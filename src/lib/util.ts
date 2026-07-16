import type { Provider, UsageSnapshot } from "../types.js";

export function clampPercent(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
}

export function emptyUsage(provider: Provider, error: string, extra: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return { provider, windows: [], updatedAt: 0, error, ...extra };
}
