import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type DeckConfig } from "../src/config.js";
import { KEYPAD_15_PROFILE } from "../src/device.js";
import { formatCompactNumber, renderBlankKey, renderDeckBuffers, renderInfoBar, renderInfoBarTiles, renderInfoKey, renderProviderKey, renderSummaryKey, renderUsageKey } from "../src/render.js";
import type { DashboardSnapshot, Provider, ProviderSnapshot, UsageSnapshot } from "../src/types.js";

const usage = (provider: Provider): UsageSnapshot => provider === "opencode"
  ? { provider, windows: [{ label: "24h", value: 473_000, unit: "tokens", resetsAt: null }, { label: "7d", value: 5_180_000, unit: "tokens", resetsAt: null }], costUsd: 0, updatedAt: 1, error: null }
  : { provider, windows: [{ label: provider === "claude" ? "5h" : "1w", percent: provider === "claude" ? 12 : 24, resetsAt: null }], updatedAt: 1, error: null };

const provider = (id: Provider, state: ProviderSnapshot["state"]): ProviderSnapshot => ({
  provider: id,
  state,
  sessions: [],
  usage: usage(id),
  openCount: state === "idle" ? 0 : 1,
  workingCount: state === "working" ? 1 : 0,
  attentionCount: state === "attention" ? 1 : 0,
  idleCount: state === "idle" ? 1 : 0
});

const snapshot: DashboardSnapshot = {
  providers: {
    claude: provider("claude", "working"),
    codex: provider("codex", "attention"),
    opencode: provider("opencode", "idle")
  },
  openCount: 2,
  workingCount: 1,
  attentionCount: 1,
  updatedAt: 1
};

describe("Neo rendering", () => {
  it("renders native-size RGBA status and usage buffers", async () => {
    // Production renders the small displays sequentially. Matching that path
    // avoids artificial contention during Sharp's first Windows font scan.
    const buffers = [
      await renderProviderKey(snapshot.providers.claude),
      await renderUsageKey(snapshot.providers.opencode.usage),
      await renderSummaryKey(snapshot),
      await renderInfoKey(3, 4),
      await renderBlankKey()
    ];
    for (const buffer of buffers) expect(buffer.length).toBe(96 * 96 * 4);
  }, 30_000);

  it("renders every configured InfoBar view at 248x58 RGBA", async () => {
    for (let page = 0; page < DEFAULT_CONFIG.infoBar.length; page += 1) {
      expect((await renderInfoBar(snapshot, page, DEFAULT_CONFIG)).length).toBe(248 * 58 * 4);
    }
  });

  it("renders a complete deck frame sequentially", async () => {
    const buffers = await renderDeckBuffers(snapshot, 3, DEFAULT_CONFIG);
    expect(buffers).toHaveLength(9);
    expect(buffers.slice(0, 8).every((buffer) => buffer.length === 96 * 96 * 4)).toBe(true);
    expect(buffers[8].length).toBe(248 * 58 * 4);
  });

  it("renders a custom layout with blank keys and a shorter InfoBar", async () => {
    const config: DeckConfig = {
      brightness: 40,
      keys: ["summary", "blank", "claude.usage", "info", "blank", "codex.status", "opencode.usage", "blank"],
      infoBar: ["codex", "all"],
      restingPage: "all"
    };
    const buffers = await renderDeckBuffers(snapshot, 1, config);
    expect(buffers).toHaveLength(9);
    expect(buffers.slice(0, 8).every((buffer) => buffer.length === 96 * 96 * 4)).toBe(true);
    expect(buffers[8].length).toBe(248 * 58 * 4);
  });

  it("draws different InfoBar pixels for a provider page and the all-agents page", async () => {
    const providerPage = await renderDeckBuffers(snapshot, 0, DEFAULT_CONFIG);
    const allPage = await renderDeckBuffers(snapshot, DEFAULT_CONFIG.infoBar.indexOf("all"), DEFAULT_CONFIG);
    expect(providerPage[8].length).toBe(allPage[8].length);
    expect(providerPage[8].equals(allPage[8])).toBe(false);
  });

  it("draws different usage-key pixels for 0% and 100% quota", async () => {
    const quota = (percent: number): UsageSnapshot => ({
      provider: "claude",
      windows: [{ label: "5h", percent, resetsAt: null }],
      updatedAt: 1,
      error: null
    });
    const empty = await renderUsageKey(quota(0));
    const full = await renderUsageKey(quota(100));
    expect(empty.length).toBe(full.length);
    expect(empty.equals(full)).toBe(false);
  });

  it("visually marks stale usage instead of presenting it as live", async () => {
    const live = usage("codex");
    const stale: UsageSnapshot = { ...live, error: "backend unavailable" };
    expect((await renderUsageKey(live)).equals(await renderUsageKey(stale))).toBe(false);
    expect((await renderInfoBar(snapshot, 1, DEFAULT_CONFIG)).equals(
      await renderInfoBar({
        ...snapshot,
        providers: {
          ...snapshot.providers,
          codex: { ...snapshot.providers.codex, usage: stale }
        }
      }, 1, DEFAULT_CONFIG)
    )).toBe(false);
  });

  it("formats token totals for the small display", () => {
    expect(formatCompactNumber(473_000)).toBe("473K");
    expect(formatCompactNumber(5_180_000)).toBe("5.18M");
  });
});

describe("keypad rendering", () => {
  it("renders one buffer per key at the device pixel size and no LCD buffer", async () => {
    const buffers = await renderDeckBuffers(snapshot, 3, DEFAULT_CONFIG, KEYPAD_15_PROFILE);
    expect(buffers).toHaveLength(15);
    expect(buffers.every((buffer) => buffer.length === 72 * 72 * 4)).toBe(true);
  }, 30_000);

  it("scales the same module to whatever size the device reports", async () => {
    expect((await renderProviderKey(snapshot.providers.claude, { width: 72, height: 72 })).length).toBe(72 * 72 * 4);
    expect((await renderSummaryKey(snapshot, { width: 80, height: 80 })).length).toBe(80 * 80 * 4);
    expect((await renderBlankKey({ width: 120, height: 120 })).length).toBe(120 * 120 * 4);
  });

  it("gives every InfoBar tile its own content", async () => {
    const tiles = await renderInfoBarTiles(snapshot, DEFAULT_CONFIG.infoBar.indexOf("all"), DEFAULT_CONFIG, 4, { width: 72, height: 72 });
    expect(tiles).toHaveLength(4);
    expect(tiles.every((tile) => tile.length === 72 * 72 * 4)).toBe(true);
    for (let index = 1; index < tiles.length; index += 1) {
      expect(tiles[index].equals(tiles[index - 1])).toBe(false);
    }
  });

  it("redraws the InfoBar tiles when the page changes", async () => {
    const size = { width: 72, height: 72 };
    const claudePage = await renderInfoBarTiles(snapshot, 0, DEFAULT_CONFIG, 4, size);
    const allPage = await renderInfoBarTiles(snapshot, DEFAULT_CONFIG.infoBar.indexOf("all"), DEFAULT_CONFIG, 4, size);
    expect(claudePage[0].equals(allPage[0])).toBe(false);
  });

  it("pads a tile run that is longer than the page has blocks", async () => {
    const tiles = await renderInfoBarTiles(snapshot, 0, DEFAULT_CONFIG, 5, { width: 72, height: 72 });
    expect(tiles).toHaveLength(5);
    expect(tiles.every((tile) => tile.length === 72 * 72 * 4)).toBe(true);
  });
});
