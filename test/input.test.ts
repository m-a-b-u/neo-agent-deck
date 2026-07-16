import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type DeckConfig } from "../src/config.js";
import { actionForControl } from "../src/input.js";

describe("Neo controls", () => {
  it("maps default row one to Claude, Codex, OpenCode, and All Agents", () => {
    expect(actionForControl(0, DEFAULT_CONFIG)).toEqual({ type: "acknowledge-provider", provider: "claude", forceUsage: false });
    expect(actionForControl(1, DEFAULT_CONFIG)).toEqual({ type: "acknowledge-provider", provider: "codex", forceUsage: false });
    expect(actionForControl(2, DEFAULT_CONFIG)).toEqual({ type: "acknowledge-provider", provider: "opencode", forceUsage: false });
    expect(actionForControl(3, DEFAULT_CONFIG)).toEqual({ type: "show-agents", forceUsage: true });
  });

  it("maps default row two to three usage keys and Info", () => {
    expect(actionForControl(4, DEFAULT_CONFIG)).toEqual({ type: "refresh", forceUsage: true });
    expect(actionForControl(5, DEFAULT_CONFIG)).toEqual({ type: "refresh", forceUsage: true });
    expect(actionForControl(6, DEFAULT_CONFIG)).toEqual({ type: "refresh", forceUsage: true });
    expect(actionForControl(7, DEFAULT_CONFIG)).toEqual({ type: "cycle-info", delta: 1, forceUsage: false });
  });

  it("cycles the InfoBar with both Neo touch points regardless of layout", () => {
    expect(actionForControl(8, DEFAULT_CONFIG)).toMatchObject({ type: "cycle-info", delta: -1 });
    expect(actionForControl(9, DEFAULT_CONFIG)).toMatchObject({ type: "cycle-info", delta: 1 });
  });

  it("dispatches on the configured key layout", () => {
    const config: DeckConfig = {
      ...DEFAULT_CONFIG,
      keys: ["blank", "summary", "codex.status", "info", "opencode.usage", "blank", "claude.status", "blank"]
    };
    expect(actionForControl(0, config)).toEqual({ type: "refresh", forceUsage: false });
    expect(actionForControl(1, config)).toEqual({ type: "show-agents", forceUsage: true });
    expect(actionForControl(2, config)).toEqual({ type: "acknowledge-provider", provider: "codex", forceUsage: false });
    expect(actionForControl(3, config)).toEqual({ type: "cycle-info", delta: 1, forceUsage: false });
    expect(actionForControl(4, config)).toEqual({ type: "refresh", forceUsage: true });
    expect(actionForControl(6, config)).toEqual({ type: "acknowledge-provider", provider: "claude", forceUsage: false });
    expect(actionForControl(12, config)).toEqual({ type: "refresh", forceUsage: false });
  });
});
