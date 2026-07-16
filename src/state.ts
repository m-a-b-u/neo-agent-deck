import fs from "node:fs";
import path from "node:path";
import { configDir } from "./config.js";
import type { PersistedState } from "./types.js";

const SCHEMA_VERSION = 2;
const MAX_ACKNOWLEDGED_ENTRIES = 500;

export class StateStore {
  readonly data: PersistedState;
  private readonly stateFile: string;
  private readonly pageCount: number;
  private saveWarned = false;

  constructor(stateDirectory: string = configDir(), pageCount = 4, restingIndex = pageCount - 1) {
    this.pageCount = Math.max(1, Math.floor(pageCount));
    const resting = Math.max(0, Math.min(this.pageCount - 1, Math.floor(restingIndex)));
    this.stateFile = path.join(stateDirectory, "state.json");
    try {
      fs.mkdirSync(stateDirectory, { recursive: true });
    } catch (error) {
      console.warn(`State directory unavailable (${error instanceof Error ? error.message : String(error)}); continuing with in-memory state.`);
    }
    this.data = this.load(resting);
    this.save();
  }

  acknowledgeMany(sessions: Array<{ key: string; completionAt: number }>): void {
    for (const session of sessions) {
      if (!session.completionAt) continue;
      this.data.acknowledged[session.key] = Math.max(session.completionAt, this.data.acknowledged[session.key] || 0);
    }
    this.save();
  }

  nextInfoPage(direction = 1): number {
    this.data.infoPage = (this.data.infoPage + direction + this.pageCount) % this.pageCount;
    this.save();
    return this.data.infoPage;
  }

  setInfoPage(page: number): void {
    this.data.infoPage = Math.max(0, Math.min(this.pageCount - 1, page));
    this.save();
  }

  private load(restingIndex: number): PersistedState {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.stateFile, "utf8")) as Partial<PersistedState>;
      const currentSchema = parsed.schemaVersion === SCHEMA_VERSION;
      const attentionSince = currentSchema ? (parsed.attentionSince || parsed.installedAt || Date.now()) : Date.now();
      return {
        schemaVersion: SCHEMA_VERSION,
        installedAt: parsed.installedAt || Date.now(),
        attentionSince,
        infoPage: currentSchema && Number.isInteger(parsed.infoPage) ? Math.max(0, Math.min(this.pageCount - 1, Number(parsed.infoPage))) : restingIndex,
        acknowledged: pruneAcknowledged(parsed.acknowledged || {}, attentionSince)
      };
    } catch {
      const now = Date.now();
      return { schemaVersion: SCHEMA_VERSION, installedAt: now, attentionSince: now, infoPage: restingIndex, acknowledged: {} };
    }
  }

  private save(): void {
    try {
      const temporary = `${this.stateFile}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temporary, this.stateFile);
      this.saveWarned = false;
    } catch (error) {
      if (!this.saveWarned) {
        this.saveWarned = true;
        console.warn(`Could not persist state (${error instanceof Error ? error.message : String(error)}); continuing in memory.`);
      }
    }
  }
}

function pruneAcknowledged(acknowledged: Record<string, number>, attentionSince: number): Record<string, number> {
  const entries = Object.entries(acknowledged).filter(([, completionAt]) => completionAt >= attentionSince);
  entries.sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(entries.slice(0, MAX_ACKNOWLEDGED_ENTRIES));
}
