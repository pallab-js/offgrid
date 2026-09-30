import { describe, expect, it } from "vitest";
import { c2sSchema, s2cSchema } from "./frames";
import { isMeshEvent } from "./constants";

describe("c2s frames", () => {
  it("accepts a join frame", () => {
    const parsed = c2sSchema.safeParse({
      t: "join",
      token: "t".repeat(40),
      device: { id: "01ABCDEF", name: "Maya", color: "#c5b0f4" },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown frame types", () => {
    expect(c2sSchema.safeParse({ t: "nope" }).success).toBe(false);
  });

  it("requires clientId on msg.send and defaults attachments", () => {
    const bad = c2sSchema.safeParse({
      t: "msg.send",
      channelId: "ch1",
      kind: "text",
      body: null,
    });
    expect(bad.success).toBe(false);

    const good = c2sSchema.safeParse({
      t: "msg.send",
      clientId: "c1",
      channelId: "ch1",
      kind: "text",
      body: null,
    });
    expect(good.success).toBe(true);
    if (good.success && good.data.t === "msg.send") {
      expect(good.data.attachments).toEqual([]);
    }
  });

  it("bounds passphrase-free fields but allows missing optional replyTo", () => {
    expect(
      c2sSchema.safeParse({ t: "ping", ts: Date.now() }).success,
    ).toBe(true);
    expect(c2sSchema.safeParse({ t: "ping" }).success).toBe(false);
  });
});

describe("s2c frames", () => {
  it("accepts joined, presence and sync.batch", () => {
    expect(
      s2cSchema.safeParse({
        t: "joined",
        room: { id: "r1", name: "Field" },
        channels: [],
        device: { id: "d1", name: "Dan", color: "#c8e6cd" },
        cursor: 12,
        serverTime: Date.now(),
      }).success,
    ).toBe(true);

    expect(
      s2cSchema.safeParse({ t: "presence", peers: [] }).success,
    ).toBe(true);

    expect(
      s2cSchema.safeParse({
        t: "sync.batch",
        events: [],
        cursor: 0,
        done: true,
      }).success,
    ).toBe(true);
  });

  it("rejects events carrying bogus revisions", () => {
    expect(
      s2cSchema.safeParse({
        t: "msg.new",
        rev: 0,
        msg: { id: "m1" },
      }).success,
    ).toBe(false);
  });
});

describe("isMeshEvent", () => {
  it("classifies control vs event frames", () => {
    expect(isMeshEvent({ t: "msg.new" })).toBe(true);
    expect(isMeshEvent({ t: "ack" })).toBe(false);
    expect(isMeshEvent({ t: "pong" })).toBe(false);
  });
});
