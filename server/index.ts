import {
  createServer as createHttpServer,
  type RequestListener,
  type Server as HttpServer,
} from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import fs from "node:fs";
import next from "next";
import { WebSocketServer } from "ws";
import { config } from "./config";
import { closeDb, getDb } from "./db";
import { handleApi } from "./http";
import { log } from "./log";
import { attachWs } from "./ws/attach";
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
    if (pathname === WS_PATH) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      upgrade(req, socket, head);
    }
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
