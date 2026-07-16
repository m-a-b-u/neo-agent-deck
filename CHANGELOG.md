# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-07-16

### Added

- Configurable per-key layout: key assignments are no longer hardcoded and can
  be customized via the layout configuration (see `docs/SETUP.md`).
- Interactive setup script (`npm run setup`) to generate and edit the layout
  configuration.
- New unit tests covering the layout configuration, state handling, and the
  fixed edge cases below.

### Fixed

- Robustness and correctness fixes across the backends and renderer, including
  hardened parsing of backend data and safer handling of missing or malformed
  session files.
- Resource leaks: handles and watchers are now reliably closed on reconnect
  and shutdown.

## [0.1.0]

### Added

- Initial release: live Claude Code, Codex, and OpenCode status and usage on a
  Stream Deck Neo over direct USB HID, with macOS login-service installer,
  doctor, status, and preview tooling.
