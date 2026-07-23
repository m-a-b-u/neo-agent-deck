import { setTimeout as delay } from "node:timers/promises";
import { listStreamDecks, openStreamDeck, type StreamDeck } from "@elgato-stream-deck/node";
import { Dashboard } from "./dashboard.js";
import { profileFromDeck, type DeckProfile } from "./device.js";
import { actionForControl } from "./input.js";
import { renderDeckBuffers } from "./render.js";

const POLL_INTERVAL_MS = 3_000;
const DEVICE_SCAN_INTERVAL_MS = 5_000;

export class NeoAgentDeck {
  private readonly dashboard = new Dashboard();
  private deck: StreamDeck | null = null;
  private profile: DeckProfile | null = null;
  private timer: NodeJS.Timeout | null = null;
  private rendering = false;
  private running = false;
  private disconnectResolve: (() => void) | null = null;
  private lastWaitingReason = "";
  private lastRefreshError = "";

  async start(): Promise<void> {
    this.running = true;
    while (this.running) {
      const connected = await this.connect();
      if (!this.running) break;
      if (!connected) await delay(DEVICE_SCAN_INTERVAL_MS);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.disconnect();
  }

  private async connect(): Promise<boolean> {
    let devices;
    try {
      devices = await listStreamDecks();
    } catch (error) {
      this.reportWaiting(`USB scan failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    if (!devices.length) {
      this.reportWaiting("Stream Deck not connected; waiting for USB device.");
      return false;
    }

    // Open whatever is attached and keep the first device that reports drawable keys;
    // pedals and docks describe themselves without any, so they drop out on their own.
    let busy = false;
    for (const device of devices) {
      let candidate: StreamDeck;
      try {
        candidate = await openStreamDeck(device.path, { resetToLogoOnClose: true });
      } catch {
        busy = true;
        continue;
      }
      const profile = profileFromDeck(candidate);
      if (!profile.keys.length) {
        await candidate.close().catch(() => undefined);
        continue;
      }
      this.deck = candidate;
      this.profile = profile;
      break;
    }

    if (!this.deck || !this.profile) {
      this.reportWaiting(busy
        ? "Stream Deck detected but busy; quit the Elgato Stream Deck app."
        : "No Stream Deck with drawable keys connected; waiting for USB device.");
      return false;
    }

    this.lastWaitingReason = "";
    this.deck.on("error", (error) => void this.handleDeviceError(error));
    this.deck.on("down", (control) => {
      if (control.type === "button") void this.onKeyDown(control.index);
    });
    try {
      await this.deck.setBrightness(Math.max(0, Math.min(100, this.dashboard.config.brightness)));
      await this.refresh(true);
    } catch (error) {
      await this.handleDeviceError(error);
      return false;
    }
    this.timer = setInterval(() => void this.refresh(false).catch((error) => this.handleDeviceError(error)), POLL_INTERVAL_MS);
    console.log(`${this.profile.name} connected; live dashboard active.`);
    await new Promise<void>((resolve) => {
      this.disconnectResolve = resolve;
    });
    return true;
  }

  private async handleDeviceError(error: unknown): Promise<void> {
    if (!this.deck) return;
    console.warn(`${this.profile?.name ?? "Stream Deck"} disconnected: ${error instanceof Error ? error.message : String(error)}`);
    await this.disconnect();
  }

  private async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const deck = this.deck;
    this.deck = null;
    this.profile = null;
    if (deck) {
      try {
        await deck.close();
      } catch {
        // The HID handle can already be gone after unplugging the device.
      }
    }
    const resolve = this.disconnectResolve;
    this.disconnectResolve = null;
    resolve?.();
  }

  private reportWaiting(reason: string): void {
    if (reason === this.lastWaitingReason) return;
    this.lastWaitingReason = reason;
    console.log(reason);
  }

  private async onKeyDown(key: number): Promise<void> {
    try {
      const config = this.dashboard.config;
      const action = actionForControl(key, config, this.profile ?? undefined);
      if (action.type === "acknowledge-provider") {
        this.dashboard.acknowledgeProvider(action.provider);
      } else if (action.type === "cycle-info") {
        this.dashboard.state.nextInfoPage(action.delta);
      } else if (action.type === "show-agents") {
        const allIndex = config.infoBar.indexOf("all");
        this.dashboard.state.setInfoPage(allIndex >= 0 ? allIndex : config.infoBar.indexOf(config.restingPage));
      }
      await this.refresh(action.forceUsage);
    } catch (error) {
      console.error("Button action failed:", error);
    }
  }

  private async refresh(forceUsage: boolean): Promise<void> {
    const deck = this.deck;
    const profile = this.profile;
    if (!deck || !profile || this.rendering) return;
    this.rendering = true;
    try {
      let buffers: Awaited<ReturnType<typeof renderDeckBuffers>>;
      try {
        const snapshot = await this.dashboard.collect(forceUsage);
        const page = this.dashboard.state.data.infoPage;
        buffers = await renderDeckBuffers(snapshot, page, this.dashboard.config, profile);
      } catch (error) {
        // Collector/render failures are not device failures; skip this frame. Deduplicate the
        // message so a persistent failure does not grow the log file every POLL_INTERVAL_MS.
        const message = error instanceof Error ? error.message : String(error);
        if (message !== this.lastRefreshError) {
          this.lastRefreshError = message;
          console.warn(`Refresh skipped: ${message}`);
        }
        return;
      }
      // The device may have disconnected (or reconnected) while we were collecting.
      if (this.deck !== deck) return;
      await Promise.all(profile.keys.map((key, position) => deck.fillKeyBuffer(key.index, buffers[position], { format: "rgba" })));
      if (profile.lcd) await deck.fillLcd(profile.lcd.id, buffers[profile.keys.length], { format: "rgba" });
      this.lastRefreshError = "";
    } finally {
      this.rendering = false;
    }
  }
}
