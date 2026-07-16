import fs from "node:fs";
import path from "node:path";
import { extractUuid, listJsonl, readTail, type FileStamp } from "../lib/files.js";
import { clampPercent, emptyUsage } from "../lib/util.js";
import { codexSessionsDirectory } from "../platform.js";
import type { PersistedState, SessionSnapshot, UsageSnapshot, UsageWindow } from "../types.js";

interface RateWindow {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number;
}

interface RateLimits {
  primary?: RateWindow | null;
  secondary?: RateWindow | null;
}

export interface CodexTail {
  life: "task_started" | "task_complete" | "turn_aborted" | null;
  lifeAt: number;
  rateLimits: RateLimits | null;
}

interface CodexCandidate extends SessionSnapshot {
  rateLimits: RateLimits | null;
}

export class CodexCollector {
  private files: FileStamp[] = [];
  private scannedAt = 0;
  private readonly cache = new Map<string, { size: number; mtimeMs: number; info: CodexTail }>();
  private usage: UsageSnapshot = emptyUsage("codex", "loading");

  constructor(private readonly sessionDirectory = codexSessionsDirectory()) {}

  async collect(state: PersistedState): Promise<{ sessions: SessionSnapshot[]; usage: UsageSnapshot }> {
    const now = Date.now();
    if (!this.files.length || now - this.scannedAt > 30_000) {
      this.files = await listJsonl(this.sessionDirectory);
      this.scannedAt = now;
    }
    const candidates: CodexCandidate[] = [];
    const files = [...this.files].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 40);

    for (const [index, file] of files.entries()) {
      const id = extractUuid(file.path);
      if (!id) continue;
      const info = await this.readInfo(file, index);
      const key = `codex:${id}`;
      let sessionState: SessionSnapshot["state"] = "idle";
      let completionAt = 0;
      if (info.life === "task_started") {
        sessionState = "working";
      } else if ((info.life === "task_complete" || info.life === "turn_aborted") && info.lifeAt > state.attentionSince && info.lifeAt > (state.acknowledged[key] || 0)) {
        sessionState = "attention";
        completionAt = info.lifeAt;
      }
      candidates.push({
        key,
        id,
        provider: "codex",
        state: sessionState,
        isOpen: sessionState !== "idle",
        activityAt: file.mtimeMs,
        completionAt,
        rateLimits: info.rateLimits
      });
    }

    const source = candidates.find((candidate) => candidate.rateLimits)?.rateLimits;
    if (source) this.usage = usageFromRateLimits(source);
    else this.usage = { ...this.usage, error: "No Codex usage event found", updatedAt: Date.now() };

    const currentPaths = new Set(this.files.map((file) => file.path));
    for (const key of this.cache.keys()) {
      if (!currentPaths.has(key)) this.cache.delete(key);
    }

    return { sessions: candidates, usage: this.usage };
  }

  private async readInfo(file: FileStamp, rank: number): Promise<CodexTail> {
    const cached = this.cache.get(file.path);
    if (cached && cached.size === file.size && cached.mtimeMs === file.mtimeMs) return cached.info;

    let info = parseCodexTail(await readTail(file.path, 1024 * 1024), file.mtimeMs);
    if (cached && file.size >= cached.size) {
      info = {
        life: info.life || cached.info.life,
        lifeAt: info.life ? info.lifeAt : cached.info.lifeAt,
        rateLimits: info.rateLimits || cached.info.rateLimits
      };
    } else if (!info.life && rank < 5) {
      const lifecycle = await findLatestCodexLifecycle(file.path, file.size, file.mtimeMs);
      if (lifecycle.life) info = { ...info, life: lifecycle.life, lifeAt: lifecycle.lifeAt };
    }
    this.cache.set(file.path, { size: file.size, mtimeMs: file.mtimeMs, info });
    return info;
  }
}

export async function findLatestCodexLifecycle(file: string, size: number, fallbackMs: number): Promise<Pick<CodexTail, "life" | "lifeAt">> {
  const chunkSize = 4 * 1024 * 1024;
  const overlap = 64 * 1024;
  let handle: fs.promises.FileHandle;
  try {
    handle = await fs.promises.open(file, "r");
  } catch {
    return { life: null, lifeAt: 0 };
  }
  try {
    let end = size;
    while (end > 0) {
      const start = Math.max(0, end - chunkSize);
      const buffer = Buffer.alloc(end - start);
      await handle.read(buffer, 0, buffer.length, start);
      const parsed = parseCodexTail(buffer.toString("utf8"), fallbackMs);
      if (parsed.life) return { life: parsed.life, lifeAt: parsed.lifeAt };
      if (start === 0) break;
      end = start + overlap;
    }
  } catch {
    // A session file can disappear or become unreadable mid-scan.
  } finally {
    await handle.close().catch(() => {});
  }
  return { life: null, lifeAt: 0 };
}

export function parseCodexTail(text: string, fallbackMs: number): CodexTail {
  let life: CodexTail["life"] = null;
  let lifeAt = 0;
  let rateLimits: RateLimits | null = null;
  for (const line of text.split("\n")) {
    let event: { type?: string; timestamp?: string; payload?: { type?: string; rate_limits?: RateLimits } };
    try {
      event = JSON.parse(line) as typeof event;
    } catch {
      continue;
    }
    if (event.type !== "event_msg") continue;
    const type = event.payload?.type;
    if (type === "task_started" || type === "task_complete" || type === "turn_aborted") {
      life = type;
      lifeAt = Date.parse(event.timestamp || "") || fallbackMs;
    }
    if (type === "token_count" && event.payload?.rate_limits) rateLimits = event.payload.rate_limits;
  }
  return { life, lifeAt, rateLimits };
}

export function usageFromRateLimits(rateLimits: RateLimits): UsageSnapshot {
  const windows: UsageWindow[] = [];
  if (rateLimits.primary) windows.push(toWindow(rateLimits.primary));
  if (rateLimits.secondary) windows.push(toWindow(rateLimits.secondary));
  return { provider: "codex", windows, updatedAt: Date.now(), error: null };
}

function toWindow(window: RateWindow): UsageWindow {
  return {
    label: windowLabel(window.window_minutes),
    percent: clampPercent(window.used_percent),
    resetsAt: window.resets_at ? window.resets_at * 1000 : null
  };
}

export function windowLabel(minutes?: number): string {
  if (!Number.isFinite(minutes)) return "limit";
  const value = Number(minutes);
  if (value % 10_080 === 0) return `${value / 10_080}w`;
  if (value % 1_440 === 0) return `${value / 1_440}d`;
  if (value % 60 === 0) return `${value / 60}h`;
  return `${value}m`;
}
