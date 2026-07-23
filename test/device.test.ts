import type { StreamDeckControlDefinition } from "@elgato-stream-deck/node";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, LAYOUT_PRESETS, type DeckConfig } from "../src/config.js";
import { defaultLayout, fitLayout, infoBarSpans, KEYPAD_15_PROFILE, NEO_PROFILE, profileForKeyCount, profileFromControls } from "../src/device.js";

const grid = (columns: number, rows: number, size: number): StreamDeckControlDefinition[] =>
  Array.from({ length: columns * rows }, (_value, index) => ({
    type: "button",
    row: Math.floor(index / columns),
    column: index % columns,
    index,
    hidIndex: index,
    feedbackType: "lcd",
    pixelSize: { width: size, height: size }
  }));

describe("deck profiles", () => {
  it("derives a keypad-only profile from its controls", () => {
    const profile = profileFromControls(grid(5, 3, 72), "Stream Deck MK.2");
    expect(profile.keys).toHaveLength(15);
    expect(profile.columns).toBe(5);
    expect(profile.rows).toBe(3);
    expect(profile.lcd).toBeNull();
    expect(profile.inputOnlyKeys).toEqual([]);
    expect(profile.keys.every((key) => key.pixelSize.width === 72 && key.pixelSize.height === 72)).toBe(true);
    expect(profile.keys[7]).toMatchObject({ index: 7, row: 1, column: 2 });
  });

  it("separates drawable keys, touch points, and the LCD segment on a Neo layout", () => {
    expect(NEO_PROFILE.keys).toHaveLength(8);
    expect(NEO_PROFILE.columns).toBe(4);
    expect(NEO_PROFILE.rows).toBe(2);
    expect(NEO_PROFILE.inputOnlyKeys).toEqual([8, 9]);
    expect(NEO_PROFILE.lcd).toEqual({ id: 0, pixelSize: { width: 248, height: 58 } });
  });

  it("ignores devices that report no drawable keys", () => {
    const profile = profileFromControls([], "Stream Deck Pedal");
    expect(profile.keys).toEqual([]);
    expect(profile.lcd).toBeNull();
  });

  it("keeps a layout that matches the device and replaces one that does not", () => {
    expect(fitLayout(DEFAULT_CONFIG.keys, NEO_PROFILE)).toEqual(DEFAULT_CONFIG.keys);
    expect(fitLayout(DEFAULT_CONFIG.keys, KEYPAD_15_PROFILE)).toEqual(LAYOUT_PRESETS[15]);
    expect(defaultLayout(KEYPAD_15_PROFILE)).toHaveLength(15);
  });

  it("falls back to a generated layout for a key count without a preset", () => {
    const profile = profileFromControls(grid(3, 2, 80), "Stream Deck Mini");
    const layout = defaultLayout(profile);
    expect(layout).toHaveLength(6);
    expect(layout[0]).toBe("claude.status");
    expect(profileForKeyCount(6)).toBeUndefined();
  });

  it("groups adjacent InfoBar keys per row and splits interrupted runs", () => {
    const spans = infoBarSpans(LAYOUT_PRESETS[15], KEYPAD_15_PROFILE);
    expect(spans).toHaveLength(1);
    expect(spans[0].map((key) => key.index)).toEqual([10, 11, 12, 13]);

    const split: DeckConfig["keys"] = [...LAYOUT_PRESETS[15]];
    split[11] = "blank";
    expect(infoBarSpans(split, KEYPAD_15_PROFILE).map((span) => span.map((key) => key.index))).toEqual([[10], [12, 13]]);
  });

  it("does not join InfoBar keys across a row boundary", () => {
    const profile = profileFromControls(grid(2, 2, 72), "two by two");
    const spans = infoBarSpans(["blank", "infobar", "infobar", "blank"], profile);
    expect(spans.map((span) => span.map((key) => key.index))).toEqual([[1], [2]]);
  });
});
