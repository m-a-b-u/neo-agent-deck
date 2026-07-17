import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { listJsonl, loadJson, processAlive, readTail, type FileStamp } from "../lib/files.js";
import { readClaudeAccessToken } from "../lib/claude-auth.js";
import { clampPercent, emptyUsage } from "../lib/util.js";
import { claudeProjectsDirectory, claudeSessionsDirectory, wslDistributionFromPath } from "../platform.js";
import type { PersistedState, SessionSnapshot, UsageSnapshot, UsageWindow } from "../types.js";

interface ClaudeSessionFile {
  pid?: number;
  sessionId?: string;
  name?: string;
  cwd?: string;
  status?: string;
  updatedAt?: number;
  statusUpdatedAt?: number;
}

interface ClaudeUsageLimit {
  kind?: string;
  percent?: number;
  resets_at?: string | null;
}

interface ClaudeUsageResponse {
  limits?: ClaudeUsageLimit[];
}

const execFileAsync = promisify(execFile);

export interface ClaudeTail {
  lastUser: number;
  lastEnd: number;
  lastAssistant: number;
  activityAt: number;
}

export class ClaudeCollector {
  private projectFiles: FileStamp[] = [];
  private scannedAt = 0;
  private usage: UsageSnapshot = emptyUsage("claude", "loading");
  private usageFetchedAt = 0;

  constructor(
    private readonly sessionDirectory = claudeSessionsDirectory(),
    private readonly projectDirectory = claudeProjectsDirectory()
  ) {}

  async collect(state: PersistedState, forceUsage = false): Promise<{ sessions: SessionSnapshot[]; usage: UsageSnapshot }> {
    const now = Date.now();
    if (!this.projectFiles.length || now - this.scannedAt > 30_000) {
      this.projectFiles = await listJsonl(this.projectDirectory);
      this.scannedAt = now;
    }
    const [sessions] = await Promise.all([
      this.readSessions(state),
      forceUsage || now - this.usageFetchedAt > 300_000 ? this.readUsage() : Promise.resolve()
    ]);
    return { sessions, usage: this.usage };
  }

  private async readSessions(state: PersistedState): Promise<SessionSnapshot[]> {
    let names: string[] = [];
    try {
      names = (await fs.promises.readdir(this.sessionDirectory)).filter((name) => name.endsWith(".json"));
    } catch {
      return [];
    }

    const projectsBySession = new Map<string, FileStamp>();
    for (const file of this.projectFiles) {
      const id = path.basename(file.path, ".jsonl");
      const existing = projectsBySession.get(id);
      if (!existing || existing.mtimeMs < file.mtimeMs) projectsBySession.set(id, file);
    }

    const sessions: SessionSnapshot[] = [];
    for (const filename of names) {
      const raw = loadJson<ClaudeSessionFile | null>(path.join(this.sessionDirectory, filename), null);
      if (!raw?.sessionId || !await claudeProcessAlive(raw.pid, this.sessionDirectory)) continue;
      const project = projectsBySession.get(raw.sessionId);
      const tail = project ? parseClaudeTail(await readTail(project.path, 768 * 1024), project.mtimeMs) : emptyClaudeTail();
      const status = String(raw.status || "idle").toLowerCase();
      const activityAt = Math.max(raw.updatedAt || 0, tail.activityAt, project?.mtimeMs || 0);
      const key = `claude:${raw.sessionId}`;
      let sessionState: SessionSnapshot["state"] = "idle";
      let completionAt = 0;

      const tailWorking = tail.lastUser > tail.lastEnd && tail.lastUser > tail.lastAssistant && Date.now() - tail.lastUser < 86_400_000;
      const statusAttentionAt = Math.max(raw.statusUpdatedAt || 0, activityAt);
      if (/working|running|busy|processing/.test(status) || tailWorking) {
        sessionState = "working";
      } else if (/attention|waiting|permission|blocked|input/.test(status) && statusAttentionAt > (state.acknowledged[key] || 0)) {
        sessionState = "attention";
        completionAt = statusAttentionAt;
      } else if (tail.lastEnd > state.attentionSince && tail.lastEnd > (state.acknowledged[key] || 0)) {
        sessionState = "attention";
        completionAt = tail.lastEnd;
      }

      sessions.push({
        key,
        id: raw.sessionId,
        provider: "claude",
        state: sessionState,
        isOpen: true,
        activityAt,
        completionAt
      });
    }

    return sessions;
  }

  private async readUsage(): Promise<void> {
    this.usageFetchedAt = Date.now();
    try {
      const { token } = await readClaudeAccessToken();
      const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-beta": "oauth-2025-04-20",
          "user-agent": "neo-agent-deck/0.3.1"
        },
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) throw new Error(`Claude usage HTTP ${response.status}`);
      const body = await response.json() as ClaudeUsageResponse;
      const limits = body.limits || [];
      const session = limits.find((limit) => limit.kind === "session");
      const weekly = limits.find((limit) => limit.kind === "weekly_all");
      this.usage = {
        provider: "claude",
        windows: [toWindow("5h", session), toWindow("7d", weekly)],
        updatedAt: Date.now(),
        error: null
      };
    } catch (error) {
      this.usage = { ...this.usage, updatedAt: Date.now(), error: error instanceof Error ? error.message : String(error) };
    }
  }
}

// ponytail: the WSL liveness probe spawns wsl.exe; cache results briefly so a directory of session
// files does not spawn one probe per file on every 3s poll. Raise the TTL or batch the probes into a
// single wsl.exe call if WSL users still report refresh lag.
const wslAliveCache = new Map<string, { alive: boolean; at: number }>();
const WSL_ALIVE_TTL_MS = 8_000;

async function claudeProcessAlive(pid: unknown, sessionDirectory: string): Promise<boolean> {
  if (!Number.isInteger(pid) || Number(pid) <= 0) return false;
  const distribution = process.platform === "win32" ? wslDistributionFromPath(sessionDirectory) : null;
  if (!distribution) return processAlive(pid);
  const cacheKey = `${distribution}:${Number(pid)}`;
  const now = Date.now();
  const cached = wslAliveCache.get(cacheKey);
  if (cached && now - cached.at < WSL_ALIVE_TTL_MS) return cached.alive;
  let alive = false;
  try {
    await execFileAsync("wsl.exe", ["-d", distribution, "--exec", "sh", "-lc", `kill -0 ${Number(pid)}`], { timeout: 2_000 });
    alive = true;
  } catch {
    alive = false;
  }
  if (wslAliveCache.size > 256) wslAliveCache.clear();
  wslAliveCache.set(cacheKey, { alive, at: now });
  return alive;
}

export function parseClaudeTail(text: string, fallbackMs: number): ClaudeTail {
  let lastUser = 0;
  let lastEnd = 0;
  let lastAssistant = 0;
  let activityAt = 0;
  for (const line of text.split("\n")) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const at = Date.parse(String(event.timestamp || "")) || fallbackMs;
    activityAt = Math.max(activityAt, at);
    if (event.type === "user" && !event.toolUseResult) lastUser = Math.max(lastUser, at);
    const message = event.message as { stop_reason?: string | null } | undefined;
    if (event.type === "assistant") {
      lastAssistant = Math.max(lastAssistant, at);
      // Any terminal stop reason ends the turn: end_turn, max_tokens, stop_sequence, refusal, ...
      if (message?.stop_reason && message.stop_reason !== "tool_use") lastEnd = Math.max(lastEnd, at);
    }
  }
  return { lastUser, lastEnd, lastAssistant, activityAt };
}

function emptyClaudeTail(): ClaudeTail {
  return { lastUser: 0, lastEnd: 0, lastAssistant: 0, activityAt: 0 };
}

function toWindow(label: string, limit?: ClaudeUsageLimit): UsageWindow {
  return {
    label,
    percent: clampPercent(limit?.percent),
    resetsAt: limit?.resets_at ? Date.parse(limit.resets_at) : null
  };
}
