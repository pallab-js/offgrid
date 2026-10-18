import { vi, describe, it, expect, afterAll } from "vitest";

vi.hoisted(() => {
  process.env.DATA_DIR = `/tmp/offgrid-rot-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.LOG_LEVEL = "error";
});

import {
  MAX_KEY_HISTORY,
  RepoError,
  createRoom,
  getRoomKeyHistory,
  issueToken,
  resolveToken,
  rotateRoom,
} from "./repo";
import { closeDb, getDb } from "./index";

afterAll(() => {
  closeDb();
});

const ROOM = "01ROTROOM0000000000000001";

function makeRoom(id: string, name: string): void {
  createRoom({ id, name, salt: "c2FsdA==", proof: "cHJvb2Y=" });
}

function roomRow(id: string): { salt: string; proof: string; key_history: string } {
  return getDb().prepare("SELECT salt, proof, key_history FROM rooms WHERE id = ?").get(id) as {
    salt: string;
    proof: string;
    key_history: string;
  };
}

describe("rotateRoom", () => {
  makeRoom(ROOM, "Rot");

  it("swaps salt+proof, appends the wrapped key, revs, and kills every token", () => {
    const t1 = issueToken(ROOM, "dev-a");
    const t2 = issueToken(ROOM, "dev-b");

    const { rev, keyHistory } = rotateRoom({
      roomId: ROOM,
      salt: "bmV3c2FsdA==",
      proof: "bmV3cHJvb2Y=",
      prevKey: { ct: "d3JhcC1jdA==", iv: "d3JhcC1pdg==" },
    });

    const row = roomRow(ROOM);
    expect(row.salt).toBe("bmV3c2FsdA==");
    expect(row.proof).toBe("bmV3cHJvb2Y=");
    expect(keyHistory).toEqual([{ ct: "d3JhcC1jdA==", iv: "d3JhcC1pdg==" }]);
    expect(JSON.parse(row.key_history)).toEqual([{ ct: "d3JhcC1jdA==", iv: "d3JhcC1pdg==" }]);
    expect(rev).toBeGreaterThan(0);
    // Rotation revokes the whole room — every device must rejoin.
    expect(resolveToken(t1, ROOM)).toBeNull();
    expect(resolveToken(t2, ROOM)).toBeNull();
  });

  it("stacks multiple rotations in order (oldest first)", () => {
    rotateRoom({
      roomId: ROOM,
      salt: "c2FsdDM=",
      proof: "cHJvb2Yz",
      prevKey: { ct: "dzI=", iv: "aXYy" },
    });
    expect(getRoomKeyHistory(ROOM)).toEqual([
      { ct: "d3JhcC1jdA==", iv: "d3JhcC1pdg==" },
      { ct: "dzI=", iv: "aXYy" },
    ]);
  });

  it("refuses to grow the chain past the cap", () => {
    for (let i = getRoomKeyHistory(ROOM).length; i < MAX_KEY_HISTORY; i++) {
      rotateRoom({
        roomId: ROOM,
        salt: `c2FsdDk=${i}`,
        proof: `cHJvb2Y5${i}`,
        prevKey: { ct: `dzEw${i}`, iv: "aXY=" },
      });
    }
    expect(() =>
      rotateRoom({
        roomId: ROOM,
        salt: "c2FsdDEw",
        proof: "cHJvb2YxMA==",
        prevKey: { ct: "dzEx", iv: "aXY=" },
      }),
    ).toThrow(RepoError);
    expect(getRoomKeyHistory(ROOM).length).toBe(MAX_KEY_HISTORY);
  });

  it("throws ROOM_NOT_FOUND for an unknown room", () => {
    expect(() =>
      rotateRoom({
        roomId: "missing-room-000000000000",
        salt: "c2FsdA==",
        proof: "cHJvb2Y=",
        prevKey: { ct: "x", iv: "y" },
      }),
    ).toThrow(RepoError);
  });

  it("survives a corrupt key_history blob (treated as empty, then appended)", () => {
    const ROOM2 = "01ROTROOM0000000000000002";
    makeRoom(ROOM2, "Corrupt");
    getDb()
      .prepare("UPDATE rooms SET key_history = 'not-json' WHERE id = ?")
      .run(ROOM2);
    expect(getRoomKeyHistory(ROOM2)).toEqual([]);

    rotateRoom({
      roomId: ROOM2,
      salt: "c2FsdA==",
      proof: "cHJvb2Y=",
      prevKey: { ct: "dzE=", iv: "aXY=" },
    });
    expect(getRoomKeyHistory(ROOM2)).toEqual([{ ct: "dzE=", iv: "aXY=" }]);
  });
});
