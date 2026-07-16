import { ClaudeCollector } from "./collectors/claude.js";
import { CodexCollector } from "./collectors/codex.js";
import { OpenCodeCollector } from "./collectors/opencode.js";
import { configDir, loadConfig, type DeckConfig } from "./config.js";
import { StateStore } from "./state.js";
import type { DashboardSnapshot, Provider, ProviderSnapshot, SessionSnapshot, UsageSnapshot } from "./types.js";

interface CollectorResult {
  sessions: SessionSnapshot[];
  usage: UsageSnapshot;
}

export class Dashboard {
  readonly config: DeckConfig;
  readonly state: StateStore;
  private readonly claude = new ClaudeCollector();
  private readonly codex = new CodexCollector();
  private readonly opencode = new OpenCodeCollector();
  private snapshot: DashboardSnapshot | null = null;

  constructor() {
    const dir = configDir();
    this.config = loadConfig(dir);
    const restingIndex = this.config.infoBar.indexOf(this.config.restingPage);
    this.state = new StateStore(dir, this.config.infoBar.length, restingIndex);
  }

  async collect(forceUsage = false): Promise<DashboardSnapshot> {
    const [claude, codex, opencode] = await Promise.all([
      this.claude.collect(this.state.data, forceUsage),
      this.codex.collect(this.state.data),
      this.opencode.collect(this.state.data)
    ]);
    const providers: Record<Provider, ProviderSnapshot> = {
      claude: summarizeProvider("claude", claude),
      codex: summarizeProvider("codex", codex),
      opencode: summarizeProvider("opencode", opencode)
    };
    const all = Object.values(providers).flatMap((provider) => provider.sessions);
    this.snapshot = {
      providers,
      openCount: all.filter((session) => session.isOpen).length,
      workingCount: all.filter((session) => session.state === "working").length,
      attentionCount: all.filter((session) => session.state === "attention").length,
      updatedAt: Date.now()
    };
    return this.snapshot;
  }

  current(): DashboardSnapshot {
    if (!this.snapshot) throw new Error("Dashboard has not been collected yet");
    return this.snapshot;
  }

  acknowledgeProvider(provider: Provider): void {
    const sessions = this.current().providers[provider].sessions.filter((session) => session.state === "attention");
    this.state.acknowledgeMany(sessions);
  }
}

export function summarizeProvider(provider: Provider, result: CollectorResult): ProviderSnapshot {
  const workingCount = result.sessions.filter((session) => session.state === "working").length;
  const attentionCount = result.sessions.filter((session) => session.state === "attention").length;
  return {
    provider,
    state: attentionCount > 0 ? "attention" : workingCount > 0 ? "working" : "idle",
    sessions: result.sessions,
    usage: result.usage,
    openCount: result.sessions.filter((session) => session.isOpen).length,
    workingCount,
    attentionCount,
    idleCount: result.sessions.filter((session) => session.state === "idle").length
  };
}
