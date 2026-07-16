import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Dashboard, summarizeProvider } from "../src/dashboard.js";
import { inferOpenCodeState, type OpenCodeSessionRow } from "../src/collectors/opencode.js";
import { StateStore } from "../src/state.js";
import type { Provider, SessionSnapshot, UsageSnapshot } from "../src/types.js";

const usage: UsageSnapshot = { provider: "codex", windows: [], updatedAt: 1, error: null };
const session = (id: string, state: SessionSnapshot["state"], isOpen: boolean): SessionSnapshot => ({
  key: `codex:${id}`,
  id,
  provider: "codex",
  state,
  isOpen,
  activityAt: 1,
  completionAt: state === "attention" ? 1 : 0
});

describe("provider aggregation", () => {
  it("prioritizes attention and counts only genuinely open sessions", () => {
    const result = summarizeProvider("codex", {
      sessions: [session("working", "working", true), session("attention", "attention", true), session("history", "idle", false)],
      usage
    });
    expect(result.state).toBe("attention");
    expect(result.openCount).toBe(2);
    expect(result.workingCount).toBe(1);
    expect(result.attentionCount).toBe(1);
  });
});

describe("dashboard", () => {
  const previousHome = process.env.NEO_AGENT_DECK_HOME;
  let directory: string | null = null;

  afterEach(() => {
    if (previousHome === undefined) delete process.env.NEO_AGENT_DECK_HOME;
    else process.env.NEO_AGENT_DECK_HOME = previousHome;
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
    directory = null;
  });

  function makeDashboard(): Dashboard {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "neo-agent-deck-dash-"));
    process.env.NEO_AGENT_DECK_HOME = directory;
    return new Dashboard();
  }

  function stubCollector(dashboard: Dashboard, provider: Provider, sessions: SessionSnapshot[]): void {
    const result = { sessions, usage: { provider, windows: [], updatedAt: 1, error: null } };
    (dashboard as unknown as Record<Provider, { collect: () => Promise<typeof result> }>)[provider] = {
      collect: async () => result
    };
  }

  const stub = (provider: Provider, id: string, state: SessionSnapshot["state"], isOpen: boolean, completionAt = 0): SessionSnapshot => ({
    key: `${provider}:${id}`,
    id,
    provider,
    state,
    isOpen,
    activityAt: completionAt || 1,
    completionAt
  });

  it("aggregates open, working, and attention counts across all providers", async () => {
    const dashboard = makeDashboard();
    stubCollector(dashboard, "claude", [stub("claude", "a", "working", true), stub("claude", "b", "idle", true)]);
    stubCollector(dashboard, "codex", [stub("codex", "c", "attention", true, 5), stub("codex", "d", "idle", false)]);
    stubCollector(dashboard, "opencode", [stub("opencode", "e", "working", true), stub("opencode", "f", "attention", true, 5)]);

    const snapshot = await dashboard.collect();
    expect(snapshot.openCount).toBe(5);
    expect(snapshot.workingCount).toBe(2);
    expect(snapshot.attentionCount).toBe(2);
    expect(snapshot.providers.claude.state).toBe("working");
    expect(snapshot.providers.codex.state).toBe("attention");
    expect(snapshot.providers.opencode.state).toBe("attention");
    expect(dashboard.current()).toBe(snapshot);
  });

  it("persists provider acknowledgements so a fresh process sees the session as idle", async () => {
    const dashboard = makeDashboard();
    const completionAt = Date.now() + 60_000;
    stubCollector(dashboard, "claude", []);
    stubCollector(dashboard, "codex", []);
    stubCollector(dashboard, "opencode", [
      stub("opencode", "sess-att", "attention", true, completionAt),
      stub("opencode", "sess-idle", "idle", false)
    ]);
    await dashboard.collect();

    dashboard.acknowledgeProvider("opencode");
    expect(dashboard.state.data.acknowledged["opencode:sess-att"]).toBe(completionAt);
    expect("opencode:sess-idle" in dashboard.state.data.acknowledged).toBe(false);

    const reloaded = new StateStore(directory!, 4, 3);
    expect(reloaded.data.acknowledged["opencode:sess-att"]).toBe(completionAt);

    const row: OpenCodeSessionRow = {
      id: "sess-att",
      title: "Acked session",
      time_updated: completionAt,
      time_archived: null,
      role: "assistant",
      finish: "stop",
      error_type: null,
      message_at: completionAt
    };
    const later = completionAt + 20 * 60_000;
    expect(inferOpenCodeState(row, { ...reloaded.data, acknowledged: {} }, later).state).toBe("attention");
    expect(inferOpenCodeState(row, reloaded.data, later)).toEqual({ state: "idle", completionAt: 0 });
  });
});
