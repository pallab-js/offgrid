import { vi, describe, it, expect, afterAll } from "vitest";

vi.hoisted(() => {
  process.env.DATA_DIR = `/tmp/offgrid-react-${Date.now()}-${Math.random().toString(36).slice(2)}`;
});

import { insertMessage, setReaction, setRead, softDeleteMessage, syncEvents } from "./repo";
import { closeDb } from "./index";

afterAll(() => {
  closeDb();
});

const CH = "01REACTCHANNEL000000000001";

let seedCount = 0;

function seedMessage(): string {
  seedCount += 1;
  const { msg } = insertMessage({
    roomId: "r-react",
    clientId: `client-seed-${seedCount}`,
    channelId: CH,
    deviceId: "dev-a",
    author: "Maya",
    kind: "text",
    body: { ct: "hello", iv: "iv" },
    attachments: [],
  });
  return msg.id;
}

describe("reactions (server)", () => {
  it("adds, dedupes and removes per device", () => {
    const id = seedMessage();

    const add = setReaction("r-react", id, "👍", "dev-a", true);
    expect(add?.changed).toBe(true);
    expect(add?.msg.reactions).toEqual([
      { emoji: "👍", deviceId: "dev-a", at: expect.any(Number) },
    ]);

    const again = setReaction("r-react", id, "👍", "dev-a", true);
    expect(again?.changed).toBe(false);
    expect(again?.rev).toBe(add!.rev);

    const other = setReaction("r-react", id, "👍", "dev-b", true);
    expect(other?.changed).toBe(true);
    expect(other?.msg.reactions).toHaveLength(2);

    const remove = setReaction("r-react", id, "👍", "dev-a", false);
    expect(remove?.changed).toBe(true);
    expect(remove?.msg.reactions).toEqual([
      { emoji: "👍", deviceId: "dev-b", at: expect.any(Number) },
    ]);

    const unknown = setReaction("r-react", "missing", "👍", "dev-a", true);
    expect(unknown).toBeNull();
  });

  it("leaves deleted messages untouched", () => {
    const id = seedMessage();
    softDeleteMessage("r-react", id);
    const result = setReaction("r-react", id, "❤️", "dev-a", true);
    expect(result?.changed).toBe(false);
    expect(result?.msg.reactions).toEqual([]);
  });
});

describe("read cursors (server)", () => {
  it("advances monotonically and replays through syncEvents", () => {
    const first = setRead("r-react", CH, "dev-b", 1_700_000_000_000);
    expect(first.changed).toBe(true);

    const stale = setRead("r-react", CH, "dev-b", 1_700_000_000_000 - 5_000);
    expect(stale.changed).toBe(false);

    const same = setRead("r-react", CH, "dev-b", 1_700_000_000_000);
    expect(same.changed).toBe(false);

    const fresh = setRead("r-react", CH, "dev-b", 1_700_000_010_000);
    expect(fresh.changed).toBe(true);

    const batch = syncEvents("r-react", 0, 500);
    const reads = batch.events.filter(
      (e) => e.t === "channel.read" && e.deviceId === "dev-b",
    );
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({
      t: "channel.read",
      at: 1_700_000_010_000,
      rev: fresh.rev,
    });
  });

  it("keeps cursors per device", () => {
    const mine = setRead("r-react", CH, "dev-a", 1_699_999_000_000);
    const events = syncEvents("r-react", 0, 500).events.filter(
      (e) => e.t === "channel.read",
    );
    expect(
      events.find((e) => e.t === "channel.read" && e.deviceId === "dev-a"),
    ).toMatchObject({ at: 1_699_999_000_000, rev: mine.rev });
  });
});
