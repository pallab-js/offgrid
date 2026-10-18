import { vi, describe, it, expect, afterAll } from "vitest";

vi.hoisted(() => {
  process.env.DATA_DIR = `/tmp/offgrid-mod-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.LOG_LEVEL = "error";
});

import {
  RepoError,
  claimModeratorIfUnset,
  clearSystemMessages,
  createRoom,
  getModerators,
  insertMessage,
  insertSystemMessageIfQuiet,
  isModerator,
  listChannels,
  revokeDeviceTokens,
  setModerators,
  softDeleteMessage,
} from "./repo";
import { closeDb, getDb } from "./index";
import { issueToken, resolveToken } from "./repo";

afterAll(() => {
  closeDb();
});

function makeRoom(id: string, name: string): string {
  createRoom({ id, name, salt: "c2FsdA==", proof: "cHJvb2Y=" });
  return listChannels(id).find((c) => c.name === "general")!.id;
}

function seedText(roomId: string, channelId: string, deviceId: string): string {
  const { msg } = insertMessage({
    roomId,
    clientId: `seed-${Math.random().toString(36).slice(2)}`,
    channelId,
    deviceId,
    author: deviceId,
    kind: "text",
    body: { ct: "hi", iv: "iv" },
    attachments: [],
  });
  return msg.id;
}

describe("moderator bootstrap (claimModeratorIfUnset)", () => {
  const ROOM = "01MODBOOT0000000000000001";
  makeRoom(ROOM, "Boot");

  it("first joiner claims moderation", () => {
    expect(claimModeratorIfUnset(ROOM, "dev-first")).toEqual(["dev-first"]);
    expect(getModerators(ROOM)).toEqual(["dev-first"]);
    expect(isModerator(ROOM, "dev-first")).toBe(true);
    expect(isModerator(ROOM, "dev-second")).toBe(false);
  });

  it("later joiners cannot claim once the list exists", () => {
    expect(claimModeratorIfUnset(ROOM, "dev-second")).toBeNull();
    expect(getModerators(ROOM)).toEqual(["dev-first"]);
  });

  it("an explicit empty list is not a fresh room (no re-claim)", () => {
    const ROOM2 = "01MODBOOT0000000000000002";
    makeRoom(ROOM2, "Boot2");
    expect(setModerators(ROOM2, [])).toEqual([]);
    expect(claimModeratorIfUnset(ROOM2, "dev-late")).toBeNull();
    expect(getModerators(ROOM2)).toEqual([]);
    expect(isModerator(ROOM2, "dev-late")).toBe(false);
  });

  it("unknown room is a no-op", () => {
    expect(claimModeratorIfUnset("missing-room-000000000000", "dev-x")).toBeNull();
  });
});

describe("setModerators", () => {
  const ROOM = "01MODSET00000000000000001";
  makeRoom(ROOM, "Set");

  it("dedupes and caps the list", () => {
    const many = ["a", "a", "b", ...Array.from({ length: 80 }, (_, i) => `d${i}`)];
    const result = setModerators(ROOM, many)!;
    expect(new Set(result).size).toBe(result.length);
    expect(result.length).toBeLessThanOrEqual(64);
  });

  it("returns null for an unknown room", () => {
    expect(setModerators("missing-room-000000000000", ["a"])).toBeNull();
  });
});

describe("softDeleteMessage with allowOthers (moderation)", () => {
  const ROOM = "01MODDEL00000000000000001";
  const channel = makeRoom(ROOM, "Del");

  it("lets a moderator delete another device's message when allowed", () => {
    const id = seedText(ROOM, channel, "dev-a");
    const result = softDeleteMessage(ROOM, id, "dev-mod", true);
    expect(result?.changed).toBe(true);
    expect(result?.msg.deletedAt).not.toBeNull();
  });

  it("still rejects non-owners without allowOthers", () => {
    const id = seedText(ROOM, channel, "dev-a");
    expect(() => softDeleteMessage(ROOM, id, "dev-b", false)).toThrow("not your message");
  });

  it("system messages stay undeletable even with allowOthers", () => {
    const sys = insertSystemMessageIfQuiet(ROOM, "dev-sys", "Sol");
    expect(sys).not.toBeNull();
    expect(() => softDeleteMessage(ROOM, sys!.msg.id, "dev-mod", true)).toThrow(
      "system messages cannot be deleted",
    );
    const row = getDb()
      .prepare("SELECT deleted_at FROM messages WHERE id = ?")
      .get(sys!.msg.id) as { deleted_at: number | null };
    expect(row.deleted_at).toBeNull();
  });
});

describe("clearSystemMessages", () => {
  const ROOM = "01MODCLR00000000000000001";
  const channel = makeRoom(ROOM, "Clr");

  it("bulk-clears join notices and returns rev-bumped tombstones", () => {
    // insertSystemMessageIfQuiet throttles per device — use distinct devices.
    const a = insertSystemMessageIfQuiet(ROOM, "dev-a", "Maya");
    const b = insertSystemMessageIfQuiet(ROOM, "dev-b", "Ivo");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();

    const memberMsg = seedText(ROOM, channel, "dev-a");
    const cleared = clearSystemMessages(ROOM);

    expect(cleared.length).toBe(2);
    for (const tomb of cleared) {
      expect(tomb.msg.deletedAt).not.toBeNull();
      expect(tomb.msg.kind).toBe("system");
    }
    // Tombstone revs strictly increase and beat the originals.
    expect(cleared[1]!.rev).toBeGreaterThan(cleared[0]!.rev);

    // Member messages are untouched; re-running finds nothing left.
    const member = getDb()
      .prepare("SELECT deleted_at FROM messages WHERE id = ?")
      .get(memberMsg) as { deleted_at: number | null };
    expect(member.deleted_at).toBeNull();
    expect(clearSystemMessages(ROOM)).toEqual([]);
  });
});

describe("revokeDeviceTokens", () => {
  const ROOM = "01MODREV00000000000000001";
  makeRoom(ROOM, "Rev");

  it("removes every token row the device holds, and nobody else's", () => {
    const t1 = issueToken(ROOM, "dev-target");
    const t2 = issueToken(ROOM, "dev-target"); // devices accumulate rows per join
    const other = issueToken(ROOM, "dev-other");

    expect(revokeDeviceTokens(ROOM, "dev-target")).toBe(2);
    expect(resolveToken(t1, ROOM)).toBeNull();
    expect(resolveToken(t2, ROOM)).toBeNull();
    expect(resolveToken(other, ROOM)).not.toBeNull();
  });
});

describe("RepoError codes stay stable", () => {
  it("authorization failures surface as BAD_FRAME", () => {
    const ROOM = "01MODERR00000000000000001";
    const channel = makeRoom(ROOM, "Err");
    const id = seedText(ROOM, channel, "dev-a");
    try {
      softDeleteMessage(ROOM, id, "dev-b", false);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RepoError);
      expect((err as RepoError).code).toBe("BAD_FRAME");
    }
  });
});
