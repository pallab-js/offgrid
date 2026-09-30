import { vi, describe, it, expect, afterAll } from "vitest";

vi.hoisted(() => {
  process.env.DATA_DIR = `/tmp/offgrid-lww-${Date.now()}-${Math.random().toString(36).slice(2)}`;
});

import {
  saveNote,
  deleteNote,
  setProgress,
  saveWaypoint,
  deleteWaypoint,
  raiseSos,
  clearSos,
  insertBeacon,
} from "./repo";
import { closeDb, currentRev } from "./index";

const enc = (value: string) => ({ ct: value, iv: "iv" });

afterAll(() => {
  closeDb();
});

describe("LWW reducers (server)", () => {
  it("saveNote creates then rejects a stale write", () => {
    const t1 = 1_000_000;
    const first = saveNote({
      roomId: "r1",
      title: enc("first"),
      body: enc("body-1"),
      updatedAt: t1,
      updatedBy: "a",
    });
    expect(first.changed).toBe(true);

    const stale = saveNote({
      roomId: "r1",
      id: first.note.id,
      title: enc("stale"),
      body: enc("body-2"),
      updatedAt: t1 - 1,
      updatedBy: "z",
    });
    expect(stale.changed).toBe(false);
    expect(stale.note.title.ct).toBe("first");
    expect(stale.rev).toBe(first.rev);
  });

  it("saveNote tie-breaks equal timestamps by deviceId", () => {
    const t = 2_000_000;
    const base = saveNote({
      roomId: "r1",
      title: enc("base"),
      body: enc("b"),
      updatedAt: t,
      updatedBy: "a",
    });
    const lower = saveNote({
      roomId: "r1",
      id: base.note.id,
      title: enc("lower"),
      body: enc("b"),
      updatedAt: t,
      updatedBy: "0-device",
    });
    expect(lower.changed).toBe(false);

    const higher = saveNote({
      roomId: "r1",
      id: base.note.id,
      title: enc("higher"),
      body: enc("b"),
      updatedAt: t,
      updatedBy: "z-device",
    });
    expect(higher.changed).toBe(true);
    expect(higher.note.title.ct).toBe("higher");
  });

  it("deleteNote respects LWW (stale delete is ignored)", () => {
    const t = 3_000_000;
    const note = saveNote({
      roomId: "r1",
      title: enc("keep"),
      body: enc("b"),
      updatedAt: t,
      updatedBy: "a",
    }).note;

    const staleDelete = deleteNote({
      roomId: "r1",
      id: note.id,
      updatedAt: t - 100,
      updatedBy: "a",
    });
    expect(staleDelete?.changed).toBe(false);
    expect(staleDelete?.note.deletedAt).toBeNull();

    const freshDelete = deleteNote({
      roomId: "r1",
      id: note.id,
      updatedAt: t + 100,
      updatedBy: "a",
    });
    expect(freshDelete?.changed).toBe(true);
    expect(freshDelete?.note.deletedAt).not.toBeNull();
  });

  it("setProgress applies fresh writes and rejects stale ones", () => {
    const t = 4_000_000;
    const created = setProgress({
      roomId: "r1",
      itemId: "water-food.1",
      checked: true,
      updatedAt: t,
      updatedBy: "a",
    });
    expect(created.changed).toBe(true);
    expect(created.row.checked).toBe(1);

    const stale = setProgress({
      roomId: "r1",
      itemId: "water-food.1",
      checked: false,
      updatedAt: t - 1,
      updatedBy: "b",
    });
    expect(stale.changed).toBe(false);
    expect(stale.row.checked).toBe(1);

    const fresh = setProgress({
      roomId: "r1",
      itemId: "water-food.1",
      checked: false,
      updatedAt: t + 1,
      updatedBy: "b",
    });
    expect(fresh.changed).toBe(true);
    expect(fresh.row.checked).toBe(0);
  });

  it("waypoint delete is a tombstone that loses to newer writes", () => {
    const t = 5_000_000;
    const wp = saveWaypoint({
      roomId: "r1",
      lat: 12.9,
      lng: 77.5,
      gx: null,
      gy: null,
      label: enc("Camp"),
      color: "#ffffff",
      updatedAt: t,
      updatedBy: "a",
    }).waypoint;

    const staleDelete = deleteWaypoint({
      roomId: "r1",
      id: wp.id,
      updatedAt: t - 1,
      updatedBy: "a",
    });
    expect(staleDelete?.changed).toBe(false);

    const freshDelete = deleteWaypoint({
      roomId: "r1",
      id: wp.id,
      updatedAt: t + 1,
      updatedBy: "a",
    });
    expect(freshDelete?.changed).toBe(true);

    const resurrect = saveWaypoint({
      roomId: "r1",
      id: wp.id,
      lat: 12.91,
      lng: 77.51,
      gx: null,
      gy: null,
      label: enc("Camp 2"),
      color: "#ffffff",
      updatedAt: t + 2,
      updatedBy: "a",
    });
    expect(resurrect.changed).toBe(true);
    expect(resurrect.waypoint.deletedAt).toBeNull();
  });

  it("raiseSos reuses the device's active event; clear wins and re-raise starts fresh", () => {
    const first = raiseSos({
      roomId: "r1",
      deviceId: "dev-a",
      note: enc("trapped"),
      lat: 12.9,
      lng: 77.5,
    });
    expect(first.changed).toBe(true);
    expect(first.sos.active).toBe(true);

    const second = raiseSos({
      roomId: "r1",
      deviceId: "dev-a",
      note: enc("still trapped"),
      lat: null,
      lng: null,
    });
    expect(second.sos.id).toBe(first.sos.id);
    expect(second.sos.note?.ct).toBe("still trapped");

    const otherDevice = raiseSos({
      roomId: "r1",
      deviceId: "dev-b",
      note: null,
      lat: null,
      lng: null,
    });
    expect(otherDevice.sos.id).not.toBe(first.sos.id);

    const cleared = clearSos({
      roomId: "r1",
      id: first.sos.id,
      deviceId: "dev-b",
    });
    expect(cleared?.changed).toBe(true);
    expect(cleared?.sos.active).toBe(false);

    const doubleClear = clearSos({
      roomId: "r1",
      id: first.sos.id,
      deviceId: "dev-b",
    });
    expect(doubleClear?.changed).toBe(false);

    const again = raiseSos({
      roomId: "r1",
      deviceId: "dev-a",
      note: null,
      lat: null,
      lng: null,
    });
    expect(again.sos.id).not.toBe(first.sos.id);
    expect(again.sos.active).toBe(true);
  });

  it("insertBeacon appends with a fresh rev", () => {
    const before = currentRev();
    const beacon = insertBeacon({
      roomId: "r1",
      deviceId: "dev-a",
      text: enc("SOS"),
      wpm: 18,
    });
    expect(beacon.rev).toBe(before + 1);
    expect(beacon.beacon.wpm).toBe(18);
    expect(beacon.beacon.deviceId).toBe("dev-a");
  });
});
