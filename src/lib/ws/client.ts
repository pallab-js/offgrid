"use client";

import { HEARTBEAT_MS, REQUEST_TIMEOUT_MS, WS_PATH } from "@/lib/protocol/constants";
import type { ClientFrame, Device, ErrorCode, ServerFrame } from "@/lib/protocol";

let frameSchemas: Promise<typeof import("@/lib/protocol/frames")> | null = null;

function loadFrameSchemas(): Promise<typeof import("@/lib/protocol/frames")> {
  frameSchemas ??= import("@/lib/protocol/frames");
  return frameSchemas;
}
import type { LinkStatus } from "@/stores/mesh";

export interface Ack {
  t: "ack";
  ref: string;
  id: string;
  rev: number;
}

export class FrameError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

type FrameHandler = (frame: ServerFrame) => void;
type StatusHandler = (status: LinkStatus) => void;
type RttHandler = (rttMs: number) => void;

interface SocketConfig {
  token: string;
  device: Device;
}

/**
 * Reconnecting ws client: join on open, heartbeat for RTT + liveness,
 * request/ack correlation for outbox settling (TRD §4).
 */
class MeshSocket {
  private ws: WebSocket | null = null;
  private config: SocketConfig | null = null;
  private running = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private rttEma: number | null = null;
  private pending = new Map<
    string,
    { resolve: (ack: Ack) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private frameHandlers = new Set<FrameHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private rttHandlers = new Set<RttHandler>();

  start(config: SocketConfig): void {
    this.config = config;
    if (this.running) this.stop(false);
    this.running = true;
    this.attempt = 0;
    this.open();
  }

  stop(notify = true): void {
    this.running = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    this.rejectPending(new FrameError("INTERNAL", "connection closed"));
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    if (notify) this.emitStatus("offline");
  }

  onFrame(handler: FrameHandler): () => void {
    this.frameHandlers.add(handler);
    return () => this.frameHandlers.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  onRtt(handler: RttHandler): () => void {
    this.rttHandlers.add(handler);
    return () => this.rttHandlers.delete(handler);
  }

  send(frame: ClientFrame): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(frame));
    return true;
  }

  /** Send a frame that the hub acknowledges; resolves with the ack. */
  request(frame: ClientFrame & { clientId: string }): Promise<Ack> {
    return new Promise<Ack>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(frame.clientId);
        reject(new FrameError("INTERNAL", "ack timeout"));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(frame.clientId, { resolve, reject, timer });
      if (!this.send(frame)) {
        clearTimeout(timer);
        this.pending.delete(frame.clientId);
        reject(new FrameError("INTERNAL", "not connected"));
      }
    });
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /* ------------------------------------------------------------ internals */

  private open(): void {
    if (!this.running || !this.config) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}${WS_PATH}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      if (!this.config) return;
      this.attempt = 0;
      this.send({ t: "join", token: this.config.token, device: this.config.device });
    };
    ws.onmessage = (event) => this.handleMessage(String(event.data));
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopHeartbeat();
      this.rejectPending(new FrameError("INTERNAL", "connection lost"));
      if (this.running) {
        this.emitStatus(this.attempt === 0 ? "reconnecting" : "reconnecting");
        this.scheduleReconnect();
      }
    };
    ws.onerror = () => {
      /* close always follows */
    };
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer) return;
    const base = Math.min(500 * 2 ** this.attempt, 10_000);
    const jitter = Math.floor(Math.random() * 250);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, base + jitter);
  }

  private handleMessage(raw: string): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return;
    }
    void loadFrameSchemas()
      .then(({ s2cSchema }) => s2cSchema.safeParse(json))
      .then((parsed) => {
        if (!parsed.success) {
          console.warn("[ws] invalid server frame", json);
          return;
        }
        this.dispatchFrame(parsed.data);
      })
      .catch(() => undefined);
  }

  private dispatchFrame(frame: ServerFrame): void {
    if (frame.t === "joined") {
      this.startHeartbeat();
      this.emitStatus("online");
    } else if (frame.t === "pong") {
      const sample = Date.now() - frame.ts;
      this.rttEma =
        this.rttEma === null ? sample : Math.round(this.rttEma * 0.7 + sample * 0.3);
      this.rttHandlers.forEach((handler) => handler(this.rttEma!));
    } else if (frame.t === "ack") {
      const entry = this.pending.get(frame.ref);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(frame.ref);
        entry.resolve(frame);
      }
    } else if (frame.t === "error" && frame.ref) {
      const entry = this.pending.get(frame.ref);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(frame.ref);
        entry.reject(new FrameError(frame.code, frame.message));
      }
    }

    this.frameHandlers.forEach((handler) => handler(frame));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ t: "ping", ts: Date.now() });
    }, HEARTBEAT_MS);
    this.send({ t: "ping", ts: Date.now() });
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private rejectPending(error: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  private emitStatus(status: LinkStatus): void {
    this.statusHandlers.forEach((handler) => handler(status));
  }
}

export const meshSocket = new MeshSocket();
