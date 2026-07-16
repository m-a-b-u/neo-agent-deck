#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { DEFAULT_CONFIG } from "../src/config.js";
import { Dashboard, summarizeProvider } from "../src/dashboard.js";
import { renderDeckBuffers } from "../src/render.js";
import type { DashboardSnapshot, Provider, SessionSnapshot, UsageSnapshot } from "../src/types.js";

const args = process.argv.slice(2);
const live = args.includes("--live");
const readme = args.includes("--readme");
const outputArg = args.find((argument) => !argument.startsWith("--"));
const defaultOutput = live ? path.join(os.tmpdir(), "neo-agent-deck-live.png") : "docs/neo-agent-deck-preview.png";
const output = path.resolve(outputArg || defaultOutput);
const snapshot = live ? await new Dashboard().collect(true) : sampleSnapshot();

if (readme) {
  const images = path.resolve("docs/images");
  const heroOutput = path.join(images, "hero.png");
  const statusOutput = path.join(images, "status-states.png");
  const infoBarOutput = path.join(images, "infobar-pages.png");
  await writeHero(snapshot, heroOutput);
  await writeStatusGallery(snapshot, statusOutput);
  await writeInfoBarGallery(snapshot, infoBarOutput);
  console.log(heroOutput);
  console.log(statusOutput);
  console.log(infoBarOutput);
} else {
  await writeDeckPreview(snapshot, DEFAULT_CONFIG.infoBar.indexOf("all"), output);
  console.log(output);
}

async function writeHero(data: DashboardSnapshot, file: string): Promise<void> {
  const width = 1600;
  const height = 900;
  const device = await renderDevice(data, DEFAULT_CONFIG.infoBar.indexOf("all"), 1.18);
  const background = svg(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#070912"/>
          <stop offset="0.52" stop-color="#101426"/>
          <stop offset="1" stop-color="#071018"/>
        </linearGradient>
        <radialGradient id="blue" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#38bdf8" stop-opacity=".22"/>
          <stop offset="1" stop-color="#38bdf8" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="violet" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#a78bfa" stop-opacity=".20"/>
          <stop offset="1" stop-color="#a78bfa" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#38bdf8"/>
          <stop offset="1" stop-color="#a78bfa"/>
        </linearGradient>
      </defs>
      <rect width="1600" height="900" fill="url(#bg)"/>
      <ellipse cx="1350" cy="160" rx="620" ry="500" fill="url(#violet)"/>
      <ellipse cx="790" cy="870" rx="760" ry="430" fill="url(#blue)"/>
      <g opacity=".16" stroke="#94a3b8" stroke-width="1">
        <path d="M0 720 H1600"/><path d="M0 785 H1600"/><path d="M0 850 H1600"/>
        <path d="M760 0 V900"/><path d="M900 0 V900"/><path d="M1040 0 V900"/>
        <path d="M1180 0 V900"/><path d="M1320 0 V900"/><path d="M1460 0 V900"/>
      </g>
      <rect x="90" y="94" width="58" height="6" rx="3" fill="url(#line)"/>
      <text x="90" y="142" fill="#b9c5d6" font-family="Arial,sans-serif" font-size="21" font-weight="700" letter-spacing="4">NEO AGENT DECK</text>
      <text x="90" y="245" fill="#f8fafc" font-family="Arial,sans-serif" font-size="70" font-weight="800">
        <tspan x="90" dy="0">Every agent.</tspan><tspan x="90" dy="78">One glance.</tspan>
      </text>
      <text x="94" y="444" fill="#9ba9bd" font-family="Arial,sans-serif" font-size="24">
        <tspan x="94" dy="0">Claude Code, Codex and OpenCode.</tspan>
        <tspan x="94" dy="37">Live status and usage on your desk.</tspan>
      </text>
      <g transform="translate(92 560)">
        <rect width="410" height="54" rx="27" fill="#ffffff" fill-opacity=".055" stroke="#ffffff" stroke-opacity=".12"/>
        <circle cx="30" cy="27" r="6" fill="#34d399"/>
        <text x="52" y="34" fill="#cbd5e1" font-family="Arial,sans-serif" font-size="17" font-weight="700" letter-spacing="1.7">LOCAL  ·  PRIVATE  ·  LIVE</text>
      </g>
      <text x="94" y="779" fill="#65738a" font-family="Arial,sans-serif" font-size="16" letter-spacing="1.4">BUILT FOR ELGATO STREAM DECK NEO</text>
    </svg>`);

  await writePng(
    width,
    height,
    background,
    [{ input: device, left: 620, top: 122 }],
    file
  );
}

async function writeStatusGallery(data: DashboardSnapshot, file: string): Promise<void> {
  const width = 1400;
  const height = 760;
  const buffers = await renderDeckBuffers(data, DEFAULT_CONFIG.infoBar.indexOf("all"), DEFAULT_CONFIG);
  const keys = await Promise.all(buffers.slice(0, 3).map((buffer) => rawKeyToPng(buffer, 2.2)));
  const background = svg(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#080b14"/><stop offset=".55" stop-color="#111629"/><stop offset="1" stop-color="#08121a"/>
        </linearGradient>
        <radialGradient id="glow"><stop offset="0" stop-color="#7c3aed" stop-opacity=".16"/><stop offset="1" stop-color="#7c3aed" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="1400" height="760" fill="url(#bg)"/>
      <ellipse cx="700" cy="620" rx="700" ry="350" fill="url(#glow)"/>
      <text x="700" y="92" text-anchor="middle" fill="#f8fafc" font-family="Arial,sans-serif" font-size="42" font-weight="800">Know what needs you.</text>
      <text x="700" y="137" text-anchor="middle" fill="#8492a7" font-family="Arial,sans-serif" font-size="20">Three states. One unmistakable signal.</text>
      <g fill="none" stroke="#ffffff" stroke-opacity=".09"><rect x="112" y="202" width="354" height="422" rx="34"/><rect x="523" y="202" width="354" height="422" rx="34"/><rect x="934" y="202" width="354" height="422" rx="34"/></g>
      <g font-family="Arial,sans-serif" text-anchor="middle">
        <text x="289" y="488" fill="#34d399" font-size="20" font-weight="800" letter-spacing="2.5">WORKING</text>
        <text x="289" y="526" fill="#cbd5e1" font-size="17">An agent is actively processing.</text>
        <text x="700" y="488" fill="#ffb020" font-size="20" font-weight="800" letter-spacing="2.5">NEED YOU</text>
        <text x="700" y="526" fill="#cbd5e1" font-size="17">A completed turn awaits attention.</text>
        <text x="1111" y="488" fill="#91a0b5" font-size="20" font-weight="800" letter-spacing="2.5">IDLE</text>
        <text x="1111" y="526" fill="#cbd5e1" font-size="17">No active or unacknowledged work.</text>
      </g>
      <g fill="#69778d" font-family="Arial,sans-serif" font-size="14" text-anchor="middle" letter-spacing="1.2">
        <text x="289" y="578">LIVE BACKEND STATE</text><text x="700" y="578">TAP TO ACKNOWLEDGE</text><text x="1111" y="578">READY WHEN YOU ARE</text>
      </g>
    </svg>`);
  const positions = [183, 594, 1005];
  const composites = keys.map((input, index) => ({ input, left: positions[index], top: 245 }));
  await writePng(width, height, background, composites, file);
}

async function writeInfoBarGallery(data: DashboardSnapshot, file: string): Promise<void> {
  const width = 1400;
  const height = 820;
  const names = ["CLAUDE", "CODEX", "OPENCODE", "ALL AGENTS"];
  const descriptions = ["5H + 7D PLAN USAGE", "5H + 1W RATE LIMITS", "24H + 7D LOCAL TOKENS", "OPEN + WORK + NEED YOU"];
  const bars: Buffer[] = [];
  for (let page = 0; page < DEFAULT_CONFIG.infoBar.length; page += 1) {
    const buffers = await renderDeckBuffers(data, page, DEFAULT_CONFIG);
    bars.push(await rawInfoBarToPng(buffers[8], 1.75));
  }
  const background = svg(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#070a12"/><stop offset=".5" stop-color="#12172a"/><stop offset="1" stop-color="#081017"/></linearGradient>
        <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#f59e67"/><stop offset=".36" stop-color="#55b7ff"/><stop offset=".72" stop-color="#b69cff"/><stop offset="1" stop-color="#34d399"/></linearGradient>
      </defs>
      <rect width="1400" height="820" fill="url(#bg)"/>
      <rect x="560" y="80" width="280" height="5" rx="2.5" fill="url(#accent)"/>
      <text x="700" y="142" text-anchor="middle" fill="#f8fafc" font-family="Arial,sans-serif" font-size="42" font-weight="800">One InfoBar. Four live views.</text>
      <text x="700" y="185" text-anchor="middle" fill="#8492a7" font-family="Arial,sans-serif" font-size="19">Cycle with the info key or Neo touch points.</text>
      <g fill="#ffffff" fill-opacity=".035" stroke="#ffffff" stroke-opacity=".09">
        <rect x="95" y="242" width="575" height="214" rx="28"/><rect x="730" y="242" width="575" height="214" rx="28"/>
        <rect x="95" y="496" width="575" height="214" rx="28"/><rect x="730" y="496" width="575" height="214" rx="28"/>
      </g>
      <g font-family="Arial,sans-serif">
        ${names.map((name, index) => {
          const left = index % 2 === 0 ? 126 : 761;
          const top = index < 2 ? 278 : 532;
          return `<text x="${left}" y="${top}" fill="#f1f5f9" font-size="18" font-weight="800" letter-spacing="1.6">${name}</text><text x="${left}" y="${top + 27}" fill="#66758c" font-size="12" font-weight="700" letter-spacing="1.1">${descriptions[index]}</text>`;
        }).join("")}
      </g>
    </svg>`);
  const positions = [
    { left: 126, top: 330 }, { left: 761, top: 330 },
    { left: 126, top: 584 }, { left: 761, top: 584 }
  ];
  const composites = bars.map((input, index) => ({ input, ...positions[index] }));
  await writePng(width, height, background, composites, file);
}

async function writeDeckPreview(data: DashboardSnapshot, page: number, file: string): Promise<void> {
  const device = await renderDevice(data, page, 1);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp(device).png().toFile(file);
}

async function renderDevice(data: DashboardSnapshot, page: number, scale: number): Promise<Buffer> {
  const buffers = await renderDeckBuffers(data, page, DEFAULT_CONFIG);
  const keySize = 134;
  const gap = 22;
  const keys = await Promise.all(buffers.slice(0, 8).map((buffer) => rawKeyToPng(buffer, keySize / 96)));
  const infoBar = await rawInfoBarToPng(buffers[8], 1.55);
  const shell = svg(`
    <svg xmlns="http://www.w3.org/2000/svg" width="840" height="624">
      <defs>
        <linearGradient id="body" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#2b303b"/><stop offset=".13" stop-color="#161a22"/><stop offset="1" stop-color="#080a0f"/></linearGradient>
        <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#64748b" stop-opacity=".42"/><stop offset=".4" stop-color="#ffffff" stop-opacity=".05"/><stop offset="1" stop-color="#020308"/></linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="160%"><feGaussianBlur stdDeviation="22"/></filter>
      </defs>
      <ellipse cx="420" cy="567" rx="370" ry="40" fill="#000" opacity=".62" filter="url(#shadow)"/>
      <rect x="38" y="26" width="764" height="548" rx="54" fill="url(#edge)"/>
      <rect x="40" y="28" width="760" height="544" rx="52" fill="url(#body)"/>
      <rect x="48" y="36" width="744" height="528" rx="46" fill="none" stroke="#ffffff" stroke-opacity=".08"/>
      <text x="420" y="548" text-anchor="middle" fill="#5e6878" font-family="Arial,sans-serif" font-size="11" font-weight="700" letter-spacing="3">STREAM DECK NEO</text>
      <g fill="#aab5c6"><path d="M116 473 l10 -10 l4 4 l-6 6 l6 6 l-4 4z"/><path d="M714 473 l-10 -10 l-4 4 l6 6 l-6 6 l4 4z"/></g>
      <g fill="none" stroke="#ffffff" stroke-opacity=".08"><circle cx="123" cy="473" r="28"/><circle cx="707" cy="473" r="28"/></g>
    </svg>`);
  const composites: sharp.OverlayOptions[] = keys.map((input, index) => ({
    input,
    left: 77 + (index % 4) * (keySize + gap),
    top: 67 + Math.floor(index / 4) * (keySize + gap)
  }));
  composites.push({ input: infoBar, left: 228, top: 428 });
  const device = await sharp(shell).composite(composites).png().toBuffer();
  if (scale === 1) return device;
  return sharp(device).resize(Math.round(840 * scale), Math.round(624 * scale)).png().toBuffer();
}

async function rawKeyToPng(buffer: Buffer, scale: number): Promise<Buffer> {
  return sharp(buffer, { raw: { width: 96, height: 96, channels: 4 } }).resize(Math.round(96 * scale), Math.round(96 * scale)).png().toBuffer();
}

async function rawInfoBarToPng(buffer: Buffer, scale: number): Promise<Buffer> {
  return sharp(buffer, { raw: { width: 248, height: 58, channels: 4 } }).resize(Math.round(248 * scale), Math.round(58 * scale)).png().toBuffer();
}

async function writePng(width: number, height: number, background: Buffer, composites: sharp.OverlayOptions[], file: string): Promise<void> {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp({ create: { width, height, channels: 4, background: "#070912" } })
    .composite([{ input: background, left: 0, top: 0 }, ...composites])
    .flatten({ background: "#070912" })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(file);
}

function svg(markup: string): Buffer {
  return Buffer.from(markup);
}

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
  const codexUsage: UsageSnapshot = { provider: "codex", windows: [{ label: "5h", percent: 17, resetsAt: null }, { label: "1w", percent: 25, resetsAt: null }], updatedAt: Date.now(), error: null };
  const opencodeUsage: UsageSnapshot = { provider: "opencode", windows: [{ label: "24h", value: 473_000, unit: "tokens", resetsAt: null }, { label: "7d", value: 5_180_000, unit: "tokens", resetsAt: null }], costUsd: 3.84, updatedAt: Date.now(), error: null };
  const providers = {
    claude: summarizeProvider("claude", { sessions: [session("claude", "1", "working"), session("claude", "2", "idle", true)], usage: claudeUsage }),
    codex: summarizeProvider("codex", { sessions: [session("codex", "1", "attention"), session("codex", "2", "idle")], usage: codexUsage }),
    opencode: summarizeProvider("opencode", { sessions: [session("opencode", "1", "idle", true)], usage: opencodeUsage })
  };
  const all = Object.values(providers).flatMap((provider) => provider.sessions);
  return { providers, openCount: all.filter((item) => item.isOpen).length, workingCount: all.filter((item) => item.state === "working").length, attentionCount: all.filter((item) => item.state === "attention").length, updatedAt: Date.now() };
}
