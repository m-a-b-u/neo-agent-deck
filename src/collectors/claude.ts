import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { listJsonl, loadJson, processAlive, readTail, type FileStamp } from "../lib/files.js";
import { clampPercent, emptyUsage } from "../lib/util.js";
import type { PersistedState, SessionSnapshot, UsageSnapshot, UsageWindow } from "../types.js";

const execFileAsync = promisify(execFile);
const home = os.homedir();
const sessionDirectory = path.join(home, ".claude", "sessions");
const projectDirectory = path.join(home, ".claude", "projects");

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

  async collect(state: PersistedState, forceUsage = false): Promise<{ sessions: SessionSnapshot[]; usage: UsageSnapshot }> {
    const now = Date.now();
    if (!this.projectFiles.length || now - this.scannedAt > 30_000) {
      this.projectFiles = await listJsonl(projectDirectory);
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
      names = (await fs.promises.readdir(sessionDirectory)).filter((name) => name.endsWith(".json"));
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
      const raw = loadJson<ClaudeSessionFile | null>(path.join(sessionDirectory, filename), null);
      if (!raw?.sessionId || !processAlive(raw.pid)) continue;
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
      if (process.platform !== "darwin") throw new Error("Claude usage currently requires macOS Keychain");
      const { stdout } = await execFileAsync("/usr/bin/security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"], {
        timeout: 5_000,
        maxBuffer: 1024 * 1024
      });
      const credentials = JSON.parse(stdout) as { claudeAiOauth?: { accessToken?: string }; accessToken?: string };
      const token = credentials.claudeAiOauth?.accessToken || credentials.accessToken;
      if (!token) throw new Error("Claude Code OAuth token not found");
      const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-beta": "oauth-2025-04-20",
          "user-agent": "neo-agent-deck/0.2"
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
