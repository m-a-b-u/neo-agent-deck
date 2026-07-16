#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DeviceModelId, listStreamDecks } from "@elgato-stream-deck/node";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Dashboard } from "../src/dashboard.js";

const execFileAsync = promisify(execFile);
const devices = await listStreamDecks();
const neo = devices.find((device) => device.model === DeviceModelId.NEO);
console.log(`${neo ? "✓" : "○"} Stream Deck Neo ${neo ? "detected" : "not connected; service will wait"}`);

try {
  const { stdout } = await execFileAsync("/usr/bin/security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"], { timeout: 5_000 });
  const credentials = JSON.parse(stdout) as { claudeAiOauth?: { accessToken?: string } };
  console.log(`${credentials.claudeAiOauth?.accessToken ? "✓" : "✗"} Claude Code sign-in available`);
} catch {
  console.log("✗ Claude Code sign-in not available");
}

console.log(`${fs.existsSync(path.join(os.homedir(), ".codex", "sessions")) ? "✓" : "✗"} Codex session data available`);
console.log(`${fs.existsSync(path.join(os.homedir(), ".local", "share", "opencode", "opencode.db")) ? "✓" : "✗"} OpenCode SQLite data available`);

try {
  const snapshot = await new Dashboard().collect(true);
  for (const provider of Object.values(snapshot.providers)) {
    const healthy = !provider.usage.error;
    console.log(`${healthy ? "✓" : "✗"} ${provider.provider} backend ${healthy ? "readable" : provider.usage.error}`);
  }
} catch (error) {
  console.log(`✗ Backend collection failed: ${error instanceof Error ? error.message : String(error)}`);
}
