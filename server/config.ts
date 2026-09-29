import path from "node:path";

const int = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const config = {
  port: int(process.env.PORT, 3000),
  hostname: process.env.HOSTNAME ?? "0.0.0.0",
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), "data")),
  maxFileBytes: int(process.env.MAX_FILE_BYTES, 512 * 1024 * 1024),
  maxJsonBody: int(process.env.MAX_JSON_BODY, 32_768),
  logLevel: (process.env.LOG_LEVEL ?? "info") as "debug" | "info" | "warn" | "error",
  version: "0.1.0-alpha",
};

export const dbFile = () => path.join(config.dataDir, "mesh.db");
export const filesDir = () => path.join(config.dataDir, "files");
export const logDir = () => path.join(config.dataDir, "logs");
