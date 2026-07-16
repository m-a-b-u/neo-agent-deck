import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { OpenCodeCollector } from "../src/collectors/opencode.js";
import { extractClaudeAccessToken, readClaudeAccessToken } from "../src/lib/claude-auth.js";
import {
  claudeConfigDirectory,
  claudeSessionsDirectory,
  codexHomeDirectory,
  codexSessionsDirectory,
  openCodeDataDirectory,
  openCodeDatabaseFile,
  platformLabel,
  wslDistributionFromPath
} from "../src/platform.js";
import type { PersistedState } from "../src/types.js";

describe("cross-platform data paths", () => {
  it("uses portable home-relative defaults", () => {
    const home = path.join(path.sep, "home", "agent");
    expect(claudeConfigDirectory({}, home)).toBe(path.join(home, ".claude"));
    expect(claudeSessionsDirectory({}, home)).toBe(path.join(home, ".claude", "sessions"));
    expect(codexHomeDirectory({}, home)).toBe(path.join(home, ".codex"));
    expect(codexSessionsDirectory({}, home)).toBe(path.join(home, ".codex", "sessions"));
    expect(openCodeDataDirectory({}, home)).toBe(path.join(home, ".local", "share", "opencode"));
    expect(openCodeDatabaseFile({}, home)).toBe(path.join(home, ".local", "share", "opencode", "opencode.db"));
  });

  it("honors backend directory overrides for native Windows or WSL shares", () => {
    const env = {
      CLAUDE_CONFIG_DIR: path.join(path.sep, "custom", "claude"),
      CODEX_HOME: path.join(path.sep, "custom", "codex"),
      OPENCODE_DATA_HOME: path.join(path.sep, "custom", "opencode")
    };
    expect(claudeConfigDirectory(env, "unused")).toBe(env.CLAUDE_CONFIG_DIR);
    expect(codexHomeDirectory(env, "unused")).toBe(env.CODEX_HOME);
    expect(openCodeDataDirectory(env, "unused")).toBe(env.OPENCODE_DATA_HOME);
    expect(platformLabel("win32")).toBe("Windows");
    expect(platformLabel("darwin")).toBe("macOS");
    expect(platformLabel("linux")).toBe("Linux");
    expect(wslDistributionFromPath("\\\\wsl.localhost\\Ubuntu-24.04\\home\\agent\\.claude")).toBe("Ubuntu-24.04");
    expect(wslDistributionFromPath("\\\\wsl$\\Debian\\home\\agent\\.codex")).toBe("Debian");
    expect(wslDistributionFromPath("C:\\Users\\agent\\.claude")).toBeNull();
  });
});

describe("portable Claude credentials", () => {
  it("extracts both credential shapes without exposing other fields", () => {
    expect(extractClaudeAccessToken({ claudeAiOauth: { accessToken: " oauth-token " } })).toBe("oauth-token");
    expect(extractClaudeAccessToken({ accessToken: "legacy-token" })).toBe("legacy-token");
    expect(extractClaudeAccessToken({ accessToken: "" })).toBeNull();
    expect(extractClaudeAccessToken(null)).toBeNull();
  });

  it("reads the file-backed credential used outside macOS", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "neo-agent-deck-claude-auth-"));
    try {
      fs.writeFileSync(path.join(directory, ".credentials.json"), JSON.stringify({
        claudeAiOauth: { accessToken: "windows-oauth-token", refreshToken: "never-return-this" }
      }));
      await expect(readClaudeAccessToken(directory, {}, "win32")).resolves.toEqual({
        token: "windows-oauth-token",
        source: "credentials file"
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("prefers an explicit environment token on every platform", async () => {
    await expect(readClaudeAccessToken("unused", { CLAUDE_CODE_OAUTH_TOKEN: "env-token" }, "win32")).resolves.toEqual({
      token: "env-token",
      source: "environment"
    });
  });
});

describe("built-in SQLite OpenCode backend", () => {
  it("collects the latest session and usage without an external sqlite3 executable", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "neo-agent-deck-opencode-"));
    const databaseFile = path.join(directory, "opencode.db");
    const now = Date.now();
    const database = new DatabaseSync(databaseFile);
    database.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, time_updated INTEGER, time_archived INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
    `);
    database.prepare("INSERT INTO session VALUES (?, ?, ?, ?)").run("session-1", "Windows integration", now, null);
    database.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run(
      "message-1", "session-1", now, JSON.stringify({ role: "user" })
    );
    database.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run(
      "message-2", "session-1", now, JSON.stringify({ role: "assistant", finish: "stop", tokens: { total: 321 }, cost: 1.25 })
    );
    database.close();

    try {
      const state: PersistedState = {
        schemaVersion: 2,
        installedAt: now - 20_000,
        attentionSince: now - 10_000,
        infoPage: 3,
        acknowledged: {}
      };
      const result = await new OpenCodeCollector(databaseFile).collect(state);
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0]).toMatchObject({ id: "session-1", state: "attention", completionAt: now });
      expect(result.usage.error).toBeNull();
      expect(result.usage.windows).toEqual([
        { label: "24h", value: 321, unit: "tokens", resetsAt: null },
        { label: "7d", value: 321, unit: "tokens", resetsAt: null }
      ]);
      expect(result.usage.costUsd).toBe(1.25);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
