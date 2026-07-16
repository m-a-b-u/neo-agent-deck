#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { DEFAULT_CONFIG } from "../src/config.js";
import { Dashboard, summarizeProvider } from "../src/dashboard.js";
import { renderDeckBuffers } from "../src/render.js";
import type { DashboardSnapshot, Provider, SessionSnapshot, UsageSnapshot } from "../src/types.js";

const args = process.argv.slice(2);
const live = args.includes("--live");
const outputArg = args.find((argument) => !argument.startsWith("--"));
const output = path.resolve(outputArg || "docs/neo-agent-deck-preview.png");
const snapshot = live ? await new Dashboard().collect(true) : sampleSnapshot();

const buffers = await renderDeckBuffers(snapshot, 3, DEFAULT_CONFIG);
const keys = buffers.slice(0, 8);
const infoBar = buffers[8];
const keyPngs: Buffer[] = [];
for (const key of keys) {
  keyPngs.push(await sharp(key, { raw: { width: 96, height: 96, channels: 4 } }).png().toBuffer());
}
const infoBarPng = await sharp(infoBar, { raw: { width: 248, height: 58, channels: 4 } }).png().toBuffer();
const width = 486;
const composites: sharp.OverlayOptions[] = keyPngs.map((input, index) => ({
  input,
  left: 24 + (index % 4) * 114,
  top: 24 + Math.floor(index / 4) * 114
}));
composites.push({ input: infoBarPng, left: 119, top: 258 });
composites.push({ input: Buffer.from(`<svg width="70" height="58"><text x="35" y="38" text-anchor="middle" fill="#94a3b8" font-family="sans-serif" font-size="27">‹</text></svg>`), left: 24, top: 258 });
composites.push({ input: Buffer.from(`<svg width="70" height="58"><text x="35" y="38" text-anchor="middle" fill="#94a3b8" font-family="sans-serif" font-size="27">›</text></svg>`), left: 392, top: 258 });

fs.mkdirSync(path.dirname(output), { recursive: true });
await sharp({ create: { width, height: 340, channels: 4, background: "#090b10" } })
  .composite(composites)
  .flatten({ background: "#090b10" })
  .removeAlpha()
  .png()
  .toFile(output);
console.log(output);

function sampleSnapshot(): DashboardSnapshot {
  const session = (provider: Provider, id: string, state: SessionSnapshot["state"], isOpen = state !== "idle"): SessionSnapshot => ({
    key: `${provider}:${id}`,
    id,
    provider,
    state,
    isOpen,
    activityAt: Date.now(),
    completionAt: state === "attention" ? Date.now() : 0
  });
  const claudeUsage: UsageSnapshot = { provider: "claude", windows: [{ label: "5h", percent: 12, resetsAt: null }, { label: "7d", percent: 34, resetsAt: null }], updatedAt: Date.now(), error: null };
  const codexUsage: UsageSnapshot = { provider: "codex", windows: [{ label: "1w", percent: 25, resetsAt: null }], updatedAt: Date.now(), error: null };
  const opencodeUsage: UsageSnapshot = { provider: "opencode", windows: [{ label: "24h", value: 473_000, unit: "tokens", resetsAt: null }, { label: "7d", value: 5_180_000, unit: "tokens", resetsAt: null }], costUsd: 0, updatedAt: Date.now(), error: null };
  const providers = {
    claude: summarizeProvider("claude", { sessions: [session("claude", "1", "working"), session("claude", "2", "idle", true)], usage: claudeUsage }),
    codex: summarizeProvider("codex", { sessions: [session("codex", "1", "attention"), session("codex", "2", "idle")], usage: codexUsage }),
    opencode: summarizeProvider("opencode", { sessions: [session("opencode", "1", "idle", true)], usage: opencodeUsage })
  };
  const all = Object.values(providers).flatMap((provider) => provider.sessions);
  return {
    providers,
    openCount: all.filter((item) => item.isOpen).length,
    workingCount: all.filter((item) => item.state === "working").length,
    attentionCount: all.filter((item) => item.state === "attention").length,
    updatedAt: Date.now()
  };
}
