/** Shared protocol constants (client + server import this module). */

export const WS_PATH = "/ws";

/** Client heartbeat interval (TRD §4.4). */
export const HEARTBEAT_MS = 15_000;

/** Hub marks a peer offline after this long with no frames. */
export const OFFLINE_MS = 45_000;

/** Max inbound/outbound ws frame size. */
export const MAX_FRAME_BYTES = 1_048_576;

/** Max events returned per sync.batch. */
export const SYNC_BATCH_LIMIT = 500;

/** Per-connection sustained message rate (frames/sec) before RATE_LIMITED. */
export const RATE_LIMIT_PER_SEC = 60;

/** JSON body cap for REST endpoints. */
export const MAX_JSON_BODY = 32_768;

/** Outbox/request correlation timeout on the client. */
export const REQUEST_TIMEOUT_MS = 8_000;

/** PBKDF2 iterations for room key derivation (SDA §6.2). */
export const PBKDF2_ITERATIONS = 210_000;

export const ERROR_CODES = [
  "BAD_FRAME",
  "BAD_TOKEN",
  "BAD_PROOF",
  "ROOM_NOT_FOUND",
  "RATE_LIMITED",
  "NOT_IN_ROOM",
  "PAYLOAD_TOO_LARGE",
  "NOT_IMPLEMENTED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
