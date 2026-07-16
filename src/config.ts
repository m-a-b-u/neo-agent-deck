import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type KeyModule =
  | "claude.status" | "codex.status" | "opencode.status"
  | "claude.usage" | "codex.usage" | "opencode.usage"
  | "summary" | "info" | "blank";

export type InfoModule = "claude" | "codex" | "opencode" | "all";

export interface DeckConfig {
  brightness: number;
  keys: KeyModule[];
  infoBar: InfoModule[];
  restingPage: InfoModule;
}

export const DEFAULT_CONFIG: DeckConfig = {
  brightness: 70,
  keys: [
    "claude.status", "codex.status", "opencode.status", "summary",
    "claude.usage", "codex.usage", "opencode.usage", "info"
  ],
  infoBar: ["claude", "codex", "opencode", "all"],
  restingPage: "all"
};

const KEY_MODULES: readonly KeyModule[] = [
  "claude.status", "codex.status", "opencode.status",
  "claude.usage", "codex.usage", "opencode.usage",
  "summary", "info", "blank"
];

const INFO_MODULES: readonly InfoModule[] = ["claude", "codex", "opencode", "all"];

export function configDir(): string {
  return process.env.NEO_AGENT_DECK_HOME || path.join(os.homedir(), ".neo-agent-deck");
}

export function loadConfig(dir = configDir()): DeckConfig {
  let parsed: Partial<DeckConfig>;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8")) as Partial<DeckConfig>;
    if (!parsed || typeof parsed !== "object") throw new Error("config.json is not an object");
  } catch {
    return cloneDefault();
  }

  const brightness = Number.isFinite(Number(parsed.brightness))
    ? Math.max(0, Math.min(100, Number(parsed.brightness)))
    : DEFAULT_CONFIG.brightness;

  const keys: KeyModule[] = Array.isArray(parsed.keys) && parsed.keys.length === 8
    ? parsed.keys.map((key) => (KEY_MODULES.includes(key as KeyModule) ? (key as KeyModule) : "blank"))
    : [...DEFAULT_CONFIG.keys];

  const seen = new Set<InfoModule>();
  const infoBarCandidate: InfoModule[] = (Array.isArray(parsed.infoBar) ? parsed.infoBar : [])
    .filter((module): module is InfoModule => INFO_MODULES.includes(module as InfoModule))
    .filter((module) => (seen.has(module) ? false : (seen.add(module), true)));
  const infoBar = infoBarCandidate.length ? infoBarCandidate : [...DEFAULT_CONFIG.infoBar];

  const restingPage = infoBar.includes(parsed.restingPage as InfoModule)
    ? (parsed.restingPage as InfoModule)
    : infoBar[infoBar.length - 1];

  return { brightness, keys, infoBar, restingPage };
}

export function saveConfig(cfg: DeckConfig, dir = configDir()): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const configFile = path.join(dir, "config.json");
    const temporary = `${configFile}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, configFile);
  } catch (error) {
    console.warn(`Could not persist config (${error instanceof Error ? error.message : String(error)}).`);
  }
}

function cloneDefault(): DeckConfig {
  return { ...DEFAULT_CONFIG, keys: [...DEFAULT_CONFIG.keys], infoBar: [...DEFAULT_CONFIG.infoBar] };
}
