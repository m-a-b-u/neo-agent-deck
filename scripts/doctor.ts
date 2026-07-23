#!/usr/bin/env node
import fs from "node:fs";
import { getStreamDeckModelName, listStreamDecks } from "@elgato-stream-deck/node";
import { Dashboard } from "../src/dashboard.js";
import { readClaudeAccessToken } from "../src/lib/claude-auth.js";
import { claudeSessionsDirectory, codexSessionsDirectory, openCodeDatabaseFile, platformLabel } from "../src/platform.js";

console.log(`Platform: ${platformLabel()} · Node ${process.version}`);
try {
  const devices = await listStreamDecks();
  if (devices.length) {
    for (const device of devices) console.log(`✓ ${getStreamDeckModelName(device.model)} detected`);
  } else {
    console.log("○ Stream Deck not connected; service will wait");
  }
} catch (error) {
  console.log(`✗ Stream Deck USB scan failed: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  const credentials = await readClaudeAccessToken();
  console.log(`✓ Claude Code sign-in available (${credentials.source})`);
} catch {
  console.log("✗ Claude Code sign-in not available");
}

console.log(`${fs.existsSync(claudeSessionsDirectory()) ? "✓" : "✗"} Claude Code session data available`);
console.log(`${fs.existsSync(codexSessionsDirectory()) ? "✓" : "✗"} Codex session data available`);
console.log(`${fs.existsSync(openCodeDatabaseFile()) ? "✓" : "✗"} OpenCode SQLite data available`);

try {
  const snapshot = await new Dashboard().collect(true);
  for (const provider of Object.values(snapshot.providers)) {
    const healthy = !provider.usage.error;
    console.log(`${healthy ? "✓" : "✗"} ${provider.provider} backend ${healthy ? "readable" : provider.usage.error}`);
  }
} catch (error) {
  console.log(`✗ Backend collection failed: ${error instanceof Error ? error.message : String(error)}`);
}
