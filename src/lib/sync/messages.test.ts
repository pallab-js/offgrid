import { describe, expect, it } from "vitest";
import { compareMessages, recordFromServer } from "./messages";
import type { MessageRecord } from "@/lib/idb/db";
import type { Message } from "@/lib/protocol";

const serverMsg: Message = {
  id: "01SERVERID000000000000000A",
  clientId: "01CLIENTID000000000000000A",
  channelId: "ch1",
  deviceId: "devA",
  author: "Maya",
  kind: "text",
  body: { ct: "eA", iv: "aQ" },
  replyTo: null,
  attachments: [],
  reactions: [],
  createdAt: 1_700_000_000_000,
  deletedAt: null,
  rev: 7,
};

describe("recordFromServer", () => {
  it("maps a wire message into a synced on-disk record", () => {
    const record = recordFromServer(serverMsg, "room1");
    expect(record.uid).toBe(serverMsg.clientId);
    expect(record.roomId).toBe("room1");
    expect(record.serverId).toBe(serverMsg.id);
    expect(record.status).toBe("synced");
    expect(record.rev).toBe(7);
    expect(record.deletePending).toBe(false);
  });

  it("keys remote messages without a clientId by server id", () => {
    const system: Message = { ...serverMsg, clientId: null, kind: "system", body: null };
    const record = recordFromServer(system, "room1");
    expect(record.uid).toBe(system.id);
  });
});

describe("compareMessages", () => {
  const base: MessageRecord = {
    uid: "u1",
    roomId: "r",
    clientId: null,
    serverId: null,
    channelId: "ch",
    deviceId: "d",
    author: "A",
    kind: "text",
    body: null,
    replyTo: null,
    attachments: [],
  reactions: [],
    createdAt: 100,
    deletedAt: null,
    rev: 1,
    status: "synced",
    attempts: 0,
    deletePending: false,
  };

  it("orders by createdAt then uid", () => {
    const older = { ...base, uid: "z", createdAt: 50 };
    const newer = { ...base, uid: "a", createdAt: 150 };
    const sameTime = { ...base, uid: "b", createdAt: 150 };
    const list = [newer, sameTime, older].sort(compareMessages);
    expect(list.map((m) => m.uid)).toEqual(["z", "a", "b"]);
  });
});
