import { describe, expect, it } from "vitest";
import {
  computeProof,
  deriveRoomKey,
  exportRoomKey,
  importRoomKey,
  open,
  seal,
} from "./room";
import { randomB64 } from "./base64";

const PASS = "field-passphrase-1";

describe("room crypto", () => {
  it("derives a stable key for the same passphrase + salt", async () => {
    const salt = randomB64(16);
    const a = await deriveRoomKey(PASS, salt);
    const b = await deriveRoomKey(PASS, salt);
    expect(await exportRoomKey(a)).toBe(await exportRoomKey(b));
  });

  it("produces different keys for different passphrases", async () => {
    const salt = randomB64(16);
    const a = await exportRoomKey(await deriveRoomKey(PASS, salt));
    const b = await exportRoomKey(await deriveRoomKey(PASS + "x", salt));
    expect(a).not.toBe(b);
  });

  it("computes proofs that depend on the roomId", async () => {
    const salt = randomB64(16);
    const key = await deriveRoomKey(PASS, salt);
    const one = await computeProof(key, "room-one");
    const two = await computeProof(key, "room-two");
    expect(one).not.toBe(two);
    expect(await computeProof(key, "room-one")).toBe(one);
  });

  it("wrong passphrase yields a different proof (server rejects)", async () => {
    const salt = randomB64(16);
    const right = await computeProof(await deriveRoomKey(PASS, salt), "r1");
    const wrong = await computeProof(
      await deriveRoomKey("not-the-passphrase", salt),
      "r1",
    );
    expect(wrong).not.toBe(right);
  });

  it("seal/open roundtrips and fails on tampering", async () => {
    const key = await deriveRoomKey(PASS, randomB64(16));
    const sealed = await seal(key, "water cache at waypoint 4");
    expect(sealed.ct).not.toContain("water");
    expect(await open(key, sealed)).toBe("water cache at waypoint 4");

    const tampered = { ...sealed, ct: sealed.ct.slice(0, -4) + "AAAA" };
    await expect(open(key, tampered)).rejects.toThrow();
  });

  it("exported key re-imports and decrypts", async () => {
    const key = await deriveRoomKey(PASS, randomB64(16));
    const sealed = await seal(key, "hello mesh");
    const reimported = await importRoomKey(await exportRoomKey(key));
    expect(await open(reimported, sealed)).toBe("hello mesh");
  });
});
