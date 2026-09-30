import { describe, expect, it, beforeAll } from "vitest";
import {
  decryptFileFrameWith,
  encryptFileChunkWith,
  frameCount,
  frameOffset,
  frameSizeFor,
} from "./file";
import { FILE_CHUNK_BYTES, fileCipherSize } from "@/lib/protocol/constants";

let key: CryptoKey;

beforeAll(async () => {
  key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
});

function pattern(size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) & 0xff;
  return bytes;
}

async function roundtrip(size: number): Promise<void> {
  const plain = pattern(size);
  const frames: Uint8Array<ArrayBuffer>[] = [];
  const total = frameCount(size);

  for (let i = 0; i < total; i++) {
    const start = i * FILE_CHUNK_BYTES;
    const chunk = plain.subarray(start, Math.min(start + FILE_CHUNK_BYTES, size));
    const frame = await encryptFileChunkWith(key, "file-1", i, chunk);
    expect(frame.length).toBe(frameSizeFor(i, total, size));
    frames.push(frame);
  }

  const stored = frames.reduce((sum, f) => sum + f.length, 0);
  expect(stored).toBe(fileCipherSize(size));

  let offset = 0;
  for (let i = 0; i < total; i++) {
    expect(frameOffset(i)).toBe(offset);
    offset += frames[i]!.length;
  }

  const out: number[] = [];
  for (let i = 0; i < total; i++) {
    const decrypted = await decryptFileFrameWith(key, "file-1", i, frames[i]!);
    out.push(...decrypted);
  }
  expect(new Uint8Array(out)).toEqual(plain);
}

describe("file frame crypto", () => {
  it("round-trips empty payloads", async () => {
    await roundtrip(0);
    expect(frameCount(0)).toBe(0);
    expect(fileCipherSize(0)).toBe(0);
  });

  it("round-trips sub-chunk payloads", async () => {
    await roundtrip(1);
    await roundtrip(FILE_CHUNK_BYTES - 1);
  });

  it("round-trips exact chunk payloads", async () => {
    await roundtrip(FILE_CHUNK_BYTES);
  });

  it("round-trips multi-chunk payloads", async () => {
    await roundtrip(FILE_CHUNK_BYTES + 1);
    await roundtrip(FILE_CHUNK_BYTES * 3 + 12_345);
  });

  it("rejects a different fileId, frame index or tampered byte", async () => {
    const frame = await encryptFileChunkWith(key, "file-a", 0, pattern(64));
    await expect(decryptFileFrameWith(key, "file-b", 0, frame)).rejects.toThrow();
    await expect(decryptFileFrameWith(key, "file-a", 1, frame)).rejects.toThrow();

    const tampered = frame.slice();
    tampered[20] ^= 0x01;
    await expect(decryptFileFrameWith(key, "file-a", 0, tampered)).rejects.toThrow();
  });

  it("rejects truncated frames", async () => {
    const frame = await encryptFileChunkWith(key, "file-a", 0, pattern(64));
    await expect(
      decryptFileFrameWith(key, "file-a", 0, frame.subarray(0, 20)),
    ).rejects.toThrow();
  });
});
