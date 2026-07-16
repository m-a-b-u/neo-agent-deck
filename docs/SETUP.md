# Neo Agent Deck — Setup Guide

This guide covers installing Neo Agent Deck and configuring the per-key layout, the InfoBar rotation, and brightness.

## Prerequisites

- macOS (the install scripts and Keychain-based Claude usage lookup are macOS-only).
- Node.js 20.12 or newer (`node --version`).
- An Elgato Stream Deck Neo connected over USB.
- **The Elgato Stream Deck app must be closed.** Only one process can own the Neo's HID interface; if the Elgato app is running, Neo Agent Deck reports "Neo detected but busy".
- At least one of Claude Code, Codex, or OpenCode installed locally (that's where the data comes from).

## Install

```bash
npm install        # install dependencies
npm run doctor     # verify device access and data sources
npm run setup      # interactive layout configuration (optional; defaults work out of the box)
npm run dev        # run in the foreground to try it out
npm run install:mac  # install as a launchd service that starts at login
```

To remove the service later: `npm run uninstall:mac`.

## Configuration

All configuration lives in a single JSON file:

```
~/.neo-agent-deck/config.json
```

(Override the directory with the `NEO_AGENT_DECK_HOME` environment variable; runtime state is stored next to it in `state.json`.)

You normally never edit this file by hand — run the interactive setup:

```bash
npm run setup              # walk through keys, InfoBar, resting page, brightness
npm run setup -- --print   # print the current effective config as JSON
npm run setup -- --default # reset to the default layout without prompts
npm run setup -- --reset   # same as --default
```

The setup walks the 8 physical keys in order (keys 0–3 are the top row, 4–7 the bottom row, left to right), then asks for the InfoBar page rotation, the resting page, and brightness. Press Enter at any prompt to keep the current value. Restart the service afterwards to apply changes.

If the file is missing or invalid, Neo Agent Deck silently falls back to the default configuration — a broken config can never prevent startup.

### Config file shape

```json
{
  "brightness": 70,
  "keys": ["claude.status", "codex.status", "opencode.status", "summary",
           "claude.usage", "codex.usage", "opencode.usage", "info"],
  "infoBar": ["claude", "codex", "opencode", "all"],
  "restingPage": "all"
}
```

- `brightness` — panel brightness, 0–100.
- `keys` — exactly 8 key modules, one per physical key (0–3 top row, 4–7 bottom row).
- `infoBar` — the InfoBar page rotation, at least one page, in cycle order.
- `restingPage` — the page shown after startup; must appear in `infoBar`.

## Module reference

### Key modules (`keys`)

| Module | Shows | Tap action |
| --- | --- | --- |
| `claude.status` | Claude session state: green WORKING, gray IDLE, amber NEED YOU with counts | Acknowledges all completed Claude sessions |
| `codex.status` | Codex session state (same colors/counts) | Acknowledges all completed Codex sessions |
| `opencode.status` | OpenCode session state (same colors/counts) | Acknowledges all completed OpenCode sessions |
| `claude.usage` | Claude plan usage percentage with progress bar | Forces a usage refresh |
| `codex.usage` | Codex rate-limit usage percentage with progress bar | Forces a usage refresh |
| `opencode.usage` | OpenCode token usage and 7-day cost | Forces a usage refresh |
| `summary` | Totals across all agents: open and attention-needed sessions | Jumps the InfoBar to the `all` page and refreshes usage |
| `info` | InfoBar page indicator (`INFO 2/4`) | Cycles the InfoBar forward |
| `blank` | A dim empty tile | Plain refresh (does nothing visible) |

### InfoBar modules (`infoBar` / `restingPage`)

| Module | The 248×58 InfoBar shows |
| --- | --- |
| `claude` | Claude 5-hour and weekly plan usage |
| `codex` | Codex rate-limit usage |
| `opencode` | OpenCode 24-hour and 7-day token usage |
| `all` | Total open, working, and attention-needed sessions across all agents |

## Touch points

The two touch points beside the InfoBar are fixed and not configurable:

- **Left touch point** — cycle the InfoBar one page backward.
- **Right touch point** — cycle the InfoBar one page forward.

Cycling wraps around the `infoBar` rotation in the configured order. An `info` key does the same as the right touch point.

## Example layouts

### 1. Recommended default

Status row on top, usage row below, summary and info keys on the right edge.

```json
{
  "brightness": 70,
  "keys": ["claude.status", "codex.status", "opencode.status", "summary",
           "claude.usage", "codex.usage", "opencode.usage", "info"],
  "infoBar": ["claude", "codex", "opencode", "all"],
  "restingPage": "all"
}
```

### 2. Claude-only

Everything else blanked out; the InfoBar only shows Claude usage and the totals.

```json
{
  "brightness": 60,
  "keys": ["claude.status", "summary", "blank", "info",
           "claude.usage", "blank", "blank", "blank"],
  "infoBar": ["claude", "all"],
  "restingPage": "claude"
}
```

### 3. Usage-focused

All three usage tiles doubled up front, statuses collapsed into the summary tile, InfoBar resting on Claude usage.

```json
{
  "brightness": 85,
  "keys": ["claude.usage", "codex.usage", "opencode.usage", "info",
           "claude.status", "codex.status", "opencode.status", "summary"],
  "infoBar": ["claude", "codex", "opencode"],
  "restingPage": "claude"
}
```

Apply any example by pasting it into `~/.neo-agent-deck/config.json` and restarting, or reproduce it with `npm run setup`.

## Resetting

```bash
npm run setup -- --reset
```

writes the default configuration back. Deleting `~/.neo-agent-deck/config.json` has the same effect (defaults apply when no file exists). Runtime state (acknowledged sessions, current InfoBar page) lives in `state.json` in the same directory and can also be deleted safely.
