import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { emptyUsage } from "../lib/util.js";
import { openCodeDatabaseFile, wslDistributionFromPath } from "../platform.js";
import type { PersistedState, SessionSnapshot, SessionState, UsageSnapshot, UsageWindow } from "../types.js";

const execFileAsync = promisify(execFile);
const ACTIVE_MESSAGE_MS = 10 * 60_000;

export interface OpenCodeSessionRow {
  id: string;
  title: string;
  time_updated: number;
  time_archived: number | null;
  role: string | null;
  finish: string | null;
  error_type: string | null;
  message_at: number | null;
}

interface OpenCodeUsageRow {
  period: string;
  tokens: number;
  cost_usd: number;
}

export class OpenCodeCollector {
  constructor(private readonly database = openCodeDatabaseFile()) {}

  async collect(state: PersistedState): Promise<{ sessions: SessionSnapshot[]; usage: UsageSnapshot }> {
    if (!fs.existsSync(this.database)) {
      return { sessions: [], usage: emptyUsage("opencode", "OpenCode database not found", { costUsd: 0, updatedAt: Date.now() }) };
    }

    try {
      const [rows, usageRows, appRunning] = await Promise.all([
        queryOpenCodeDatabase<OpenCodeSessionRow>(this.database, sessionsSql),
        queryOpenCodeDatabase<OpenCodeUsageRow>(this.database, usageSql),
        isOpenCodeRunning(this.database)
      ]);
      const now = Date.now();
      const sessions = rows.map((row, index) => toSession(row, state, now, appRunning && index === 0));
      const windows: UsageWindow[] = usageRows.map((row) => ({
        label: row.period,
        value: Number(row.tokens) || 0,
        unit: "tokens",
        resetsAt: null
      }));
      return {
        sessions,
        usage: {
          provider: "opencode",
          windows,
          costUsd: Number(usageRows.find((row) => row.period === "7d")?.cost_usd) || 0,
          updatedAt: now,
          error: null
        }
      };
    } catch (error) {
      return {
        sessions: [],
        usage: emptyUsage("opencode", error instanceof Error ? error.message : String(error), { costUsd: 0, updatedAt: Date.now() })
      };
    }
  }
}

export function inferOpenCodeState(row: OpenCodeSessionRow, state: PersistedState, now: number): { state: SessionState; completionAt: number } {
  const activityAt = Number(row.message_at || row.time_updated || 0);
  const recent = now - activityAt < ACTIVE_MESSAGE_MS;
  const incompleteAssistant = row.role === "assistant" && (!row.finish || row.finish === "tool-calls") && !row.error_type;
  if (recent && (row.role === "user" || incompleteAssistant)) return { state: "working", completionAt: 0 };

  const completed = row.role === "assistant" && (row.finish === "stop" || Boolean(row.error_type));
  const key = `opencode:${row.id}`;
  if (completed && activityAt > state.attentionSince && activityAt > (state.acknowledged[key] || 0)) {
    return { state: "attention", completionAt: activityAt };
  }
  return { state: "idle", completionAt: 0 };
}

function toSession(row: OpenCodeSessionRow, state: PersistedState, now: number, currentDesktopSession: boolean): SessionSnapshot {
  const inferred = inferOpenCodeState(row, state, now);
  return {
    key: `opencode:${row.id}`,
    id: row.id,
    provider: "opencode",
    state: inferred.state,
    isOpen: inferred.state !== "idle" || currentDesktopSession,
    activityAt: Number(row.message_at || row.time_updated || 0),
    completionAt: inferred.completionAt
  };
}

export function queryOpenCodeDatabase<T>(databaseFile: string, sql: string): T[] {
  const database = new DatabaseSync(databaseFile, { readOnly: true, timeout: 5_000 });
  try {
    return database.prepare(sql).all() as T[];
  } finally {
    database.close();
  }
}

async function isOpenCodeRunning(databaseFile: string): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      const distribution = wslDistributionFromPath(databaseFile);
      if (distribution) {
        await execFileAsync("wsl.exe", ["-d", distribution, "--exec", "pgrep", "-ix", "opencode"], { timeout: 2_000 });
        return true;
      }
      const { stdout } = await execFileAsync("tasklist.exe", ["/FI", "IMAGENAME eq OpenCode.exe", "/FO", "CSV", "/NH"], { timeout: 2_000 });
      return /"OpenCode\.exe"/i.test(stdout);
    }
    await execFileAsync("pgrep", ["-ix", "opencode"], { timeout: 1_000 });
    return true;
  } catch {
    return false;
  }
}

const sessionsSql = `
SELECT
  s.id,
  s.title,
  s.time_updated,
  s.time_archived,
  json_extract(m.data, '$.role') AS role,
  json_extract(m.data, '$.finish') AS finish,
  json_type(m.data, '$.error') AS error_type,
  m.time_created AS message_at
FROM session s
LEFT JOIN message m ON m.id = (
  SELECT id
  FROM message
  WHERE session_id = s.id
  ORDER BY time_created DESC, id DESC
  LIMIT 1
)
WHERE s.time_archived IS NULL
ORDER BY s.time_updated DESC
LIMIT 50;
`;

const usageSql = `
SELECT '24h' AS period,
  coalesce(sum(coalesce(json_extract(data, '$.tokens.total'),
    coalesce(json_extract(data, '$.tokens.input'), 0) +
    coalesce(json_extract(data, '$.tokens.output'), 0) +
    coalesce(json_extract(data, '$.tokens.reasoning'), 0))), 0) AS tokens,
  coalesce(sum(json_extract(data, '$.cost')), 0) AS cost_usd
FROM message
WHERE json_extract(data, '$.role') = 'assistant'
  AND time_created >= (strftime('%s', 'now') - 86400) * 1000
UNION ALL
SELECT '7d',
  coalesce(sum(coalesce(json_extract(data, '$.tokens.total'),
    coalesce(json_extract(data, '$.tokens.input'), 0) +
    coalesce(json_extract(data, '$.tokens.output'), 0) +
    coalesce(json_extract(data, '$.tokens.reasoning'), 0))), 0),
  coalesce(sum(json_extract(data, '$.cost')), 0)
FROM message
WHERE json_extract(data, '$.role') = 'assistant'
  AND time_created >= (strftime('%s', 'now') - 604800) * 1000;
`;
