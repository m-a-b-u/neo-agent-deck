# Neo Agent Deck setup guide

This guide covers installation on macOS and Windows, backend discovery, the per-key layout, InfoBar rotation, and brightness.

## Prerequisites

- macOS or Windows 10+.
- Node.js 22.13 or newer (`node --version`).
- An Elgato Stream Deck Neo. It may stay disconnected during setup.
- At least one local Claude Code, Codex, or OpenCode installation.
- Elgato Stream Deck must be closed while Neo Agent Deck controls the device. The installers close it automatically.

## Try it in the foreground

Run these commands from a terminal in the repository:

```bash
npm ci
npm run doctor
npm run setup       # optional; the recommended layout is already the default
npm run preview:live
npm run dev
```

`doctor` does not require a connected Neo. It verifies the platform, Node version, USB detection, Claude sign-in, expected data paths, SQLite database, and each collector without printing credentials or session content.

## Install at login

### macOS

```bash
npm run install:mac
```

The installer builds and copies the app to `~/.local/share/neo-agent-deck`, closes Elgato Stream Deck, and installs the per-user `com.neo-agent-deck` launch agent. No administrator password is required.

Useful service commands:

```bash
launchctl kickstart -k gui/$UID/com.neo-agent-deck
tail -f ~/Library/Logs/NeoAgentDeck.log
npm run uninstall:mac
```

### Windows

Open PowerShell in the repository and run:

```powershell
npm run install:win
```

The installer builds and copies the app to `%LOCALAPPDATA%\NeoAgentDeck`, installs production dependencies, closes Elgato Stream Deck, and creates a hidden per-user Startup entry. A small supervisor restarts the Node process if it exits. No administrator window or password is required.

Logs and PID files live under `%USERPROFILE%\.neo-agent-deck`; configuration is kept when uninstalling.

```powershell
Get-Content "$HOME\.neo-agent-deck\logs\NeoAgentDeck.log" -Wait
npm run install:win     # replace/update and restart the installation
npm run uninstall:win
```

## Windows and WSL

Native Windows agent installations use the same defaults as macOS and need no special configuration:

- Claude Code: `%USERPROFILE%\.claude`
- Codex: `%USERPROFILE%\.codex`
- OpenCode: `%USERPROFILE%\.local\share\opencode`

Native Windows is the simplest setup because the dashboard, USB device, and agent processes share one operating system. WSL data is also supported through Windows' `\\wsl.localhost` share. Set the paths in the same PowerShell window before installing and persist them for future logins:

```powershell
$distro = "Ubuntu-24.04"
$linuxUser = "your-linux-user"

$env:CLAUDE_CONFIG_DIR = "\\wsl.localhost\$distro\home\$linuxUser\.claude"
$env:CODEX_HOME = "\\wsl.localhost\$distro\home\$linuxUser\.codex"
$env:OPENCODE_DATA_HOME = "\\wsl.localhost\$distro\home\$linuxUser\.local\share\opencode"

[Environment]::SetEnvironmentVariable("CLAUDE_CONFIG_DIR", $env:CLAUDE_CONFIG_DIR, "User")
[Environment]::SetEnvironmentVariable("CODEX_HOME", $env:CODEX_HOME, "User")
[Environment]::SetEnvironmentVariable("OPENCODE_DATA_HOME", $env:OPENCODE_DATA_HOME, "User")

npm run doctor
npm run install:win
```

Neo Agent Deck reads the files through the UNC paths and asks that WSL distribution whether the associated Claude/OpenCode process is alive. The Stream Deck itself remains attached to the native Windows service.

If Claude usage says sign-in is unavailable, log in once with Claude Code. You can also provide its documented OAuth environment variable without storing it in this repository:

```powershell
$env:CLAUDE_CODE_OAUTH_TOKEN = "your-token"
[Environment]::SetEnvironmentVariable("CLAUDE_CODE_OAUTH_TOKEN", $env:CLAUDE_CODE_OAUTH_TOKEN, "User")
npm run install:win
```

Never add this token to `config.json`, a script, a screenshot, or a Git commit.

## Backend locations

| Provider | Default data directory | Environment override |
| --- | --- | --- |
| Claude Code | `~/.claude` | `CLAUDE_CONFIG_DIR` |
| Codex | `~/.codex` | `CODEX_HOME` |
| OpenCode | `~/.local/share/opencode` | `OPENCODE_DATA_HOME` |

Claude usage authentication is read in this order: `CLAUDE_CODE_OAUTH_TOKEN`, macOS Keychain, then Claude's `.credentials.json`. The value is kept in memory only. OpenCode's database is opened read-only using Node's built-in SQLite API.

## Configuration

All user configuration lives in:

```text
~/.neo-agent-deck/config.json
```

Override that directory with `NEO_AGENT_DECK_HOME`; runtime state is stored next to it in `state.json`. Normally you do not edit either file by hand:

```bash
npm run setup              # keys, InfoBar, resting page, brightness
npm run setup -- --print   # print effective JSON
npm run setup -- --default # restore the recommended default
npm run setup -- --reset   # alias for --default
```

The eight physical keys are configured in viewing order: keys 0–3 are the top row and 4–7 the bottom row. Press Enter at any prompt to keep the displayed value. Restart or reinstall the service afterward to apply changes.

If the file is missing or unreadable, safe defaults apply. Invalid top-level fields fall back individually; an unknown key entry becomes a blank tile. A broken configuration cannot prevent startup.

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

- `brightness`: panel brightness from 0–100.
- `keys`: exactly eight modules, one for each physical key.
- `infoBar`: at least one page, in cycle order.
- `restingPage`: startup page; it must occur in `infoBar`.

## Module reference

### Key modules

| Module | Display | Tap action |
| --- | --- | --- |
| `claude.status` | Claude WORKING, IDLE, or NEED YOU state | Acknowledge completed Claude sessions |
| `codex.status` | Codex WORKING, IDLE, or NEED YOU state | Acknowledge completed Codex sessions |
| `opencode.status` | OpenCode WORKING, IDLE, or NEED YOU state | Acknowledge completed OpenCode sessions |
| `claude.usage` | Claude plan percentages | Force usage refresh |
| `codex.usage` | Codex rate-limit percentages | Force usage refresh |
| `opencode.usage` | OpenCode tokens and seven-day cost | Force usage refresh |
| `summary` | Combined open and attention counts | Open All Agents page and refresh |
| `info` | Current page, for example `INFO 2/4` | Move forward one page |
| `blank` | Dim empty tile | Refresh only |

### InfoBar modules

| Module | InfoBar content |
| --- | --- |
| `claude` | Claude 5-hour and weekly plan usage |
| `codex` | Codex rate-limit usage |
| `opencode` | OpenCode 24-hour and 7-day token usage |
| `all` | Combined open, working, and attention counts |

The left Neo touch point moves one page backward; the right touch point moves one page forward. Cycling wraps around the configured `infoBar` list.

## Example layouts

### Recommended default

```json
{
  "brightness": 70,
  "keys": ["claude.status", "codex.status", "opencode.status", "summary",
           "claude.usage", "codex.usage", "opencode.usage", "info"],
  "infoBar": ["claude", "codex", "opencode", "all"],
  "restingPage": "all"
}
```

### Claude only

```json
{
  "brightness": 60,
  "keys": ["claude.status", "summary", "blank", "info",
           "claude.usage", "blank", "blank", "blank"],
  "infoBar": ["claude", "all"],
  "restingPage": "claude"
}
```

### Usage focused

```json
{
  "brightness": 85,
  "keys": ["claude.usage", "codex.usage", "opencode.usage", "info",
           "claude.status", "codex.status", "opencode.status", "summary"],
  "infoBar": ["claude", "codex", "opencode"],
  "restingPage": "claude"
}
```

## Reset and troubleshooting

`npm run setup -- --reset` writes the default layout. Deleting `config.json` has the same effect. `state.json` contains only acknowledgement and page state and can also be deleted safely.

If the device or data does not look right:

1. Run `npm run doctor`.
2. Run `npm run status` for a sanitized collector summary.
3. Fully close Elgato Stream Deck; check Task Manager or Activity Monitor if necessary.
4. Re-run the platform installer to rebuild and restart the service.
5. Inspect the log paths listed above. Do not share agent data directories or credentials in an issue.
