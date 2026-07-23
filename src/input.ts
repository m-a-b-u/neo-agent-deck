import type { DeckConfig } from "./config.js";
import { fitLayout, NEO_PROFILE, type DeckProfile } from "./device.js";
import type { Provider } from "./types.js";

export type InputAction =
  | { type: "acknowledge-provider"; provider: Provider; forceUsage: false }
  | { type: "cycle-info"; delta: -1 | 1; forceUsage: false }
  | { type: "show-agents"; forceUsage: true }
  | { type: "refresh"; forceUsage: boolean };

export function actionForControl(index: number, config: DeckConfig, profile: DeckProfile = NEO_PROFILE): InputAction {
  // Keys without a display are page controls; on the Neo these are the two touch points.
  const touchPoint = profile.inputOnlyKeys.indexOf(index);
  if (touchPoint >= 0) return { type: "cycle-info", delta: touchPoint === 0 && profile.inputOnlyKeys.length > 1 ? -1 : 1, forceUsage: false };
  const layout = fitLayout(config.keys, profile);
  const module = index >= 0 && index < layout.length ? layout[index] : undefined;
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
    case "infobar":
      return { type: "cycle-info", delta: 1, forceUsage: false };
    case "blank":
    default:
      return { type: "refresh", forceUsage: false };
  }
}
