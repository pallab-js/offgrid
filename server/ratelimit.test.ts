import { describe, it, expect } from "vitest";
import {
  SlidingWindowLimiter,
  clientIp,
  WS_CONN_FRAMES_PER_SEC,
  WS_IP_FRAMES_PER_SEC,
} from "./ratelimit";

describe("SlidingWindowLimiter", () => {
  it("allows up to the limit, rejects the next event", () => {
    const limiter = new SlidingWindowLimiter(3, 1_000);
    const now = 10_000;
    expect(limiter.allow("a", now)).toBe(true);
    expect(limiter.allow("a", now)).toBe(true);
    expect(limiter.allow("a", now)).toBe(true);
    expect(limiter.allow("a", now)).toBe(false);
    expect(limiter.allow("a", now + 500)).toBe(false);
  });

  it("refills after the window elapses", () => {
    const limiter = new SlidingWindowLimiter(2, 1_000);
    const now = 50_000;
    expect(limiter.allow("a", now)).toBe(true);
    expect(limiter.allow("a", now)).toBe(true);
    expect(limiter.allow("a", now)).toBe(false);
    expect(limiter.allow("a", now + 1_000)).toBe(true);
    expect(limiter.allow("a", now + 1_000)).toBe(true);
    expect(limiter.allow("a", now + 1_000)).toBe(false);
  });

  it("tracks keys independently", () => {
    const limiter = new SlidingWindowLimiter(1, 1_000);
    const now = 1;
    expect(limiter.allow("a", now)).toBe(true);
    expect(limiter.allow("a", now)).toBe(false);
    expect(limiter.allow("b", now)).toBe(true);
  });

  it("prunes expired keys once the table exceeds maxKeys", () => {
    const limiter = new SlidingWindowLimiter(5, 1_000, 10);
    const now = 0;
    for (let i = 0; i < 11; i++) limiter.allow(`old-${i}`, now);
    expect(limiter.size).toBe(11);
    // Advance past the window: the next write triggers a prune of stale keys.
    limiter.allow("fresh", now + 1_000);
    expect(limiter.size).toBe(1);
  });
});

describe("clientIp", () => {
  it("normalizes ::ffff:-mapped IPv4", () => {
    expect(clientIp({ socket: { remoteAddress: "::ffff:192.168.1.7" } })).toBe("192.168.1.7");
  });

  it("passes IPv4 through", () => {
    expect(clientIp({ socket: { remoteAddress: "10.0.0.4" } })).toBe("10.0.0.4");
  });

  it("falls back when the socket is gone", () => {
    expect(clientIp({})).toBe("-");
    expect(clientIp({ socket: {} })).toBe("-");
  });
});

describe("budgets", () => {
  it("per-IP WS budget covers 8 connections' worth (flooder can't starve a co-located peer)", () => {
    expect(WS_IP_FRAMES_PER_SEC).toBe(WS_CONN_FRAMES_PER_SEC * 8);
  });
});
