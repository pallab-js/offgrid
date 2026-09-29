import type { WebSocketServer } from "ws";
import { OFFLINE_MS, MAX_FRAME_BYTES } from "../../src/lib/protocol";
import { ulid } from "../../src/lib/utils/id";
import { log } from "../log";
import { emitPresence, handleMessage } from "./dispatch";
import { addConn, allConns, removeConn, type Conn } from "./registry";

/** Wire a ws server to connection lifecycle + liveness sweeping. */
export function attachWs(wss: WebSocketServer): void {
  wss.on("connection", (ws) => {
    const conn: Conn = {
      id: ulid(),
      ws,
      roomId: null,
      device: null,
      lastFrameAt: Date.now(),
      windowStart: Date.now(),
      windowCount: 0,
      rttMs: null,
      battery: null,
    };
    addConn(conn);

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        ws.close(1003, "text frames only");
        return;
      }
      const text = data.toString();
      if (text.length > MAX_FRAME_BYTES) {
        ws.close(1009, "frame too large");
        return;
      }
      try {
        handleMessage(conn, text);
      } catch (error) {
        log("error", "ws.dispatch.crash", { error: String(error) });
      }
    });

    ws.on("close", () => {
      const room = conn.roomId;
      removeConn(conn);
      if (room) emitPresence(room);
      log("debug", "ws.close", { room: room ?? "-" });
    });

    ws.on("error", (error) => {
      log("warn", "ws.socket.error", { error: String(error) });
    });

    log("debug", "ws.open", {});
  });

  // Liveness: any inbound frame counts as a heartbeat (TRD §4.4).
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const conn of allConns()) {
      if (now - conn.lastFrameAt > OFFLINE_MS) {
        log("info", "ws.stale", { device: conn.device?.id ?? "-" });
        try {
          conn.ws.terminate();
        } catch {
          /* already gone */
        }
      }
    }
  }, 15_000);
  sweep.unref?.();
}
