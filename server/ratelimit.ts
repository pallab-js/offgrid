import { RATE_LIMIT_PER_SEC } from "../src/lib/protocol";

/**
 * Hub rate limiting (TRD N5, SDA threat model).
 *
 * Four independent budgets:
 *  - **per WS connection** — the original limiter, now charged *before* frame
 *    parsing so malformed floods can't bypass it (pings are no longer exempt);
 *  - **per client IP across all of that IP's WS connections** — bounds the
 *    N-sockets multiplier; one host can't buy N× the frame budget. Sized at
 *    8 connections' worth so a flooder on a shared address (localhost, NAT)
 *    can't starve a well-behaved peer on the same address;
 *  - **per client IP for the HTTP API**, with strict sub-budgets on the
 *    passphrase-guessing surface (`POST .../join`) and room creation;
 *  - **global join attempts per IP** — bounds total passphrase guesses across
 *    all rooms from a single IP (mitigates NAT-shared guessing).
 *
 * Sliding windows per key. Key tables are pruned lazily once they exceed
 * `maxKeys` so an attacker cycling keys can't grow memory without bound.
 */

/** Sliding-window counter: allows `limit` events per `windowMs` per key. */
export class SlidingWindowLimiter {
  private readonly buckets = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 8192,
  ) {}

  /** Charge one event against `key`; false when the budget is exhausted. */
  allow(key: string, now: number = Date.now()): boolean {
    let bucket = this.buckets.get(key);
    if (!bucket || now - bucket.start >= this.windowMs) {
      bucket = { start: now, count: 0 };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (this.buckets.size > this.maxKeys) this.prune(now);
    return bucket.count <= this.limit;
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.start >= this.windowMs) this.buckets.delete(key);
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}

/** Frames/sec per WS connection (protocol constant, unchanged: N5 semantics). */
export const WS_CONN_FRAMES_PER_SEC = RATE_LIMIT_PER_SEC;

/** Frames/sec per *IP* across all of that IP's WS connections (8 sockets' worth). */
export const WS_IP_FRAMES_PER_SEC = RATE_LIMIT_PER_SEC * 8;

/** Generic HTTP API budget per IP. */
export const HTTP_REQUESTS_PER_MIN = 300;

/** Passphrase guesses: `POST /api/rooms/{id}/join` per IP+room per minute. */
export const JOIN_ATTEMPTS_PER_MIN = 10;

/** Global passphrase guesses per IP per minute (across all rooms). */
export const JOIN_ATTEMPTS_PER_MIN_GLOBAL = 20;

/** Room creation per IP per minute (was unlimited). */
export const ROOM_CREATE_PER_MIN = 10;

/** Simultaneous WS connections allowed per IP / in total (was unlimited). */
export const MAX_CONN_PER_IP = 32;
export const MAX_CONN_TOTAL = 256;

/** Shared limiter instances (module singletons — the hub is one process). */
export const wsIpLimiter = new SlidingWindowLimiter(WS_IP_FRAMES_PER_SEC, 1_000);
export const httpLimiter = new SlidingWindowLimiter(HTTP_REQUESTS_PER_MIN, 60_000);
export const joinLimiter = new SlidingWindowLimiter(JOIN_ATTEMPTS_PER_MIN, 60_000);
export const joinLimiterGlobal = new SlidingWindowLimiter(JOIN_ATTEMPTS_PER_MIN_GLOBAL, 60_000);
export const roomCreateLimiter = new SlidingWindowLimiter(ROOM_CREATE_PER_MIN, 60_000);

/** Client address for limiter keys (`::ffff:`-mapped IPv4 normalized). */
export function clientIp(req: { socket?: { remoteAddress?: string } }): string {
  const raw = req.socket?.remoteAddress ?? "-";
  return raw.startsWith("::ffff:") ? raw.slice(7) : raw;
}
