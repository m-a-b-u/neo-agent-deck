import sharp from "sharp";
import type { DeckConfig, KeyModule } from "./config.js";
import type { DashboardSnapshot, Provider, ProviderSnapshot, UsageSnapshot, UsageWindow } from "./types.js";

const KEY_SIZE = 96;
const BAR_WIDTH = 248;
const BAR_HEIGHT = 58;

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

export async function renderDeckBuffers(snapshot: DashboardSnapshot, page: number, config: DeckConfig): Promise<Buffer[]> {
  const buffers: Buffer[] = [];
  for (let index = 0; index < 8; index += 1) {
    buffers.push(await renderKeyModule(snapshot, config.keys[index] ?? "blank", page, config));
  }
  buffers.push(await renderInfoBar(snapshot, page, config));
  return buffers;
}

async function renderKeyModule(snapshot: DashboardSnapshot, module: KeyModule, page: number, config: DeckConfig): Promise<Buffer> {
  switch (module) {
    case "claude.status":
      return renderProviderKey(snapshot.providers.claude);
    case "codex.status":
      return renderProviderKey(snapshot.providers.codex);
    case "opencode.status":
      return renderProviderKey(snapshot.providers.opencode);
    case "claude.usage":
      return renderUsageKey(snapshot.providers.claude.usage);
    case "codex.usage":
      return renderUsageKey(snapshot.providers.codex.usage);
    case "opencode.usage":
      return renderUsageKey(snapshot.providers.opencode.usage);
    case "summary":
      return renderSummaryKey(snapshot);
    case "info":
      return renderInfoKey(page, config.infoBar.length);
    case "blank":
    default:
      return renderBlankKey();
  }
}

export async function renderProviderKey(provider: ProviderSnapshot): Promise<Buffer> {
  const brand = brands[provider.provider];
  const state = states[provider.state];
  const detail = provider.state === "attention"
    ? `${provider.attentionCount} attention`
    : provider.state === "working"
      ? `${provider.workingCount} active`
      : `${provider.openCount} open`;
  const footer = provider.state === "attention" ? "tap to acknowledge" : "live backend";
  return svgToRgba(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="15" fill="${state.background}"/><circle cx="13" cy="13" r="4" fill="${state.accent}"/><text x="48" y="24" text-anchor="middle" fill="#f3f6fa" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="11" font-weight="800">${brand.name}</text><text x="48" y="54" text-anchor="middle" fill="${state.accent}" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="14" font-weight="900">${state.label}</text><text x="48" y="76" text-anchor="middle" fill="#c6d0dc" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="9" font-weight="600">${escapeXml(detail)}</text><text x="48" y="89" text-anchor="middle" fill="#718095" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="7">${footer}</text></svg>`, KEY_SIZE, KEY_SIZE);
}

export async function renderUsageKey(usage: UsageSnapshot): Promise<Buffer> {
  const brand = brands[usage.provider];
  const primary = usage.windows.at(-1) || usage.windows[0];
  const isQuota = typeof primary?.percent === "number";
  const headline = primary ? formatUsageValue(primary) : "--";
  const label = primary?.label || "usage";
  const subtitle = usage.error && !usage.windows.length
    ? "data unavailable"
    : isQuota ? `${label} used` : `${label} tokens`;
  const width = isQuota ? Math.round(70 * Number(primary?.percent) / 100) : 70;
  const footer = usage.provider === "opencode" ? `${formatCurrency(usage.costUsd || 0)} / 7d` : subtitle;
  return svgToRgba(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="15" fill="${brand.background}"/><circle cx="14" cy="14" r="4" fill="${brand.accent}"/><text x="48" y="25" text-anchor="middle" fill="#f7fafc" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="11" font-weight="800">${brand.name}</text><text x="48" y="59" text-anchor="middle" fill="${brand.accent}" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="24" font-weight="800">${escapeXml(headline)}</text><rect x="13" y="69" width="70" height="6" rx="3" fill="#ffffff24"/><rect x="13" y="69" width="${Math.max(0, Math.min(70, width))}" height="6" rx="3" fill="${brand.accent}"/><text x="48" y="88" text-anchor="middle" fill="#bdc8d6" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="9">${escapeXml(footer)}</text></svg>`, KEY_SIZE, KEY_SIZE);
}

export async function renderSummaryKey(snapshot: DashboardSnapshot): Promise<Buffer> {
  const attention = snapshot.attentionCount > 0;
  const background = attention ? "#3c2710" : "#202339";
  return svgToRgba(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="15" fill="${background}"/><text x="48" y="23" text-anchor="middle" fill="#c9d2ff" font-family="-apple-system,sans-serif" font-size="11" font-weight="800">ALL AGENTS</text><text x="31" y="55" text-anchor="middle" fill="#71c7ff" font-family="-apple-system,sans-serif" font-size="22" font-weight="900">${snapshot.openCount}</text><text x="67" y="55" text-anchor="middle" fill="#ffb020" font-family="-apple-system,sans-serif" font-size="22" font-weight="900">${snapshot.attentionCount}</text><text x="31" y="72" text-anchor="middle" fill="#aab6c7" font-family="-apple-system,sans-serif" font-size="8">OPEN</text><text x="67" y="72" text-anchor="middle" fill="#aab6c7" font-family="-apple-system,sans-serif" font-size="8">NEED YOU</text><text x="48" y="88" text-anchor="middle" fill="#717f94" font-family="-apple-system,sans-serif" font-size="8">tap overview</text></svg>`, KEY_SIZE, KEY_SIZE);
}

export async function renderInfoKey(page: number, total: number): Promise<Buffer> {
  return svgToRgba(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="15" fill="#251d45"/><circle cx="48" cy="42" r="23" fill="none" stroke="#a78bfa" stroke-width="4"/><text x="48" y="51" text-anchor="middle" fill="#d9ceff" font-family="Georgia,serif" font-size="28" font-weight="700">i</text><text x="48" y="82" text-anchor="middle" fill="#a99bcf" font-family="-apple-system,sans-serif" font-size="10" font-weight="700">INFO ${page + 1}/${total}</text></svg>`, KEY_SIZE, KEY_SIZE);
}

export async function renderBlankKey(): Promise<Buffer> {
  return svgToRgba(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="15" fill="#14171f"/></svg>`, KEY_SIZE, KEY_SIZE);
}

export async function renderInfoBar(snapshot: DashboardSnapshot, page: number, config: DeckConfig): Promise<Buffer> {
  const module = config.infoBar[page] ?? config.restingPage;
  if (module === "claude" || module === "codex" || module === "opencode") return usageBar(snapshot.providers[module].usage);
  return sessionsBar(snapshot);
}

async function usageBar(usage: UsageSnapshot): Promise<Buffer> {
  const brand = brands[usage.provider];
  const first = usage.windows[0] || { label: "--", value: 0, resetsAt: null };
  const second = usage.windows[1] || first;
  const caption = usage.provider === "opencode" ? "local token usage" : "live plan usage";
  return svgToRgba(`<svg xmlns="http://www.w3.org/2000/svg" width="248" height="58"><rect width="248" height="58" rx="9" fill="${brand.background}"/><circle cx="13" cy="12" r="4" fill="${brand.accent}"/><text x="23" y="17" fill="#f5f7fb" font-family="-apple-system,sans-serif" font-size="13" font-weight="900">${brand.name}</text><text x="94" y="17" fill="#aeb9c8" font-family="-apple-system,sans-serif" font-size="9">${caption}</text>${usageMetric(12, 30, first, brand.accent)}${usageMetric(134, 30, second, brand.accent)}</svg>`, BAR_WIDTH, BAR_HEIGHT);
}

function usageMetric(x: number, y: number, window: UsageWindow, accent: string): string {
  const value = formatUsageValue(window);
  if (typeof window.percent !== "number") {
    return `<text x="${x}" y="${y}" fill="#cbd4df" font-family="-apple-system,sans-serif" font-size="9" font-weight="700">${escapeXml(window.label.toUpperCase())}</text><text x="${x}" y="${y + 20}" fill="${accent}" font-family="-apple-system,sans-serif" font-size="17" font-weight="900">${escapeXml(value)}</text><text x="${x + 49}" y="${y + 19}" fill="#9eabba" font-family="-apple-system,sans-serif" font-size="8">TOKENS</text>`;
  }
  const width = Math.round(70 * window.percent / 100);
  return `<text x="${x}" y="${y}" fill="#cbd4df" font-family="-apple-system,sans-serif" font-size="9" font-weight="700">${escapeXml(window.label.toUpperCase())}</text><text x="${x + 70}" y="${y}" text-anchor="end" fill="${accent}" font-family="-apple-system,sans-serif" font-size="11" font-weight="900">${escapeXml(value)}</text><rect x="${x}" y="${y + 7}" width="70" height="6" rx="3" fill="#ffffff24"/><rect x="${x}" y="${y + 7}" width="${Math.max(0, Math.min(70, width))}" height="6" rx="3" fill="${accent}"/>`;
}

async function sessionsBar(snapshot: DashboardSnapshot): Promise<Buffer> {
  return svgToRgba(`<svg xmlns="http://www.w3.org/2000/svg" width="248" height="58"><rect width="248" height="58" rx="9" fill="#171b2d"/><text x="13" y="19" fill="#e8ecff" font-family="-apple-system,sans-serif" font-size="13" font-weight="900">ALL AGENTS</text><text x="97" y="18" fill="#8e9bb0" font-family="-apple-system,sans-serif" font-size="7">Claude · Codex · OpenCode</text>${counter(18, snapshot.openCount, "OPEN", "#71c7ff")}${counter(96, snapshot.workingCount, "WORK", "#34d399")}${counter(174, snapshot.attentionCount, "NEED YOU", "#ffb020")}</svg>`, BAR_WIDTH, BAR_HEIGHT);
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

async function svgToRgba(svg: string, width: number, height: number): Promise<Buffer> {
  return sharp(Buffer.from(svg)).resize(width, height).ensureAlpha().raw().toBuffer();
}

function escapeXml(value: string): string {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" })[character] || character);
}
