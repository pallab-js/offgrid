import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mutable socket double: `isOpen` gates flushing, `request` simulates the
// hub's ack/error frames. Hoisted so the vi.mock factory can close over it.
const socketMock = vi.hoisted(() => ({
  isOpen: false,
  request: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/ws/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ws/client")>();
  // Spread keeps the real FrameError class — instanceof checks in the module
  // under test must see the same identity.
  return { ...actual, meshSocket: socketMock };
});

import { FrameError } from "@/lib/ws/client";
import { getDb } from "@/lib/idb/db";
import type { MessageRecord } from "@/lib/idb/db";
import {
  BASE_RETRY_MS,
  MAX_ATTEMPTS,
  MAX_RETRY_MS,
  backoffDelay,
  enqueue,
  flushOutbox,
  outboxStats,
  retryFailed,
  watchOutcome,
} from "@/lib/sync/outbox";
import { listPending, putRecord } from "@/lib/sync/messages";

function frame(clientId: string) {
  return { t: "note.del" as const, clientId, id: "n1", updatedAt: Date.now() };
}

async function entry(clientId: string) {
  const db = await getDb();
  const rows = await db.getAll("outbox");
  return rows.find((e) => e.clientId === clientId) ?? null;
}

describe("outbox", () => {
  beforeEach(async () => {
    // Fake only the timer APIs: scheduleFlush's coalescing timers must never
    // fire mid-test; Date stays real so backoff windows behave naturally.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    socketMock.isOpen = false;
    socketMock.request.mockReset();
    const db = await getDb();
    await db.clear("outbox");
    await db.clear("messages");
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("delivers, deletes the entry, and resolves the watcher", async () => {
    const outcome = watchOutcome("c-ok");
    await enqueue(frame("c-ok")); // socket closed: auto-flush no-ops
    socketMock.isOpen = true;
    socketMock.request.mockResolvedValue({ t: "ack", ref: "r", id: "s1", rev: 1 });
    await flushOutbox();

    await expect(outcome).resolves.toBeUndefined();
    expect(socketMock.request).toHaveBeenCalledTimes(1);
    expect(await outboxStats()).toEqual({ pending: 0, failed: 0 });
  });

  it("retryable failure: attempts+1, entry kept, backoff gate blocks re-attempts", async () => {
    const outcome = watchOutcome("c-retry");
    await enqueue(frame("c-retry"));
    socketMock.isOpen = true;
    socketMock.request.mockRejectedValue(new FrameError("INTERNAL", "boom"));
    await flushOutbox();
    await flushOutbox(); // inside the backoff window → must not attempt again

    const stored = await entry("c-retry");
    expect(stored?.attempts).toBe(1);
    expect(stored?.failed).toBeFalsy();
    expect(stored?.nextAttemptAt).toBeGreaterThan(Date.now());
    expect(socketMock.request).toHaveBeenCalledTimes(1);

    // Watcher stays pending while the entry is merely backing off.
    let settled = false;
    void outcome.then(
      () => (settled = true),
      () => (settled = true),
    );
    await Promise.resolve();
    expect(settled).toBe(false);
  });

  it("non-retryable rejection marks the entry failed instead of deleting it, and rejects the watcher", async () => {
    const outcome = watchOutcome("c-bad");
    await enqueue(frame("c-bad"));
    socketMock.isOpen = true;
    socketMock.request.mockRejectedValue(new FrameError("BAD_FRAME", "nope"));
    await flushOutbox();

    await expect(outcome).rejects.toThrow("BAD_FRAME");
    const stored = await entry("c-bad");
    expect(stored).not.toBeNull(); // never silently deleted
    expect(stored?.failed).toBe(true);
    expect(await outboxStats()).toEqual({ pending: 0, failed: 1 });
  });

  it("marks failed and rejects the watcher once retries are exhausted", async () => {
    const outcome = watchOutcome("c-exhaust");
    await enqueue(frame("c-exhaust"));
    socketMock.isOpen = true;
    socketMock.request.mockRejectedValue(new FrameError("INTERNAL", "down"));
    const db = await getDb();
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await flushOutbox();
      // Clear the backoff gate between attempts to simulate elapsed time.
      const stored = await entry("c-exhaust");
      if (stored && !stored.failed) {
        await db.put("outbox", { ...stored, nextAttemptAt: undefined });
      }
    }

    await expect(outcome).rejects.toThrow();
    const stored = await entry("c-exhaust");
    expect(stored?.failed).toBe(true);
    expect(stored?.attempts).toBe(MAX_ATTEMPTS);
    expect(socketMock.request).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it("retryFailed re-arms failed entries and delivers them", async () => {
    await enqueue(frame("c-retry-later"));
    socketMock.isOpen = true;
    socketMock.request.mockRejectedValue(new FrameError("BAD_FRAME", "nope"));
    await flushOutbox();
    expect((await outboxStats()).failed).toBe(1);

    socketMock.request.mockResolvedValue({ t: "ack", ref: "r", id: "s2", rev: 1 });
    await retryFailed();

    expect(await outboxStats()).toEqual({ pending: 0, failed: 0 });
  });

  it("backoffDelay grows exponentially and caps", () => {
    expect(backoffDelay(0)).toBe(BASE_RETRY_MS);
    expect(backoffDelay(1)).toBe(BASE_RETRY_MS * 2);
    expect(backoffDelay(10)).toBe(MAX_RETRY_MS);
  });

  it("listPending is scoped to a single room (and empty without one)", async () => {
    const base = {
      clientId: null,
      serverId: null,
      channelId: "chan",
      deviceId: "dev",
      author: "A",
      kind: "text" as const,
      body: null,
      replyTo: null,
      attachments: [],
      createdAt: 1,
      deletedAt: null,
      rev: 0,
      status: "pending" as const,
      attempts: 0,
      deletePending: false,
    };
    await putRecord({ ...base, uid: "m-a", roomId: "room-a" } satisfies MessageRecord);
    await putRecord({ ...base, uid: "m-b", roomId: "room-b" } satisfies MessageRecord);

    expect((await listPending("room-a")).map((r) => r.uid)).toEqual(["m-a"]);
    expect((await listPending("room-b")).map((r) => r.uid)).toEqual(["m-b"]);
    expect(await listPending(null)).toEqual([]);
  });
});
