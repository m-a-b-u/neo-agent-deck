import type { Dimension, StreamDeck, StreamDeckButtonControlDefinition, StreamDeckControlDefinition } from "@elgato-stream-deck/node";
import { LAYOUT_PRESETS, type KeyModule } from "./config.js";

export interface DeckKey {
  index: number;
  row: number;
  column: number;
  pixelSize: Dimension;
}

export interface DeckProfile {
  name: string;
  rows: number;
  columns: number;
  keys: readonly DeckKey[];
  inputOnlyKeys: readonly number[];
  lcd: { id: number; pixelSize: Dimension } | null;
}

export function profileFromControls(controls: readonly StreamDeckControlDefinition[], name: string): DeckProfile {
  const buttons = controls.filter((control): control is StreamDeckButtonControlDefinition => control.type === "button");
  const keys: DeckKey[] = buttons
    .filter((button) => button.feedbackType === "lcd")
    .map((button) => ({ index: button.index, row: button.row, column: button.column, pixelSize: button.pixelSize }))
    .sort((a, b) => a.index - b.index);
  const lcdSegment = controls.find((control) => control.type === "lcd-segment");
  return {
    name,
    rows: keys.reduce((rows, key) => Math.max(rows, key.row + 1), 0),
    columns: keys.reduce((columns, key) => Math.max(columns, key.column + 1), 0),
    keys,
    inputOnlyKeys: buttons.filter((button) => button.feedbackType !== "lcd").map((button) => button.index).sort((a, b) => a - b),
    lcd: lcdSegment ? { id: lcdSegment.id, pixelSize: lcdSegment.pixelSize } : null
  };
}

export function profileFromDeck(deck: StreamDeck): DeckProfile {
  return profileFromControls(deck.CONTROLS, deck.PRODUCT_NAME);
}

export function defaultLayout(profile: DeckProfile): KeyModule[] {
  const preset = LAYOUT_PRESETS[profile.keys.length];
  if (preset) return [...preset];
  const modules: KeyModule[] = ["claude.status", "codex.status", "opencode.status", "summary", "claude.usage", "codex.usage", "opencode.usage", "info"];
  return profile.keys.map((_key, index) => modules[index] ?? "blank");
}

export function fitLayout(keys: readonly KeyModule[], profile: DeckProfile): KeyModule[] {
  return keys.length === profile.keys.length ? [...keys] : defaultLayout(profile);
}

/** Runs of adjacent "infobar" keys within one row; each run renders one sliced InfoBar strip. */
export function infoBarSpans(keys: readonly KeyModule[], profile: DeckProfile): DeckKey[][] {
  const spans: DeckKey[][] = [];
  let current: DeckKey[] = [];
  for (const key of [...profile.keys].sort((a, b) => a.row - b.row || a.column - b.column)) {
    const previous = current.at(-1);
    const adjacent = previous && previous.row === key.row && previous.column + 1 === key.column;
    if (keys[key.index] !== "infobar") {
      current = [];
      continue;
    }
    if (!adjacent) {
      current = [key];
      spans.push(current);
      continue;
    }
    current.push(key);
  }
  return spans;
}

function buttonGrid(columns: number, rows: number, pixelSize: Dimension): StreamDeckButtonControlDefinition[] {
  const buttons: StreamDeckButtonControlDefinition[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      buttons.push({ type: "button", row, column, index, hidIndex: index, feedbackType: "lcd", pixelSize });
    }
  }
  return buttons;
}

/** Synthetic profiles for defaults, previews, and tests; live devices always describe themselves. */
export const NEO_PROFILE = profileFromControls([
  ...buttonGrid(4, 2, { width: 96, height: 96 }),
  { type: "button", row: 2, column: 0, index: 8, hidIndex: 8, feedbackType: "rgb" },
  { type: "lcd-segment", row: 2, column: 1, columnSpan: 2, rowSpan: 1, id: 0, pixelSize: { width: 248, height: 58 }, drawRegions: false },
  { type: "button", row: 2, column: 3, index: 9, hidIndex: 9, feedbackType: "rgb" }
], "Stream Deck Neo");

export const KEYPAD_15_PROFILE = profileFromControls(buttonGrid(5, 3, { width: 72, height: 72 }), "Stream Deck MK.2");

/** Offline stand-ins so setup and previews work without the device plugged in. */
export const PROFILES: readonly DeckProfile[] = [NEO_PROFILE, KEYPAD_15_PROFILE];

export function profileForKeyCount(count: number): DeckProfile | undefined {
  return PROFILES.find((profile) => profile.keys.length === count);
}
