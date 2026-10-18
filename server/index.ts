import {
  createServer as createHttpServer,
  type RequestListener,
  type Server as HttpServer,
} from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import fs from "node:fs";
import type { Duplex } from "node:stream";
import next from "next";
import { WebSocketServer } from "ws";
import { config } from "./config";
import { closeDb, getDb } from "./db";
import { handleApi } from "./http";
import { clientIp, MAX_CONN_PER_IP, MAX_CONN_TOTAL } from "./ratelimit";
import { log } from "./log";
import { attachWs } from "./ws/attach";
import { connectionCount, connectionsFromIp } from "./ws/registry";
import { MAX_FRAME_BYTES, WS_PATH } from "../src/lib/protocol";

const dev = process.env.NODE_ENV !== "production";

async function main(): Promise<void> {
  const app = next({
    dev,
    hostname: config.hostname,
    port: config.port,
    dir: process.cwd(),
  });
  const handle = app.getRequestHandler();

  await app.prepare();
  const upgrade = app.getUpgradeHandler();
  getDb();

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  attachWs(wss);

  // One request listener shared by both transports: /api/* is ours,
  // everything else (incl. dev HMR) goes back to Next.
  const onRequest: RequestListener = (req, res) => {
    const url = req.url ?? "/";
    if (url === "/api/health" || url.startsWith("/api/")) {
      void handleApi(req, res, url).catch((error) => {
        log("error", "api.crash", { error: String(error) });
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end('{"error":{"code":"INTERNAL","message":"server error"}}');
        }
      });
      return;
    }
    handle(req, res);
  };

  let server: HttpServer | HttpsServer;
  if (config.enableTls) {
    if (!config.tlsCert || !config.tlsKey) {
      throw new Error(
        "ENABLE_TLS=true requires both TLS_CERT and TLS_KEY to be set (paths to a certificate and private key).",
      );
    }
    let cert: Buffer;
    let key: Buffer;
    try {
      cert = fs.readFileSync(config.tlsCert);
      key = fs.readFileSync(config.tlsKey);
    } catch (error) {
      throw new Error(
        `Failed to read TLS material (TLS_CERT=${config.tlsCert}, TLS_KEY=${config.tlsKey}): ${String(error)}`,
      );
    }
    server = createHttpsServer({ cert, key }, onRequest);
  } else {
    server = createHttpServer(onRequest);
  }

  server.listen(config.port, config.hostname, () => {
    log("info", "hub.listening", {
      port: config.port,
      host: config.hostname,
      mode: dev ? "dev" : "prod",
      tls: config.enableTls,
    });
  });

  // Only /ws is ours — everything else (incl. dev HMR) goes back to Next.
  server.on("upgrade", (req, socket, head) => {
    let pathname = "/";
    try {
      pathname = new URL(req.url ?? "/", "http://hub.local").pathname;
    } catch {
      /* fall through to Next */
    }
    if (pathname !== WS_PATH) {
      upgrade(req, socket, head);
      return;
    }

    // Cross-site WebSocket hijacking guard: browsers always attach Origin to
    // ws:// requests and it must match the Host they are talking to. Clients
    // without an Origin header (curl, scripts) are allowed — the token is the
    // auth there, and the frame budgets below still apply.
    const origin = req.headers.origin;
    if (origin) {
      let originHost = "";
      try {
        originHost = new URL(origin).host;
      } catch {
        /* malformed Origin → rejected below */
      }
      if (originHost !== req.headers.host) {
        log("warn", "ws.upgrade.origin_mismatch", { origin });
        return rejectUpgrade(socket, "403 Forbidden");
      }
    }

    // Connection caps: the per-IP frame budget is only meaningful if one host
    // can't open an unbounded number of sockets.
    const ip = clientIp(req);
    if (connectionCount() >= MAX_CONN_TOTAL || connectionsFromIp(ip) >= MAX_CONN_PER_IP) {
      log("warn", "ws.upgrade.capped", { ip });
      return rejectUpgrade(socket, "429 Too Many Requests");
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  const shutdown = (signal: string) => {
    log("info", "hub.shutdown", { signal });
    try {
      wss.close();
      server.close();
    } finally {
      closeDb();
      process.exit(0);
    }
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

/** Refuse a WS upgrade with a bare HTTP status line, then drop the socket. */
function rejectUpgrade(socket: Duplex, statusLine: string): void {
  try {
    socket.write(`HTTP/1.1 ${statusLine}\r\nconnection: close\r\n\r\n`);
  } catch {
    /* peer already gone */
  }
  socket.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
