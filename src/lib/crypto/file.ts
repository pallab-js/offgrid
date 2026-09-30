import { FILE_CHUNK_BYTES, FILE_FRAME_OVERHEAD } from "@/lib/protocol/constants";
import { getRoomKey } from "./keycache";

const aadEncoder = new TextEncoder();

function frameAad(fileId: string, index: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(aadEncoder.encode(`offgrid-file:${fileId}:${index}`));
}

/** Encrypts one plaintext chunk into `IV || ct||tag` frames. */
export async function encryptFileChunkWith(
  key: CryptoKey,
  fileId: string,
  index: number,
  chunk: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: frameAad(fileId, index) },
      key,
      chunk,
    ),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return out;
}

/** Decrypts one `IV || ct||tag` frame back to its plaintext chunk. */
export async function decryptFileFrameWith(
  key: CryptoKey,
  fileId: string,
  index: number,
  frame: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  if (frame.length < FILE_FRAME_OVERHEAD) throw new Error("file frame too short");
  const iv = frame.subarray(0, 12);
  const ct = frame.subarray(12);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: frameAad(fileId, index) },
    key,
    ct,
  );
  return new Uint8Array(plain);
}

export async function encryptFileChunk(
  fileId: string,
  index: number,
  chunk: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  return encryptFileChunkWith(await getRoomKey(), fileId, index, chunk);
}

export async function decryptFileFrame(
  fileId: string,
  index: number,
  frame: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  return decryptFileFrameWith(await getRoomKey(), fileId, index, frame);
}

/** Frame boundaries for a plaintext payload. */
export function frameCount(plainSize: number): number {
  return Math.ceil(plainSize / FILE_CHUNK_BYTES);
}

export function frameSizeFor(index: number, totalFrames: number, plainSize: number): number {
  const lastPlain = plainSize - (totalFrames - 1) * FILE_CHUNK_BYTES;
  return (index === totalFrames - 1 ? lastPlain : FILE_CHUNK_BYTES) + FILE_FRAME_OVERHEAD;
}

/** Ciphertext byte offset where frame `index` starts. */
export function frameOffset(index: number): number {
  return index * (FILE_CHUNK_BYTES + FILE_FRAME_OVERHEAD);
}
