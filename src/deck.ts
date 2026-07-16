import { setTimeout as delay } from "node:timers/promises";
import { DeviceModelId, listStreamDecks, openStreamDeck, type StreamDeck } from "@elgato-stream-deck/node";
import { Dashboard } from "./dashboard.js";
import { actionForControl } from "./input.js";
import { renderDeckBuffers } from "./render.js";

const POLL_INTERVAL_MS = 3_000;
const DEVICE_SCAN_INTERVAL_MS = 5_000;

export class NeoAgentDeck {
  private readonly dashboard = new Dashboard();
  private deck: StreamDeck | null = null;
  private timer: NodeJS.Timeout | null = null;
  private rendering = false;
  private running = false;
  private disconnectResolve: (() => void) | null = null;
  private lastWaitingReason = "";

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
    const neo = devices.find((device) => device.model === DeviceModelId.NEO);
    if (!neo) {
      this.reportWaiting("Neo not connected; waiting for USB device.");
      return false;
    }

    try {
      this.deck = await openStreamDeck(neo.path, { resetToLogoOnClose: true });
    } catch {
      this.reportWaiting("Neo detected but busy; quit the Elgato Stream Deck app.");
      return false;
    }

    this.lastWaitingReason = "";
    this.deck.on("error", (error) => void this.handleDeviceError(error));
    this.deck.on("down", (control) => void this.onKeyDown(control.index));
    try {
      await this.deck.setBrightness(Math.max(0, Math.min(100, this.dashboard.config.brightness)));
      await this.refresh(true);
    } catch (error) {
      await this.handleDeviceError(error);
      return false;
    }
    this.timer = setInterval(() => void this.refresh(false).catch((error) => this.handleDeviceError(error)), POLL_INTERVAL_MS);
    console.log("Neo connected; live dashboard active.");
    await new Promise<void>((resolve) => {
      this.disconnectResolve = resolve;
    });
    return true;
  }

  private async handleDeviceError(error: unknown): Promise<void> {
    if (!this.deck) return;
    console.warn(`Neo disconnected: ${error instanceof Error ? error.message : String(error)}`);
    await this.disconnect();
  }

  private async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const deck = this.deck;
    this.deck = null;
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
      const action = actionForControl(key, config);
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
    if (!deck || this.rendering) return;
    this.rendering = true;
    try {
      let buffers: Awaited<ReturnType<typeof renderDeckBuffers>>;
      try {
        const snapshot = await this.dashboard.collect(forceUsage);
        const page = this.dashboard.state.data.infoPage;
        buffers = await renderDeckBuffers(snapshot, page, this.dashboard.config);
      } catch (error) {
        // Collector/render failures are not device failures; skip this frame.
        console.warn(`Refresh skipped: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      // The device may have disconnected (or reconnected) while we were collecting.
      if (this.deck !== deck) return;
      await Promise.all(buffers.slice(0, 8).map((buffer, key) => deck.fillKeyBuffer(key, buffer, { format: "rgba" })));
      await deck.fillLcd(0, buffers[8], { format: "rgba" });
    } finally {
      this.rendering = false;
    }
  }
}
