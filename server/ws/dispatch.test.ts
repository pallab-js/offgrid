import { vi, describe, it, expect } from "vitest";

vi.hoisted(() => {
  process.env.DATA_DIR = `/tmp/offgrid-dispatch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.LOG_LEVEL = "error";
});

import { RATE_LIMIT_PER_SEC } from "../../src/lib/protocol";
import { handleMessage } from "./dispatch";
import type { Conn } from "./registry";

interface FakeConn extends Conn {
  sent: string[];
}

let ipSeq = 0;

function fakeConn(): FakeConn {
  const sent: string[] = [];
  const conn = {
    id: "c1",
    // Distinct per test: the per-IP budget is a module singleton.
    ip: `203.0.113.${++ipSeq}`,
    sent,
    ws: {
      readyState: 1,
      send: (payload: string) => sent.push(payload),
      terminate: () => undefined,
    },
    roomId: null,
    device: null,
    lastFrameAt: 0,
    windowStart: 0,
    windowCount: 0,
    rateLimitedAt: 0,
    rttMs: null,
    battery: null,
  } as unknown as FakeConn;
  return conn;
}

function errors(conn: FakeConn): Array<{ code: string; message: string }> {
  return conn.sent
    .map((raw) => JSON.parse(raw) as { t: string; code?: string; message?: string })
    .filter((f) => f.t === "error")
    .map((f) => ({ code: f.code ?? "", message: f.message ?? "" }));
}

describe("handleMessage rate limiting", () => {
  it("charges malformed frames against the connection budget (pre-parse)", () => {
    const conn = fakeConn();
    for (let i = 0; i < RATE_LIMIT_PER_SEC + 5; i++) handleMessage(conn, "{not json");
    const errs = errors(conn);
    const badFrames = errs.filter((e) => e.code === "BAD_FRAME").length;
    const rateLimited = errs.filter((e) => e.code === "RATE_LIMITED").length;
    expect(badFrames).toBe(RATE_LIMIT_PER_SEC);
    // Error responses are throttled to one per second per conn.
    expect(rateLimited).toBe(1);
  });

  it("charges ping frames too — no more exempt heartbeat floods", () => {
    const conn = fakeConn();
    const ping = JSON.stringify({ t: "ping", ts: 1 });
    for (let i = 0; i < RATE_LIMIT_PER_SEC + 1; i++) handleMessage(conn, ping);
    const pongs = conn.sent.filter((raw) => (JSON.parse(raw) as { t: string }).t === "pong").length;
    expect(pongs).toBe(RATE_LIMIT_PER_SEC);
    expect(errors(conn).filter((e) => e.code === "RATE_LIMITED")).toHaveLength(1);
  });

  it("under-budget frames are processed normally", () => {
    const conn = fakeConn();
    handleMessage(conn, JSON.stringify({ t: "ping", ts: 7 }));
    const pong = JSON.parse(conn.sent[0]!) as { t: string; ts: number };
    expect(pong.t).toBe("pong");
    expect(pong.ts).toBe(7);
    handleMessage(conn, "garbage");
    expect(errors(conn)[0]?.code).toBe("BAD_FRAME");
  });
});
