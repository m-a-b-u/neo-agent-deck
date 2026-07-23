import type { Dimension } from "@elgato-stream-deck/node";
import sharp from "sharp";
import type { DeckConfig, KeyModule } from "./config.js";
import { fitLayout, infoBarSpans, NEO_PROFILE, type DeckProfile } from "./device.js";
import type { DashboardSnapshot, Provider, ProviderSnapshot, UsageSnapshot, UsageWindow } from "./types.js";

// Every module is authored on a fixed canvas and scaled to the pixel size the device reports.
const KEY_SIZE = 96;
const BAR_WIDTH = 248;
const BAR_HEIGHT = 58;
const DEFAULT_KEY_SIZE: Dimension = { width: KEY_SIZE, height: KEY_SIZE };
const DEFAULT_BAR_SIZE: Dimension = { width: BAR_WIDTH, height: BAR_HEIGHT };
// Below this the 7-8px hint lines turn to mush, so they are dropped instead of rendered unreadable.
const HINT_MIN_HEIGHT = 80;

const brands: Record<Provider, { name: string; background: string; accent: string }> = {
  claude: { name: "CLAUDE", background: "#311b16", accent: "#f59e67" },
  codex: { name: "CODEX", background: "#10283d", accent: "#55b7ff" },
  opencode: { name: "OPENCODE", background: "#241b3d", accent: "#b69cff" }
};

const states = {
  working: { background: "#0c3629", accent: "#34d399", label: "WORKING" },
  idle: { background: "#222934", accent: "#91a0b5", label: "IDLE" },
  attention: { background: "#4a2b09", accent: "#ffb020", label: "NEED YOU" }
};

/** Keys in device index order, followed by the InfoBar strip when the device has an LCD segment. */
export async function renderDeckBuffers(snapshot: DashboardSnapshot, page: number, config: DeckConfig, profile: DeckProfile = NEO_PROFILE): Promise<Buffer[]> {
  const layout = fitLayout(config.keys, profile);
  const tiles = new Map<number, Buffer>();
  for (const span of infoBarSpans(layout, profile)) {
    const rendered = await renderInfoBarTiles(snapshot, page, config, span.length, span[0].pixelSize);
    span.forEach((key, index) => tiles.set(key.index, rendered[index]));
  }
  const buffers: Buffer[] = [];
  for (const key of profile.keys) {
    buffers.push(tiles.get(key.index) ?? (await renderKeyModule(snapshot, layout[key.index] ?? "blank", page, config, key.pixelSize)));
  }
  if (profile.lcd) buffers.push(await renderInfoBar(snapshot, page, config, profile.lcd.pixelSize));
  return buffers;
}

async function renderKeyModule(snapshot: DashboardSnapshot, module: KeyModule, page: number, config: DeckConfig, size: Dimension): Promise<Buffer> {
  switch (module) {
    case "claude.status":
      return renderProviderKey(snapshot.providers.claude, size);
    case "codex.status":
      return renderProviderKey(snapshot.providers.codex, size);
    case "opencode.status":
      return renderProviderKey(snapshot.providers.opencode, size);
    case "claude.usage":
      return renderUsageKey(snapshot.providers.claude.usage, size);
    case "codex.usage":
      return renderUsageKey(snapshot.providers.codex.usage, size);
    case "opencode.usage":
      return renderUsageKey(snapshot.providers.opencode.usage, size);
    case "summary":
      return renderSummaryKey(snapshot, size);
    case "info":
      return renderInfoKey(page, config.infoBar.length, size);
    case "blank":
    default:
      return renderBlankKey(size);
  }
}

interface InfoTile {
  title: string;
  value: string;
  caption?: string;
  percent?: number;
  accent: string;
  head?: boolean;
}

/**
 * The InfoBar spread over a run of keys. Slicing the 248x58 strip would cut words at the
 * physical gaps, so each key carries one self-contained block of the same page instead.
 */
export async function renderInfoBarTiles(snapshot: DashboardSnapshot, page: number, config: DeckConfig, count: number, keySize: Dimension): Promise<Buffer[]> {
  const { background, tiles } = infoTiles(snapshot, page, config);
  const buffers: Buffer[] = [];
  for (let index = 0; index < count; index += 1) {
    buffers.push(await renderInfoTile(tiles[index], background, index === 0, index === count - 1, keySize));
  }
  return buffers;
}

function infoTiles(snapshot: DashboardSnapshot, page: number, config: DeckConfig): { background: string; tiles: InfoTile[] } {
  const module = config.infoBar[page] ?? config.restingPage;
  if (module !== "claude" && module !== "codex" && module !== "opencode") {
    return {
      background: "#171b2d",
      tiles: [
        { title: "", value: "ALL AGENTS", caption: "all providers", accent: "#e8ecff", head: true },
        { title: "OPEN", value: String(snapshot.openCount), accent: "#71c7ff" },
        { title: "WORK", value: String(snapshot.workingCount), accent: "#34d399" },
        { title: "NEED YOU", value: String(snapshot.attentionCount), accent: "#ffb020" }
      ]
    };
  }
  const usage = snapshot.providers[module].usage;
  const brand = brands[usage.provider];
  const caption = usage.error
    ? (usage.windows.length ? "stale data" : "unavailable")
    : usage.provider === "opencode" ? "local tokens" : "live plan usage";
  const tiles: InfoTile[] = [{ title: "", value: brand.name, caption, accent: brand.accent, head: true }];
  for (const window of usage.windows.slice(0, 2)) {
    tiles.push({ title: window.label.toUpperCase(), value: formatUsageValue(window), percent: window.percent, accent: brand.accent });
  }
  if (usage.provider === "opencode") tiles.push({ title: "COST", value: formatCurrency(usage.costUsd || 0), caption: "7 days", accent: brand.accent });
  return { background: brand.background, tiles };
}

async function renderInfoTile(tile: InfoTile | undefined, background: string, first: boolean, last: boolean, size: Dimension): Promise<Buffer> {
  // Square off the inner edges so a run of tiles reads as one panel.
  const radius = 15;
  const shape = `<rect x="${first ? 0 : -radius}" y="0" width="${96 + (first ? 0 : radius) + (last ? 0 : radius)}" height="96" rx="${radius}" fill="${background}"/>`;
  if (!tile) return keyToRgba(shape, size);
  if (tile.head) {
    const caption = tile.caption && size.height >= HINT_MIN_HEIGHT
      ? `<text x="48" y="72" text-anchor="middle" fill="#8e9bb0" font-family="-apple-system,sans-serif" font-size="8">${escapeXml(tile.caption)}</text>`
      : "";
    return keyToRgba(`${shape}<circle cx="16" cy="16" r="4" fill="${tile.accent}"/><text x="48" y="52" text-anchor="middle" fill="${tile.accent}" font-family="-apple-system,sans-serif" font-size="${tile.value.length > 8 ? 13 : 16}" font-weight="900">${escapeXml(tile.value)}</text>${caption}`, size);
  }
  const bar = typeof tile.percent === "number"
    ? `<rect x="13" y="72" width="70" height="6" rx="3" fill="#ffffff24"/><rect x="13" y="72" width="${Math.max(0, Math.min(70, Math.round(70 * tile.percent / 100)))}" height="6" rx="3" fill="${tile.accent}"/>`
    : "";
  const caption = tile.caption && size.height >= HINT_MIN_HEIGHT
    ? `<text x="48" y="80" text-anchor="middle" fill="#8e9bb0" font-family="-apple-system,sans-serif" font-size="8">${escapeXml(tile.caption)}</text>`
    : "";
  return keyToRgba(`${shape}<text x="48" y="26" text-anchor="middle" fill="#cbd4df" font-family="-apple-system,sans-serif" font-size="10" font-weight="700">${escapeXml(tile.title)}</text><text x="48" y="60" text-anchor="middle" fill="${tile.accent}" font-family="-apple-system,sans-serif" font-size="${tile.value.length > 4 ? 22 : 28}" font-weight="900">${escapeXml(tile.value)}</text>${bar}${caption}`, size);
}

export async function renderProviderKey(provider: ProviderSnapshot, size: Dimension = DEFAULT_KEY_SIZE): Promise<Buffer> {
  const brand = brands[provider.provider];
  const state = states[provider.state];
  const detail = provider.state === "attention"
    ? `${provider.attentionCount} attention`
    : provider.state === "working"
      ? `${provider.workingCount} active`
      : `${provider.openCount} open`;
  const footer = provider.state === "attention" ? "tap to acknowledge" : "live backend";
  const hint = size.height < HINT_MIN_HEIGHT
    ? ""
    : `<text x="48" y="89" text-anchor="middle" fill="#718095" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="7">${footer}</text>`;
  return keyToRgba(`<rect width="96" height="96" rx="15" fill="${state.background}"/><circle cx="13" cy="13" r="4" fill="${state.accent}"/><text x="48" y="24" text-anchor="middle" fill="#f3f6fa" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="11" font-weight="800">${brand.name}</text><text x="48" y="54" text-anchor="middle" fill="${state.accent}" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="14" font-weight="900">${state.label}</text><text x="48" y="76" text-anchor="middle" fill="#c6d0dc" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="9" font-weight="600">${escapeXml(detail)}</text>${hint}`, size);
}

export async function renderUsageKey(usage: UsageSnapshot, size: Dimension = DEFAULT_KEY_SIZE): Promise<Buffer> {
  const brand = brands[usage.provider];
  const primary = usage.windows.at(-1) || usage.windows[0];
  const isQuota = typeof primary?.percent === "number";
  const headline = primary ? formatUsageValue(primary) : "--";
  const label = primary?.label || "usage";
  const subtitle = usage.error && !usage.windows.length
    ? "data unavailable"
    : isQuota ? `${label} used` : `${label} tokens`;
  const width = isQuota ? Math.round(70 * Number(primary?.percent) / 100) : 70;
  const footer = usage.error
    ? (usage.windows.length ? "stale · tap refresh" : "data unavailable")
    : usage.provider === "opencode" ? `${formatCurrency(usage.costUsd || 0)} / 7d` : subtitle;
  return keyToRgba(`<rect width="96" height="96" rx="15" fill="${brand.background}"/><circle cx="14" cy="14" r="4" fill="${brand.accent}"/><text x="48" y="25" text-anchor="middle" fill="#f7fafc" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="11" font-weight="800">${brand.name}</text><text x="48" y="59" text-anchor="middle" fill="${brand.accent}" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="24" font-weight="800">${escapeXml(headline)}</text><rect x="13" y="69" width="70" height="6" rx="3" fill="#ffffff24"/><rect x="13" y="69" width="${Math.max(0, Math.min(70, width))}" height="6" rx="3" fill="${brand.accent}"/><text x="48" y="88" text-anchor="middle" fill="#bdc8d6" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="9">${escapeXml(footer)}</text>`, size);
}

export async function renderSummaryKey(snapshot: DashboardSnapshot, size: Dimension = DEFAULT_KEY_SIZE): Promise<Buffer> {
  const attention = snapshot.attentionCount > 0;
  const background = attention ? "#3c2710" : "#202339";
  const hint = size.height < HINT_MIN_HEIGHT
    ? ""
    : `<text x="48" y="88" text-anchor="middle" fill="#717f94" font-family="-apple-system,sans-serif" font-size="8">tap overview</text>`;
  return keyToRgba(`<rect width="96" height="96" rx="15" fill="${background}"/><text x="48" y="23" text-anchor="middle" fill="#c9d2ff" font-family="-apple-system,sans-serif" font-size="11" font-weight="800">ALL AGENTS</text><text x="31" y="55" text-anchor="middle" fill="#71c7ff" font-family="-apple-system,sans-serif" font-size="22" font-weight="900">${snapshot.openCount}</text><text x="67" y="55" text-anchor="middle" fill="#ffb020" font-family="-apple-system,sans-serif" font-size="22" font-weight="900">${snapshot.attentionCount}</text><text x="31" y="72" text-anchor="middle" fill="#aab6c7" font-family="-apple-system,sans-serif" font-size="8">OPEN</text><text x="67" y="72" text-anchor="middle" fill="#aab6c7" font-family="-apple-system,sans-serif" font-size="8">NEED YOU</text>${hint}`, size);
}

export async function renderInfoKey(page: number, total: number, size: Dimension = DEFAULT_KEY_SIZE): Promise<Buffer> {
  return keyToRgba(`<rect width="96" height="96" rx="15" fill="#251d45"/><circle cx="48" cy="42" r="23" fill="none" stroke="#a78bfa" stroke-width="4"/><text x="48" y="51" text-anchor="middle" fill="#d9ceff" font-family="Georgia,serif" font-size="28" font-weight="700">i</text><text x="48" y="82" text-anchor="middle" fill="#a99bcf" font-family="-apple-system,sans-serif" font-size="10" font-weight="700">INFO ${page + 1}/${total}</text>`, size);
}

export async function renderBlankKey(size: Dimension = DEFAULT_KEY_SIZE): Promise<Buffer> {
  return keyToRgba(`<rect width="96" height="96" rx="15" fill="#14171f"/>`, size);
}

export async function renderInfoBar(snapshot: DashboardSnapshot, page: number, config: DeckConfig, size: Dimension = DEFAULT_BAR_SIZE): Promise<Buffer> {
  const module = config.infoBar[page] ?? config.restingPage;
  if (module === "claude" || module === "codex" || module === "opencode") return usageBar(snapshot.providers[module].usage, size);
  return sessionsBar(snapshot, size);
}

async function usageBar(usage: UsageSnapshot, size: Dimension): Promise<Buffer> {
  const brand = brands[usage.provider];
  const first = usage.windows[0] || { label: "--", value: 0, resetsAt: null };
  const second = usage.windows[1] || first;
  const caption = usage.error
    ? (usage.windows.length ? "last known · refresh failed" : "data unavailable")
    : usage.provider === "opencode" ? "local token usage" : "live plan usage";
  return barToRgba(`<rect width="248" height="58" rx="9" fill="${brand.background}"/><circle cx="13" cy="12" r="4" fill="${brand.accent}"/><text x="23" y="17" fill="#f5f7fb" font-family="-apple-system,sans-serif" font-size="13" font-weight="900">${brand.name}</text><text x="236" y="17" text-anchor="end" fill="#aeb9c8" font-family="-apple-system,sans-serif" font-size="8">${caption}</text>${usageMetric(12, 30, first, brand.accent)}${usageMetric(134, 30, second, brand.accent)}`, size);
}

function usageMetric(x: number, y: number, window: UsageWindow, accent: string): string {
  const value = formatUsageValue(window);
  if (typeof window.percent !== "number") {
    return `<text x="${x}" y="${y}" fill="#cbd4df" font-family="-apple-system,sans-serif" font-size="9" font-weight="700">${escapeXml(window.label.toUpperCase())}</text><text x="${x}" y="${y + 20}" fill="${accent}" font-family="-apple-system,sans-serif" font-size="17" font-weight="900">${escapeXml(value)}</text><text x="${x + 49}" y="${y + 19}" fill="#9eabba" font-family="-apple-system,sans-serif" font-size="8">TOKENS</text>`;
  }
  const width = Math.round(70 * window.percent / 100);
  return `<text x="${x}" y="${y}" fill="#cbd4df" font-family="-apple-system,sans-serif" font-size="9" font-weight="700">${escapeXml(window.label.toUpperCase())}</text><text x="${x + 70}" y="${y}" text-anchor="end" fill="${accent}" font-family="-apple-system,sans-serif" font-size="11" font-weight="900">${escapeXml(value)}</text><rect x="${x}" y="${y + 7}" width="70" height="6" rx="3" fill="#ffffff24"/><rect x="${x}" y="${y + 7}" width="${Math.max(0, Math.min(70, width))}" height="6" rx="3" fill="${accent}"/>`;
}

async function sessionsBar(snapshot: DashboardSnapshot, size: Dimension): Promise<Buffer> {
  return barToRgba(`<rect width="248" height="58" rx="9" fill="#171b2d"/><text x="13" y="19" fill="#e8ecff" font-family="-apple-system,sans-serif" font-size="13" font-weight="900">ALL AGENTS</text><text x="235" y="18" text-anchor="end" fill="#8e9bb0" font-family="-apple-system,sans-serif" font-size="7">Claude · Codex · OpenCode</text>${counter(18, snapshot.openCount, "OPEN", "#71c7ff")}${counter(96, snapshot.workingCount, "WORK", "#34d399")}${counter(174, snapshot.attentionCount, "NEED YOU", "#ffb020")}`, size);
}

function counter(x: number, value: number, label: string, color: string): string {
  return `<text x="${x}" y="47" fill="${color}" font-family="-apple-system,sans-serif" font-size="22" font-weight="900">${value}</text><text x="${x + 25}" y="46" fill="#aeb8c7" font-family="-apple-system,sans-serif" font-size="8" font-weight="700">${label}</text>`;
}

export function formatCompactNumber(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `${trimDecimal(value / 1_000_000_000)}B`;
  if (absolute >= 1_000_000) return `${trimDecimal(value / 1_000_000)}M`;
  if (absolute >= 1_000) return `${trimDecimal(value / 1_000)}K`;
  return String(Math.round(value));
}

function formatUsageValue(window: UsageWindow): string {
  if (typeof window.percent === "number") return `${Math.round(window.percent)}%`;
  if (window.unit === "usd") return formatCurrency(window.value || 0);
  return formatCompactNumber(window.value || 0);
}

function formatCurrency(value: number): string {
  return `$${value < 0.01 ? value.toFixed(3) : value.toFixed(2)}`;
}

function trimDecimal(value: number): string {
  return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1).replace(/\.0$/, "") : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

async function keyToRgba(body: string, size: Dimension): Promise<Buffer> {
  return svgToRgba(`<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${KEY_SIZE} ${KEY_SIZE}">${body}</svg>`, size);
}

// The strip stretches to whatever run of keys carries it; "none" fills them edge to edge.
async function barToRgba(body: string, size: Dimension): Promise<Buffer> {
  return svgToRgba(`<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${BAR_WIDTH} ${BAR_HEIGHT}" preserveAspectRatio="none">${body}</svg>`, size);
}

async function svgToRgba(svg: string, size: Dimension): Promise<Buffer> {
  return sharp(Buffer.from(svg)).resize(size.width, size.height, { fit: "fill" }).ensureAlpha().raw().toBuffer();
}

function escapeXml(value: string): string {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" })[character] || character);
}
