import { describe, expect, it } from "vitest";
import {
  computeProof,
  deriveRoomKey,
  exportRoomKey,
  importRoomKey,
  open,
  seal,
  unwrapKeyHistory,
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

describe("unwrapKeyHistory (passphrase rotation chain)", () => {
  it("walks a two-rotation chain back to the original key", async () => {
    // Three generations: K1 → (rotate) → K2 → (rotate) → K3.
    const k1 = await deriveRoomKey("pass-one", randomB64(16));
    const k2 = await deriveRoomKey("pass-two", randomB64(16));
    const k3 = await deriveRoomKey("pass-three", randomB64(16));
    // Server stores wraps oldest-first: wrap_i = AES(K_{i+1}, K_i).
    const wraps = [await seal(k2, await exportRoomKey(k1)), await seal(k3, await exportRoomKey(k2))];

    const prevs = await unwrapKeyHistory(k3, wraps);
    expect(prevs).toEqual([await exportRoomKey(k2), await exportRoomKey(k1)]);

    // The unwrapped keys actually decrypt content from their generation.
    const oldMessage = await seal(k1, "buried supply cache");
    expect(await open(await importRoomKey(prevs[1]!), oldMessage)).toBe("buried supply cache");
  });

  it("handles an empty history", async () => {
    const k = await deriveRoomKey(PASS, randomB64(16));
    expect(await unwrapKeyHistory(k, [])).toEqual([]);
  });

  it("stops at a corrupt wrap, keeping the cleanly unwrapped prefix", async () => {
    const k2 = await deriveRoomKey("pass-two", randomB64(16));
    const k3 = await deriveRoomKey("pass-three", randomB64(16));
    const wraps = [
      { ct: "bm90LWEtdmFsaWQtY3Q=", iv: "bm90LWEtdmFsaWQtaXY=" }, // corrupt link
      await seal(k3, await exportRoomKey(k2)),
    ];

    const prevs = await unwrapKeyHistory(k3, wraps);
    expect(prevs).toEqual([await exportRoomKey(k2)]); // K1 unreachable, K2 recovered
  });

  it("rejects a wrap encrypted under a different key", async () => {
    const k2 = await deriveRoomKey("pass-two", randomB64(16));
    const stranger = await deriveRoomKey("pass-stranger", randomB64(16));
    // Wrap claims to hold K1 but is sealed under a key we don't hold.
    const wraps = [await seal(stranger, "some-key-material-here-32b!")];
    expect(await unwrapKeyHistory(k2, wraps)).toEqual([]);
  });
});
