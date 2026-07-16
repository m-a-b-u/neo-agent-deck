#!/usr/bin/env node
import path from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import {
  configDir,
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  type DeckConfig,
  type InfoModule,
  type KeyModule
} from "../src/config.js";

const KEY_MODULES: readonly KeyModule[] = [
  "claude.status", "codex.status", "opencode.status",
  "claude.usage", "codex.usage", "opencode.usage",
  "summary", "info", "blank"
];

const KEY_MODULE_HELP: Record<KeyModule, string> = {
  "claude.status": "Claude session status (tap acknowledges attention)",
  "codex.status": "Codex session status (tap acknowledges attention)",
  "opencode.status": "OpenCode session status (tap acknowledges attention)",
  "claude.usage": "Claude plan usage (tap forces a usage refresh)",
  "codex.usage": "Codex rate-limit usage (tap forces a usage refresh)",
  "opencode.usage": "OpenCode token usage (tap forces a usage refresh)",
  summary: "All-agents open/attention counters (tap jumps to the All page)",
  info: "InfoBar page indicator (tap cycles the InfoBar)",
  blank: "Dim empty tile (tap just refreshes)"
};

const INFO_MODULES: readonly InfoModule[] = ["claude", "codex", "opencode", "all"];

const INFO_MODULE_HELP: Record<InfoModule, string> = {
  claude: "Claude 5-hour and weekly plan usage",
  codex: "Codex rate-limit usage",
  opencode: "OpenCode 24-hour and 7-day token usage",
  all: "Total open / working / attention sessions"
};

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (args.includes("--print")) {
  console.log(JSON.stringify(loadConfig(), null, 2));
  process.exit(0);
}

if (args.includes("--default") || args.includes("--reset")) {
  const cfg: DeckConfig = { ...DEFAULT_CONFIG, keys: [...DEFAULT_CONFIG.keys], infoBar: [...DEFAULT_CONFIG.infoBar] };
  saveConfig(cfg);
  printResult(cfg);
  process.exit(0);
}

if (!process.stdin.isTTY) {
  printHelp();
  process.exit(0);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
try {
  const current = loadConfig();
  console.log("Neo Agent Deck setup — press Enter to keep the value shown in [brackets].\n");

  const keys = await promptKeys(rl, current.keys);
  const infoBar = await promptInfoBar(rl, current.infoBar);
  const restingPage = await promptRestingPage(rl, infoBar, current.restingPage);
  const brightness = await promptBrightness(rl, current.brightness);

  const cfg: DeckConfig = { brightness, keys, infoBar, restingPage };
  saveConfig(cfg);
  console.log();
  printResult(cfg);
} finally {
  rl.close();
}

async function promptKeys(io: Interface, current: KeyModule[]): Promise<KeyModule[]> {
  console.log("Physical key layout (as you look at the Neo):");
  printLayout(current);
  console.log("Key modules:");
  KEY_MODULES.forEach((module, index) => {
    console.log(`  ${index + 1}. ${module.padEnd(16)} ${KEY_MODULE_HELP[module]}`);
  });
  console.log();

  const keys: KeyModule[] = [...current];
  for (let index = 0; index < 8; index += 1) {
    const row = index < 4 ? "top" : "bottom";
    const column = (index % 4) + 1;
    for (;;) {
      const answer = (await io.question(`Key ${index} (${row} row, position ${column}) [${keys[index]}]: `)).trim();
      if (!answer) break;
      const choice = Number(answer);
      if (Number.isInteger(choice) && choice >= 1 && choice <= KEY_MODULES.length) {
        keys[index] = KEY_MODULES[choice - 1];
        break;
      }
      if (KEY_MODULES.includes(answer as KeyModule)) {
        keys[index] = answer as KeyModule;
        break;
      }
      console.log(`  Please enter 1-${KEY_MODULES.length}, a module name, or Enter to keep.`);
    }
  }
  console.log("\nNew layout:");
  printLayout(keys);
  return keys;
}

async function promptInfoBar(io: Interface, current: InfoModule[]): Promise<InfoModule[]> {
  console.log("InfoBar rotation — the pages the touch points and info key cycle through.");
  INFO_MODULES.forEach((module, index) => {
    console.log(`  ${index + 1}. ${module.padEnd(9)} ${INFO_MODULE_HELP[module]}`);
  });
  for (;;) {
    const answer = (await io.question(`Pages in order, comma-separated (e.g. "claude,all" or "1,4") [${current.join(",")}]: `)).trim();
    if (!answer) return [...current];
    const picked: InfoModule[] = [];
    let valid = true;
    for (const token of answer.split(",").map((part) => part.trim()).filter(Boolean)) {
      const byNumber = Number(token);
      const module = Number.isInteger(byNumber) && byNumber >= 1 && byNumber <= INFO_MODULES.length
        ? INFO_MODULES[byNumber - 1]
        : INFO_MODULES.includes(token as InfoModule) ? (token as InfoModule) : null;
      if (!module) {
        valid = false;
        console.log(`  Unknown page "${token}". Use names or numbers 1-${INFO_MODULES.length}.`);
        break;
      }
      if (!picked.includes(module)) picked.push(module);
    }
    if (valid && picked.length >= 1) return picked;
    if (valid) console.log("  Pick at least one page.");
  }
}

async function promptRestingPage(io: Interface, infoBar: InfoModule[], current: InfoModule): Promise<InfoModule> {
  const fallback = infoBar.includes(current) ? current : infoBar[infoBar.length - 1];
  if (infoBar.length === 1) return infoBar[0];
  for (;;) {
    const answer = (await io.question(`Resting page, one of ${infoBar.join("/")} [${fallback}]: `)).trim();
    if (!answer) return fallback;
    const byNumber = Number(answer);
    if (Number.isInteger(byNumber) && byNumber >= 1 && byNumber <= infoBar.length) return infoBar[byNumber - 1];
    if (infoBar.includes(answer as InfoModule)) return answer as InfoModule;
    console.log(`  Resting page must be one of: ${infoBar.join(", ")}.`);
  }
}

async function promptBrightness(io: Interface, current: number): Promise<number> {
  for (;;) {
    const answer = (await io.question(`Brightness 0-100 [${current}]: `)).trim();
    if (!answer) return current;
    const value = Number(answer);
    if (Number.isFinite(value) && value >= 0 && value <= 100) return Math.round(value);
    console.log("  Enter a number between 0 and 100.");
  }
}

function printLayout(keys: KeyModule[]): void {
  const cell = (module: KeyModule): string => module.padEnd(16);
  console.log(`  [0] ${cell(keys[0])} [1] ${cell(keys[1])} [2] ${cell(keys[2])} [3] ${cell(keys[3])}`);
  console.log(`  [4] ${cell(keys[4])} [5] ${cell(keys[5])} [6] ${cell(keys[6])} [7] ${cell(keys[7])}`);
  console.log("      ◀ touch point            248×58 InfoBar            touch point ▶\n");
}

function printResult(cfg: DeckConfig): void {
  console.log(`Saved ${path.join(configDir(), "config.json")}:`);
  console.log(JSON.stringify(cfg, null, 2));
  const restart = process.platform === "win32"
    ? "npm run install:win"
    : "launchctl kickstart -k gui/$UID/com.neo-agent-deck";
  console.log(`\nRestart npm run dev, or run ${restart}, to apply.`);
}

function printHelp(): void {
  console.log(`Neo Agent Deck setup

Usage: npm run setup [-- <flag>]

Interactive mode (default, requires a terminal):
  Walks through the 8 key assignments, the InfoBar rotation, the resting
  page, and brightness, then writes config.json to ${configDir()}.

Flags:
  --print     Print the current effective config as JSON and exit.
  --default   Write the default config without prompting.
  --reset     Same as --default.
  --help      Show this help.

See docs/SETUP.md for the module reference and example layouts.`);
}
