import { vi, describe, it, expect, afterAll } from "vitest";

vi.hoisted(() => {
  process.env.DATA_DIR = `/tmp/offgrid-msgdel-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.LOG_LEVEL = "error";
});

import {
  RepoError,
  createRoom,
  insertMessage,
  insertSystemMessageIfQuiet,
  listChannels,
  softDeleteMessage,
} from "./repo";
import { closeDb, getDb } from "./index";

afterAll(() => {
  closeDb();
});

const ROOM = "01MSGDELROOM00000000000001";

function setup(): string {
  createRoom({ id: ROOM, name: "Del", salt: "c2FsdA==", proof: "cHJvb2Y=" });
  const general = listChannels(ROOM).find((c) => c.name === "general")!;
  return general.id;
}

function rowOf(id: string): { deleted_at: number | null; rev: number; kind: string } {
  return getDb()
    .prepare("SELECT deleted_at, rev, kind FROM messages WHERE id = ?")
    .get(id) as { deleted_at: number | null; rev: number; kind: string };
}

function seedText(channelId: string): { id: string; rev: number } {
  const { msg } = insertMessage({
    roomId: ROOM,
    clientId: `seed-${Math.random().toString(36).slice(2)}`,
    channelId,
    deviceId: "dev-a",
    author: "Maya",
    kind: "text",
    body: { ct: "hello", iv: "iv" },
    attachments: [],
  });
  return { id: msg.id, rev: msg.rev };
}

describe("softDeleteMessage authorization (server)", () => {
  const channel = setup();

  it("lets the authoring device delete its own message", () => {
    const seed = seedText(channel);
    const result = softDeleteMessage(ROOM, seed.id, "dev-a");
    expect(result?.changed).toBe(true);
    expect(result?.msg.deletedAt).not.toBeNull();
    expect(result?.rev).toBeGreaterThan(seed.rev);
  });

  it("rejects another device WITHOUT mutating (no check-after-commit)", () => {
    const seed = seedText(channel);
    // Pre-fix, the delete committed (deleted_at + rev bumped) and the
    // "not your message" error was only thrown afterwards — the poisoned
    // row then reached every client on their next sync pull.
    expect(() => softDeleteMessage(ROOM, seed.id, "dev-b")).toThrow(RepoError);
    expect(() => softDeleteMessage(ROOM, seed.id, "dev-b")).toThrow("not your message");

    const row = rowOf(seed.id);
    expect(row.deleted_at).toBeNull();
    expect(row.rev).toBe(seed.rev);
  });

  it("rejects deletion of system messages for any device, even the joining one", () => {
    const sys = insertSystemMessageIfQuiet(ROOM, "dev-sys", "Sol");
    expect(sys).not.toBeNull();
    const id = sys!.msg.id;
    const rev = sys!.rev;

    // Same device that triggered the join notice still cannot delete it —
    // system messages are the room's audit trail, not user content.
    expect(() => softDeleteMessage(ROOM, id, "dev-sys")).toThrow(RepoError);
    expect(() => softDeleteMessage(ROOM, id, "dev-sys")).toThrow(
      "system messages cannot be deleted",
    );
    expect(() => softDeleteMessage(ROOM, id, "dev-other")).toThrow(
      "system messages cannot be deleted",
    );

    const row = rowOf(id);
    expect(row.deleted_at).toBeNull();
    expect(row.rev).toBe(rev);
    expect(row.kind).toBe("system");
  });

  it("stays idempotent for an already-deleted own message", () => {
    const seed = seedText(channel);
    const first = softDeleteMessage(ROOM, seed.id, "dev-a");
    expect(first?.changed).toBe(true);
    const again = softDeleteMessage(ROOM, seed.id, "dev-a");
    expect(again?.changed).toBe(false);
    expect(again?.rev).toBe(first!.rev);
  });

  it("returns null for an unknown message", () => {
    expect(softDeleteMessage(ROOM, "missing-id", "dev-a")).toBeNull();
  });
});
