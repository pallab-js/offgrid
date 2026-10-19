import fs from "node:fs";
import path from "node:path";
import { config, logDir } from "./config";

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let stream: fs.WriteStream | null = null;

function ensureStream(): fs.WriteStream | null {
  if (stream) return stream;
  try {
    fs.mkdirSync(logDir(), { recursive: true });
    const file = path.join(logDir(), "hub.log");
    // Keep the previous run's tail; rotate once at startup.
    if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) {
      for (let i = 4; i >= 1; i--) {
        const from = `${file}.${i}`;
        const to = `${file}.${i + 1}`;
        if (fs.existsSync(from)) fs.renameSync(from, to);
      }
      fs.renameSync(file, `${file}.1`);
    }
    stream = fs.createWriteStream(file, { flags: "a" });
  } catch {
    stream = null;
  }
  return stream;
}

/**
 * Local structured log. Never logs secrets: no passphrases, keys, tokens
 * or plaintext message bodies (TRD §8).
 * Outputs JSON lines with timestamp, level, event, and fields.
 */
export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  if (ORDER[level] < ORDER[config.logLevel]) return;

  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    level,
    event,
    ...fields,
  };

  const line = JSON.stringify(entry);

  if (level === "error") console.error(line);
  else console.log(line);

  ensureStream()?.write(line + "\n");
}

/** Creates a child logger with additional fixed fields. */
export function childLogger(baseFields: Record<string, unknown>) {
  return {
    debug: (event: string, fields: Record<string, unknown> = {}) => log("debug", event, { ...baseFields, ...fields }),
    info: (event: string, fields: Record<string, unknown> = {}) => log("info", event, { ...baseFields, ...fields }),
    warn: (event: string, fields: Record<string, unknown> = {}) => log("warn", event, { ...baseFields, ...fields }),
    error: (event: string, fields: Record<string, unknown> = {}) => log("error", event, { ...baseFields, ...fields }),
  };
}
