import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const socketMock = vi.hoisted(() => ({
  isOpen: false,
  request: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/ws/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ws/client")>();
  return { ...actual, meshSocket: socketMock };
});

import { FrameError } from "@/lib/ws/client";
import { getDb, type MessageRecord } from "@/lib/idb/db";
import { useChatStore } from "@/stores/chat";
import { useSessionStore } from "@/stores/session";
import { getRecord, putRecord } from "@/lib/sync/messages";

const ACK = { t: "ack", ref: "r", id: "srv-1", rev: 7 };

async function seedPending(uid: string, extra: Partial<MessageRecord> = {}) {
  const base = {
    uid,
    roomId: "room-t",
    clientId: `client-${uid}`,
    serverId: null,
    channelId: "chan-t",
    deviceId: "dev-1",
    author: "A",
    kind: "text" as const,
    body: null,
    replyTo: null,
    attachments: [] as string[],
    createdAt: 1,
    deletedAt: null,
    rev: 0,
    status: "pending" as const,
    attempts: 0,
    deletePending: false,
  };
  await putRecord({ ...base, ...extra });
}

describe("chat store outbox", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    socketMock.isOpen = false;
    socketMock.request.mockReset();
    useChatStore.getState().reset();
    useSessionStore.setState({ roomId: "room-t" });
    const db = await getDb();
    await db.clear("messages");
    await db.clear("outbox");
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("sends a pending message and marks it synced from the ack", async () => {
    await seedPending("u1");
    socketMock.isOpen = true;
    socketMock.request.mockResolvedValue(ACK);
    await useChatStore.getState().flushOutbox();

    expect(socketMock.request).toHaveBeenCalledTimes(1);
    const record = await getRecord("u1");
    expect(record?.status).toBe("synced");
    expect(record?.serverId).toBe("srv-1");
    expect(record?.rev).toBe(7);
    expect(record?.retryAfter).toBeUndefined();
    expect(useChatStore.getState().pendingCount).toBe(0);
  });

  it("does not flush pending records that belong to another room", async () => {
    await seedPending("u1", { roomId: "room-other" });
    socketMock.isOpen = true;
    socketMock.request.mockResolvedValue(ACK);
    await useChatStore.getState().flushOutbox();

    expect(socketMock.request).not.toHaveBeenCalled();
    expect((await getRecord("u1"))?.status).toBe("pending");
  });

  it("retryable failure: attempts+1, retryAfter armed, gate blocks re-attempt", async () => {
    await seedPending("u1");
    socketMock.isOpen = true;
    socketMock.request.mockRejectedValue(new FrameError("INTERNAL", "down"));
    await useChatStore.getState().flushOutbox();
    await useChatStore.getState().flushOutbox(); // inside backoff window

    const record = await getRecord("u1");
    expect(record?.attempts).toBe(1);
    expect(record?.retryAfter).toBeGreaterThan(Date.now());
    expect(record?.status).toBe("pending");
    expect(socketMock.request).toHaveBeenCalledTimes(1);
  });

  it("non-retryable rejection marks the message failed (no silent drop)", async () => {
    await seedPending("u1");
    socketMock.isOpen = true;
    socketMock.request.mockRejectedValue(new FrameError("BAD_FRAME", "nope"));
    await useChatStore.getState().flushOutbox();

    const record = await getRecord("u1");
    expect(record?.status).toBe("failed");
    expect(record?.attempts).toBe(1);
  });

  it("flushes a delete tombstone as msg.del and clears deletePending", async () => {
    await seedPending("u1", { status: "synced", serverId: "srv-9", deletePending: true });
    socketMock.isOpen = true;
    socketMock.request.mockResolvedValue({ t: "ack", ref: "r", id: "srv-9", rev: 9 });
    await useChatStore.getState().flushOutbox();

    expect(socketMock.request).toHaveBeenCalledWith(
      expect.objectContaining({ t: "msg.del", id: "srv-9" }),
    );
    const record = await getRecord("u1");
    expect(record?.deletePending).toBe(false);
    expect(record?.rev).toBe(9);
  });
});
