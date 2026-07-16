import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { StateStore } from "../src/state.js";

describe("persistent state", () => {
  it("starts on the resting page and cycles through the configured page count", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "neo-agent-deck-state-"));
    try {
      const state = new StateStore(directory, 4, 3);
      expect(state.data.infoPage).toBe(3);
      expect(state.nextInfoPage(1)).toBe(0);
      expect(state.nextInfoPage(1)).toBe(1);
      expect(state.nextInfoPage(-1)).toBe(0);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("clamps a persisted page to a smaller configured page count", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "neo-agent-deck-state-"));
    fs.writeFileSync(path.join(directory, "state.json"), JSON.stringify({ schemaVersion: 2, installedAt: 1, attentionSince: 1, infoPage: 3, acknowledged: {} }));
    try {
      const state = new StateStore(directory, 2, 0);
      expect(state.data.infoPage).toBe(1);
      expect(state.nextInfoPage(1)).toBe(0);
      expect(state.nextInfoPage(-1)).toBe(1);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("skips completionAt 0 and keeps the newest completion when acknowledging", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "neo-agent-deck-state-"));
    try {
      const store = new StateStore(directory, 4, 3);
      const completionAt = Date.now() + 10_000;
      store.acknowledgeMany([
        { key: "codex:done", completionAt },
        { key: "codex:never-finished", completionAt: 0 }
      ]);
      expect(store.data.acknowledged["codex:done"]).toBe(completionAt);
      expect("codex:never-finished" in store.data.acknowledged).toBe(false);

      store.acknowledgeMany([{ key: "codex:done", completionAt: completionAt - 5_000 }]);
      expect(store.data.acknowledged["codex:done"]).toBe(completionAt);
      store.acknowledgeMany([{ key: "codex:done", completionAt: completionAt + 5_000 }]);
      expect(store.data.acknowledged["codex:done"]).toBe(completionAt + 5_000);

      const reloaded = new StateStore(directory, 4, 3);
      expect(reloaded.data.acknowledged["codex:done"]).toBe(completionAt + 5_000);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("migrates old alerts without carrying stale attention forward", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "neo-agent-deck-state-"));
    fs.writeFileSync(path.join(directory, "state.json"), JSON.stringify({ installedAt: 1, infoPage: 1, acknowledged: {} }));
    const before = Date.now();
    try {
      const state = new StateStore(directory, 4, 3);
      expect(state.data.schemaVersion).toBe(2);
      expect(state.data.infoPage).toBe(3);
      expect(state.data.attentionSince).toBeGreaterThanOrEqual(before);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
