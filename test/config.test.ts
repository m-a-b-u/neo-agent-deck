import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, loadConfig, saveConfig } from "../src/config.js";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "neo-agent-deck-config-"));
}

describe("deck config", () => {
  it("falls back to defaults when config.json is missing or broken", () => {
    const directory = tempDir();
    try {
      expect(loadConfig(directory)).toEqual(DEFAULT_CONFIG);
      fs.writeFileSync(path.join(directory, "config.json"), "{ not json");
      expect(loadConfig(directory)).toEqual(DEFAULT_CONFIG);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("coerces each field defensively", () => {
    const directory = tempDir();
    try {
      fs.writeFileSync(path.join(directory, "config.json"), JSON.stringify({
        brightness: 250,
        keys: ["summary", "nonsense", "claude.status", "codex.usage", "blank", "info", "opencode.status", "opencode.usage"],
        infoBar: ["codex", "bogus", "codex", "all"],
        restingPage: "claude"
      }));
      const config = loadConfig(directory);
      expect(config.brightness).toBe(100);
      expect(config.keys).toEqual(["summary", "blank", "claude.status", "codex.usage", "blank", "info", "opencode.status", "opencode.usage"]);
      expect(config.infoBar).toEqual(["codex", "all"]);
      expect(config.restingPage).toBe("all");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses default keys when the keys array is not exactly length 8", () => {
    const directory = tempDir();
    try {
      fs.writeFileSync(path.join(directory, "config.json"), JSON.stringify({ keys: ["summary"], infoBar: [], brightness: "hi" }));
      const config = loadConfig(directory);
      expect(config.keys).toEqual(DEFAULT_CONFIG.keys);
      expect(config.infoBar).toEqual(DEFAULT_CONFIG.infoBar);
      expect(config.brightness).toBe(70);
      expect(config.restingPage).toBe("all");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("accepts a 15-key layout and its InfoBar tiles", () => {
    const directory = tempDir();
    try {
      const keys = [
        "claude.status", "codex.status", "opencode.status", "summary", "blank",
        "claude.usage", "codex.usage", "opencode.usage", "blank", "blank",
        "infobar", "infobar", "infobar", "infobar", "info"
      ];
      fs.writeFileSync(path.join(directory, "config.json"), JSON.stringify({ keys }));
      expect(loadConfig(directory).keys).toEqual(keys);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a key count that matches no deck layout", () => {
    const directory = tempDir();
    try {
      fs.writeFileSync(path.join(directory, "config.json"), JSON.stringify({ keys: Array(12).fill("blank") }));
      expect(loadConfig(directory).keys).toEqual(DEFAULT_CONFIG.keys);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("round-trips through saveConfig and restricts POSIX permissions", () => {
    const directory = tempDir();
    try {
      const config = { ...DEFAULT_CONFIG, brightness: 55, restingPage: "claude" as const };
      saveConfig(config, directory);
      expect(loadConfig(directory)).toEqual(config);
      if (process.platform !== "win32") {
        const mode = fs.statSync(path.join(directory, "config.json")).mode & 0o777;
        expect(mode).toBe(0o600);
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
