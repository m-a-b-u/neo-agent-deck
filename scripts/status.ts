#!/usr/bin/env node
import { Dashboard } from "../src/dashboard.js";
import { formatCompactNumber } from "../src/render.js";
import type { UsageSnapshot } from "../src/types.js";

const snapshot = await new Dashboard().collect(true);
console.table(Object.values(snapshot.providers).map((provider) => ({
  provider: provider.provider,
  state: provider.state,
  open: provider.openCount,
  working: provider.workingCount,
  attention: provider.attentionCount,
  usage: formatUsage(provider.usage),
  backend: provider.usage.error || "ok"
})));
console.log(`All agents: ${snapshot.openCount} open, ${snapshot.workingCount} working, ${snapshot.attentionCount} need attention`);

function formatUsage(usage: UsageSnapshot): string {
  return usage.windows.map((window) => {
    if (typeof window.percent === "number") return `${window.label} ${Math.round(window.percent)}%`;
    return `${window.label} ${formatCompactNumber(window.value || 0)} tokens`;
  }).join(" · ") || "unavailable";
}
