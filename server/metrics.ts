import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from "prom-client";

const register = new Registry();

// Collect default Node.js metrics (CPU, memory, etc.)
collectDefaultMetrics({ register, prefix: "offgrid_" });

// Custom metrics
export const httpRequestsTotal = new Counter({
  name: "offgrid_http_requests_total",
  help: "Total HTTP requests by method, path, status",
  labelNames: ["method", "path", "status"],
  registers: [register],
});

export const wsConnectionsActive = new Gauge({
  name: "offgrid_ws_connections_active",
  help: "Active WebSocket connections",
  labelNames: ["room"],
  registers: [register],
});

export const wsMessagesTotal = new Counter({
  name: "offgrid_ws_messages_total",
  help: "Total WebSocket messages by type and direction",
  labelNames: ["direction", "type", "room"],
  registers: [register],
});

export const wsMessageLatency = new Histogram({
  name: "offgrid_ws_message_latency_seconds",
  help: "WebSocket message processing latency",
  labelNames: ["type", "room"],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
});

export const roomMembers = new Gauge({
  name: "offgrid_room_members",
  help: "Number of members in a room",
  labelNames: ["room"],
  registers: [register],
});

export const outboxDepth = new Gauge({
  name: "offgrid_outbox_depth",
  help: "Number of pending outbox entries",
  labelNames: ["room"],
  registers: [register],
});

export const syncBatchSize = new Histogram({
  name: "offgrid_sync_batch_size",
  help: "Number of events per sync.batch",
  labelNames: ["room"],
  buckets: [1, 5, 10, 25, 50, 100, 250, 500],
  registers: [register],
});

export const rateLimitedTotal = new Counter({
  name: "offgrid_rate_limited_total",
  help: "Total rate-limited requests/frames",
  labelNames: ["type", "ip"],
  registers: [register],
});

export const tokenRevocations = new Counter({
  name: "offgrid_token_revocations_total",
  help: "Total token revocations",
  labelNames: ["reason"],
  registers: [register],
});

export const passphraseRotations = new Counter({
  name: "offgrid_passphrase_rotations_total",
  help: "Total passphrase rotations",
  labelNames: ["room"],
  registers: [register],
});

export const fileUploads = new Counter({
  name: "offgrid_file_uploads_total",
  help: "Total file uploads",
  labelNames: ["room", "status"],
  registers: [register],
});

export const fileUploadSize = new Histogram({
  name: "offgrid_file_upload_size_bytes",
  help: "File upload size in bytes",
  labelNames: ["room"],
  buckets: [1024, 10240, 102400, 1048576, 10485760, 104857600],
  registers: [register],
});

export const dbQueryDuration = new Histogram({
  name: "offgrid_db_query_duration_seconds",
  help: "Database query duration",
  labelNames: ["operation", "table"],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
});

export const errorsTotal = new Counter({
  name: "offgrid_errors_total",
  help: "Total errors by type",
  labelNames: ["type", "code"],
  registers: [register],
});

/** Returns the Prometheus exposition format. */
export async function getMetrics(): Promise<string> {
  return register.metrics();
}

/** Returns the content type for Prometheus metrics. */
export function getMetricsContentType(): string {
  return register.contentType;
}