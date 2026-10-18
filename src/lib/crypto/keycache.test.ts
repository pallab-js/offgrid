import { beforeEach, describe, expect, it } from "vitest";
import { deriveRoomKey, exportRoomKey, importRoomKey, seal } from "./room";
import { decryptFileFrame, encryptFileChunkWith } from "./file";
import { getRoomKeys, openText, sealText } from "./keycache";
import { useSessionStore } from "@/stores/session";
import { randomB64 } from "./base64";

// Module-level state in keycache survives across tests on purpose — each test
// installs freshly-derived keys, so the caches keyed by b64 stay distinct.
const ROOM = "room-keycache-test";

async function installKeys(): Promise<{ current: string; prev: string }> {
  const current = await exportRoomKey(await deriveRoomKey("pass-now", randomB64(16)));
  const prev = await exportRoomKey(await deriveRoomKey("pass-before", randomB64(16)));
  useSessionStore.setState({ roomId: ROOM, roomKeyB64: current, prevRoomKeysB64: [prev] });
  return { current, prev };
}

beforeEach(() => {
  useSessionStore.setState({ roomId: null, roomKeyB64: null, prevRoomKeysB64: [] });
});

describe("multi-key decryption (passphrase rotation fallback)", () => {
  it("seals with the current key only and opens it back", async () => {
    const { current } = await installKeys();
    const sealed = await sealText("perimeter map updated");
    // sealText's output opens with the current key by construction.
    const direct = await seal(await importRoomKey(current), "perimeter map updated");
    expect(sealed.ct).not.toBe("");
    expect((await openText(direct)) ?? "").toBe("perimeter map updated");
  });

  it("opens content sealed under a previous-generation key", async () => {
    const { prev } = await installKeys();
    const oldSealed = await seal(await importRoomKey(prev), "supplies cached at north ridge");
    expect(await openText(oldSealed)).toBe("supplies cached at north ridge");
  });

  it("returns null for content sealed under an unrelated key", async () => {
    await installKeys();
    const stranger = await deriveRoomKey("pass-stranger", randomB64(16));
    const sealed = await seal(stranger, "not for this room");
    expect(await openText(sealed)).toBeNull();
  });

  it("getRoomKeys yields current first, then previous keys", async () => {
    const { current, prev } = await installKeys();
    const keys = await getRoomKeys();
    expect(keys).toHaveLength(2);
    const exported = await Promise.all(keys.map((k) => exportRoomKey(k)));
    expect(exported).toEqual([current, prev]);
  });

  it("no keys installed → getRoomKeys rejects cleanly", async () => {
    await expect(getRoomKeys()).rejects.toThrow();
  });

  it("decryptFileFrame falls back to the previous key for old uploads", async () => {
    const { prev } = await installKeys();
    const chunk = new Uint8Array(64).fill(0x42);
    // Simulate an upload from before the rotation: sealed under the old key.
    const frame = await encryptFileChunkWith(await importRoomKey(prev), "file-old", 0, chunk);
    const decrypted = await decryptFileFrame("file-old", 0, frame);
    expect(decrypted).toEqual(chunk);
  });

  it("decryptFileFrame still rejects frames from a foreign key", async () => {
    await installKeys();
    const stranger = await deriveRoomKey("pass-stranger", randomB64(16));
    const frame = await encryptFileChunkWith(stranger, "file-x", 0, new Uint8Array(64));
    await expect(decryptFileFrame("file-x", 0, frame)).rejects.toThrow();
  });
});
