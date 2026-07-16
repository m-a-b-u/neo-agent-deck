export type Provider = "claude" | "codex" | "opencode";
export type SessionState = "working" | "idle" | "attention";

export interface SessionSnapshot {
  key: string;
  id: string;
  provider: Provider;
  state: SessionState;
  isOpen: boolean;
  activityAt: number;
  completionAt: number;
}

export interface UsageWindow {
  label: string;
  percent?: number;
  value?: number;
  unit?: "tokens" | "usd";
  resetsAt: number | null;
}

export interface UsageSnapshot {
  provider: Provider;
  windows: UsageWindow[];
  costUsd?: number;
  updatedAt: number;
  error: string | null;
}

export interface ProviderSnapshot {
  provider: Provider;
  state: SessionState;
  sessions: SessionSnapshot[];
  usage: UsageSnapshot;
  openCount: number;
  workingCount: number;
  attentionCount: number;
  idleCount: number;
}

export interface DashboardSnapshot {
  providers: Record<Provider, ProviderSnapshot>;
  openCount: number;
  workingCount: number;
  attentionCount: number;
  updatedAt: number;
}

export interface PersistedState {
  schemaVersion: number;
  installedAt: number;
  attentionSince: number;
  infoPage: number;
  acknowledged: Record<string, number>;
}
