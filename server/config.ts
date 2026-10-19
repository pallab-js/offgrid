import path from "node:path";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

const int = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * In production, TLS is enabled by default. If cert/key paths are not provided,
 * we generate a self-signed certificate on first run and store it in the data dir.
 * Set ENABLE_TLS=false to explicitly disable (not recommended for production).
 */
function resolveTlsConfig() {
  const explicitEnable = process.env.ENABLE_TLS === "true";
  const explicitDisable = process.env.ENABLE_TLS === "false";
  const isProd = process.env.NODE_ENV === "production";
  const enableTls = explicitEnable || (isProd && !explicitDisable);

  let tlsCert = process.env.TLS_CERT;
  let tlsKey = process.env.TLS_KEY;

  if (enableTls && (!tlsCert || !tlsKey)) {
    const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), "data"));
    const certPath = path.join(dataDir, "tls-cert.pem");
    const keyPath = path.join(dataDir, "tls-key.pem");

    if (existsSync(certPath) && existsSync(keyPath)) {
      tlsCert = certPath;
      tlsKey = keyPath;
    } else {
      // Generate self-signed cert on first run
      try {
        execSync(
          `openssl req -x509 -newkey rsa:2048 -nodes -keyout "${keyPath}" -out "${certPath}" -days 365 -subj "/CN=offgrid.local" 2>/dev/null`,
          { stdio: "ignore" },
        );
        tlsCert = certPath;
        tlsKey = keyPath;
      } catch {
        // openssl not available — will fail later with clear error
      }
    }
  }

  return { enableTls, tlsCert, tlsKey };
}

const tlsConfig = resolveTlsConfig();

export const config = {
  port: int(process.env.PORT, 3000),
  // NB: deliberately NOT HOSTNAME — many shells, and every container runtime,
  // export HOSTNAME (machine/container id, not an address), which made the
  // hub crash on startup with ENOTFOUND. Bind address must be explicit.
  bindHost: process.env.BIND_HOST ?? "0.0.0.0",
  // Room-join bearer tokens lapse after this long WITHOUT an authenticated
  // use; every use slides the window forward (see repo.resolveToken).
  tokenTtlMs: int(process.env.TOKEN_TTL_DAYS, 30) * 86_400_000,
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), "data")),
  maxFileBytes: int(process.env.MAX_FILE_BYTES, 512 * 1024 * 1024),
  maxJsonBody: int(process.env.MAX_JSON_BODY, 32_768),
  logLevel: (process.env.LOG_LEVEL ?? "info") as "debug" | "info" | "warn" | "error",
  version: "0.1.0-alpha",
  // TLS: enabled by default in production. Set ENABLE_TLS=false to disable.
  // If cert/key not provided, a self-signed cert is generated in the data dir.
  enableTls: tlsConfig.enableTls,
  tlsCert: tlsConfig.tlsCert,
  tlsKey: tlsConfig.tlsKey,
};

export const dbFile = () => path.join(config.dataDir, "mesh.db");
export const filesDir = () => path.join(config.dataDir, "files");
export const logDir = () => path.join(config.dataDir, "logs");
