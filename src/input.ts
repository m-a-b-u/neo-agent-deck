import type { DeckConfig } from "./config.js";
import type { Provider } from "./types.js";

export type InputAction =
  | { type: "acknowledge-provider"; provider: Provider; forceUsage: false }
  | { type: "cycle-info"; delta: -1 | 1; forceUsage: false }
  | { type: "show-agents"; forceUsage: true }
  | { type: "refresh"; forceUsage: boolean };

export function actionForControl(index: number, config: DeckConfig): InputAction {
  if (index === 8) return { type: "cycle-info", delta: -1, forceUsage: false };
  if (index === 9) return { type: "cycle-info", delta: 1, forceUsage: false };
  const module = index >= 0 && index < 8 ? config.keys[index] : undefined;
  switch (module) {
    case "claude.status":
      return { type: "acknowledge-provider", provider: "claude", forceUsage: false };
    case "codex.status":
      return { type: "acknowledge-provider", provider: "codex", forceUsage: false };
    case "opencode.status":
      return { type: "acknowledge-provider", provider: "opencode", forceUsage: false };
    case "claude.usage":
    case "codex.usage":
    case "opencode.usage":
      return { type: "refresh", forceUsage: true };
    case "summary":
      return { type: "show-agents", forceUsage: true };
    case "info":
      return { type: "cycle-info", delta: 1, forceUsage: false };
    case "blank":
    default:
      return { type: "refresh", forceUsage: false };
  }
}
