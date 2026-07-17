import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseClaudeTail } from "../src/collectors/claude.js";
import { findLatestCodexLifecycle, inferCodexState, parseCodexTail, usageFromRateLimits, windowLabel, type CodexTail } from "../src/collectors/codex.js";
import { inferOpenCodeState, type OpenCodeSessionRow } from "../src/collectors/opencode.js";
import { clampPercent } from "../src/lib/util.js";
import type { PersistedState } from "../src/types.js";

describe("Claude session parsing", () => {
  it("finds the newest user prompt and completed turn", () => {
    const text = [
      JSON.stringify({ type: "user", timestamp: "2026-07-16T10:00:00Z" }),
      JSON.stringify({ type: "assistant", timestamp: "2026-07-16T10:01:00Z", message: { stop_reason: "tool_use" } }),
      JSON.stringify({ type: "assistant", timestamp: "2026-07-16T10:02:00Z", message: { stop_reason: "end_turn" } })
    ].join("\n");
    const parsed = parseClaudeTail(text, 0);
    expect(parsed.lastUser).toBe(Date.parse("2026-07-16T10:00:00Z"));
    expect(parsed.lastEnd).toBe(Date.parse("2026-07-16T10:02:00Z"));
    expect(parsed.lastAssistant).toBe(Date.parse("2026-07-16T10:02:00Z"));
  });

  it("treats non-end_turn terminal stops as turn ends so stalled turns decay", () => {
    const text = [
      JSON.stringify({ type: "user", timestamp: "2026-07-16T10:00:00Z" }),
      JSON.stringify({ type: "assistant", timestamp: "2026-07-16T10:01:00Z", message: { stop_reason: "tool_use" } }),
      JSON.stringify({ type: "assistant", timestamp: "2026-07-16T10:02:00Z", message: { stop_reason: "max_tokens" } })
    ].join("\n");
    const parsed = parseClaudeTail(text, 0);
    expect(parsed.lastEnd).toBe(Date.parse("2026-07-16T10:02:00Z"));
    expect(parsed.lastAssistant).toBe(Date.parse("2026-07-16T10:02:00Z"));
  });

  it("tracks the latest assistant message even without a terminal stop reason", () => {
    const text = [
      JSON.stringify({ type: "user", timestamp: "2026-07-16T10:00:00Z" }),
      JSON.stringify({ type: "assistant", timestamp: "2026-07-16T10:01:00Z", message: { stop_reason: null } })
    ].join("\n");
    const parsed = parseClaudeTail(text, 0);
    expect(parsed.lastEnd).toBe(0);
    expect(parsed.lastAssistant).toBe(Date.parse("2026-07-16T10:01:00Z"));
  });

  it("ignores tool-result user events so they never look like a fresh prompt", () => {
    const text = [
      JSON.stringify({ type: "user", timestamp: "2026-07-16T10:00:00Z" }),
      JSON.stringify({ type: "assistant", timestamp: "2026-07-16T10:01:00Z", message: { stop_reason: "end_turn" } }),
      JSON.stringify({ type: "user", timestamp: "2026-07-16T10:02:00Z", toolUseResult: { stdout: "ok" } })
    ].join("\n");
    const parsed = parseClaudeTail(text, 0);
    expect(parsed.lastUser).toBe(Date.parse("2026-07-16T10:00:00Z"));
    expect(parsed.lastEnd).toBe(Date.parse("2026-07-16T10:01:00Z"));
    expect(parsed.activityAt).toBe(Date.parse("2026-07-16T10:02:00Z"));
  });

  it("falls back to the file mtime when a line has no timestamp", () => {
    const fallbackMs = Date.parse("2026-07-16T09:30:00Z");
    const parsed = parseClaudeTail(JSON.stringify({ type: "user" }), fallbackMs);
    expect(parsed.lastUser).toBe(fallbackMs);
    expect(parsed.activityAt).toBe(fallbackMs);
  });
});

describe("Codex session parsing", () => {
  it("uses the final lifecycle event and newest rate limits", () => {
    const text = [
      JSON.stringify({ type: "event_msg", timestamp: "2026-07-16T10:00:00Z", payload: { type: "task_started" } }),
      JSON.stringify({ type: "event_msg", timestamp: "2026-07-16T10:01:00Z", payload: { type: "token_count", rate_limits: { primary: { used_percent: 24, window_minutes: 10080 } } } }),
      JSON.stringify({ type: "event_msg", timestamp: "2026-07-16T10:02:00Z", payload: { type: "task_complete" } })
    ].join("\n");
    const parsed = parseCodexTail(text, 0);
    expect(parsed.life).toBe("task_complete");
    expect(parsed.rateLimits?.primary?.used_percent).toBe(24);
  });

  it("formats rate-limit windows", () => {
    expect(windowLabel(300)).toBe("5h");
    expect(windowLabel(10080)).toBe("1w");
  });

  it("converts rate limits into two clamped usage windows", () => {
    const usage = usageFromRateLimits({
      primary: { used_percent: 137, window_minutes: 300, resets_at: 1_784_800_000 },
      secondary: { used_percent: 24, window_minutes: 10_080, resets_at: 1_785_000_000 }
    });
    expect(usage.provider).toBe("codex");
    expect(usage.error).toBeNull();
    expect(usage.windows).toHaveLength(2);
    expect(usage.windows[0]).toMatchObject({ label: "5h", percent: 100, resetsAt: 1_784_800_000 * 1000 });
    expect(usage.windows[1]).toMatchObject({ label: "1w", percent: 24, resetsAt: 1_785_000_000 * 1000 });
  });

  it("clamps out-of-range or malformed percentages", () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(150)).toBe(100);
    expect(clampPercent(Number.NaN)).toBe(0);
  });

  it("finds a running lifecycle event beyond the normal 1 MB tail", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "neo-agent-deck-codex-"));
    const file = path.join(directory, "session.jsonl");
    const started = JSON.stringify({ type: "event_msg", timestamp: "2026-07-16T10:00:00Z", payload: { type: "task_started" } });
    fs.writeFileSync(file, `${started}\n${JSON.stringify({ type: "response_item", payload: "x".repeat(5 * 1024 * 1024) })}\n`);
    try {
      const result = await findLatestCodexLifecycle(file, fs.statSync(file).size, 0);
      expect(result).toEqual({ life: "task_started", lifeAt: Date.parse("2026-07-16T10:00:00Z") });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("Codex session state", () => {
  const state: PersistedState = { schemaVersion: 2, installedAt: 50, attentionSince: 100, infoPage: 3, acknowledged: {} };
  const tail = (overrides: Partial<CodexTail>): CodexTail => ({ life: "task_started", lifeAt: 200, rateLimits: null, ...overrides });

  it("shows a recently active task_started session as working", () => {
    expect(inferCodexState(tail({}), 1_000, state, 1_500, "codex:1").state).toBe("working");
  });

  it("decays a stale task_started (crashed session) to idle instead of forever-working", () => {
    const now = 1_000_000_000;
    expect(inferCodexState(tail({}), now - 599_999, state, now, "codex:1").state).toBe("working");
    expect(inferCodexState(tail({}), now - 600_000, state, now, "codex:1").state).toBe("idle");
  });

  it("marks a fresh completion as attention until acknowledged", () => {
    expect(inferCodexState(tail({ life: "task_complete", lifeAt: 200 }), 200, state, 300, "codex:1")).toEqual({ state: "attention", completionAt: 200 });
    const acknowledged = { ...state, acknowledged: { "codex:1": 200 } };
    expect(inferCodexState(tail({ life: "task_complete", lifeAt: 200 }), 200, acknowledged, 300, "codex:1")).toEqual({ state: "idle", completionAt: 0 });
  });
});

describe("OpenCode session parsing", () => {
  const state: PersistedState = { schemaVersion: 2, installedAt: 50, attentionSince: 100, infoPage: 3, acknowledged: {} };
  const row = (overrides: Partial<OpenCodeSessionRow>): OpenCodeSessionRow => ({
    id: "session-1",
    title: "Backend test",
    time_updated: 200,
    time_archived: null,
    role: "assistant",
    finish: "stop",
    error_type: null,
    message_at: 200,
    ...overrides
  });

  it("recognizes active user prompts and tool-call loops as working", () => {
    expect(inferOpenCodeState(row({ role: "user", finish: null, message_at: 1_000 }), state, 1_500).state).toBe("working");
    expect(inferOpenCodeState(row({ finish: "tool-calls", message_at: 1_000 }), state, 1_500).state).toBe("working");
  });

  it("marks a new completion as attention until acknowledged", () => {
    expect(inferOpenCodeState(row({}), state, 1_500)).toEqual({ state: "attention", completionAt: 200 });
    const acknowledged = { ...state, acknowledged: { "opencode:session-1": 200 } };
    expect(inferOpenCodeState(row({}), acknowledged, 1_500)).toEqual({ state: "idle", completionAt: 0 });
  });

  it("treats an assistant error as a completion needing attention, even mid-tool-calls", () => {
    const errored = row({ finish: "tool-calls", error_type: "object", message_at: 900 });
    expect(inferOpenCodeState(errored, state, 1_500)).toEqual({ state: "attention", completionAt: 900 });
  });

  it("stops counting a user prompt as working exactly at the 10-minute boundary", () => {
    const prompt = row({ role: "user", finish: null, message_at: 1_000_000 });
    expect(inferOpenCodeState(prompt, state, 1_000_000 + 599_999).state).toBe("working");
    expect(inferOpenCodeState(prompt, state, 1_000_000 + 600_000).state).toBe("idle");
  });
});
