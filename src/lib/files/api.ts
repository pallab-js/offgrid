"use client";

import type { Sealed } from "@/lib/crypto/room";
import type { FileEnc } from "@/lib/protocol";
import { FILE_CHUNK_BYTES } from "@/lib/protocol/constants";
import {
  decryptFileFrame,
  encryptFileChunk,
  frameCount,
  frameOffset,
  frameSizeFor,
} from "@/lib/crypto/file";

export interface UploadResult {
  fileId: string;
  rev: number;
  sha256: string | null;
  size: number;
  enc?: FileEnc;
  existing?: boolean;
}

export interface UploadHandle {
  promise: Promise<UploadResult>;
  abort: () => void;
}

const PART_CHUNKS = 64; // plaintext chunks (4 MiB) per upload request

function abortError(): DOMException {
  return new DOMException("aborted", "AbortError");
}

/**
 * POSTs encrypted frames in ordered parts; each request carries a slice of
 * frames so memory stays bounded, and `X-More: 0` finalizes on the hub.
 */
export function uploadFile(opts: {
  roomId: string;
  token: string;
  fileId: string;
  file: File;
  name: Sealed;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}): UploadHandle {
  let current: XMLHttpRequest | null = null;
  let aborted = false;

  const run = async (): Promise<UploadResult> => {
    const totalFrames = frameCount(opts.file.size);
    let donePlain = 0;

    const postPart = (
      body: Blob,
      headers: Record<string, string>,
      partPlain: number,
    ): Promise<UploadResult> =>
      new Promise<UploadResult>((resolve, reject) => {
        if (aborted) throw abortError();
        const xhr = new XMLHttpRequest();
        current = xhr;
        xhr.open("POST", `/api/rooms/${opts.roomId}/files`);
        xhr.responseType = "text";
        xhr.setRequestHeader("Authorization", `Bearer ${opts.token}`);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.setRequestHeader("X-File-Id", opts.fileId);
        xhr.setRequestHeader("X-File-Name", encodeURIComponent(opts.name.ct));
        xhr.setRequestHeader("X-File-Iv", encodeURIComponent(opts.name.iv));
        xhr.setRequestHeader(
          "X-File-Mime",
          opts.file.type || "application/octet-stream",
        );
        for (const [name, value] of Object.entries(headers)) {
          xhr.setRequestHeader(name, value);
        }

        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable || !partPlain) return;
          const share = body.size > 0 ? event.loaded / body.size : 1;
          opts.onProgress?.(Math.round(donePlain + share * partPlain), opts.file.size);
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText) as UploadResult);
            } catch {
              reject(new Error("hub returned an unreadable upload response"));
            }
            return;
          }
          let message = `upload failed (${xhr.status})`;
          try {
            const parsed = JSON.parse(xhr.responseText) as { error?: { message?: string } };
            message = parsed.error?.message ?? message;
          } catch {
            /* keep default */
          }
          reject(new Error(message));
        };
        xhr.onerror = () => reject(new Error("network error — hub unreachable"));
        xhr.onabort = () => reject(abortError());
        xhr.send(body);
      });

    const onAbort = (): void => {
      aborted = true;
      current?.abort();
    };
    if (opts.signal) {
      if (opts.signal.aborted) return Promise.reject(abortError());
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      let part = 0;
      for (;;) {
        const first = part * PART_CHUNKS;
        const last = Math.min(first + PART_CHUNKS, totalFrames);
        const frames: Uint8Array[] = [];
        let partPlain = 0;
        for (let i = first; i < last; i++) {
          const start = i * FILE_CHUNK_BYTES;
          const chunk = new Uint8Array(
            await opts.file.slice(start, start + FILE_CHUNK_BYTES).arrayBuffer(),
          );
          frames.push(await encryptFileChunk(opts.fileId, i, chunk));
          partPlain += chunk.length;
        }
        const more = last < totalFrames ? "1" : "0";
        const result = await postPart(
          new Blob(frames as BlobPart[]),
          {
            "X-Part": String(part),
            "X-More": more,
            "X-Enc": "gcm1",
            "X-Plain-Size": String(opts.file.size),
          },
          partPlain,
        );
        if (result.existing) return result;
        donePlain += partPlain;
        opts.onProgress?.(donePlain, opts.file.size);
        if (more === "0") return result;
        part += 1;
      }
    } finally {
      opts.signal?.removeEventListener("abort", onAbort);
      current = null;
    }
  };

  const promise = run().catch((error) => {
    if (aborted) throw abortError();
    throw error;
  });
  return {
    promise,
    abort: () => {
      aborted = true;
      current?.abort();
    },
  };
}

/**
 * GET bytes with progress; retries with `Range` from the last frame boundary
 * so an interrupted download resumes, decrypting frames as they arrive
 * (AC-FILES).
 */
export async function downloadFile(opts: {
  roomId: string;
  token: string;
  fileId: string;
  size: number;
  mime?: string;
  enc?: FileEnc;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
  maxAttempts?: number;
}): Promise<Blob> {
  const enc: FileEnc = opts.enc ?? "none";
  const encrypted = enc === "gcm1";
  const totalFrames = encrypted ? frameCount(opts.size) : 0;
  const maxAttempts = opts.maxAttempts ?? 4;

  const plainParts: BlobPart[] = [];
  let plainDone = 0;
  let resumeFrom = 0;
  let frameIdx = 0;
  let frameBuf: Uint8Array[] = [];
  let frameLen = 0;

  const attempt = async (): Promise<void> => {
    if (encrypted) {
      frameBuf = [];
      frameLen = 0;
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${opts.token}`,
    };
    if (resumeFrom > 0) headers.Range = `bytes=${resumeFrom}-`;

    const res = await fetch(`/api/rooms/${opts.roomId}/files/${opts.fileId}`, {
      headers,
      signal: opts.signal,
    });
    if (!res.ok && res.status !== 206) {
      throw new Error(`download failed (${res.status})`);
    }
    if (resumeFrom > 0 && res.status !== 206) {
      plainParts.length = 0;
      plainDone = 0;
      resumeFrom = 0;
      frameIdx = 0;
      frameBuf = [];
      frameLen = 0;
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("response has no body");
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (opts.signal?.aborted) throw abortError();
      if (!value) continue;

      if (!encrypted) {
        plainParts.push(value);
        plainDone += value.length;
        opts.onProgress?.(plainDone, Math.max(opts.size, plainDone));
        continue;
      }

      let offset = 0;
      while (offset < value.length) {
        if (frameIdx >= totalFrames) throw new Error("unexpected trailing bytes");
        const need = frameSizeFor(frameIdx, totalFrames, opts.size) - frameLen;
        const take = Math.min(need, value.length - offset);
        frameBuf.push(value.subarray(offset, offset + take));
        frameLen += take;
        offset += take;
        if (frameLen === need) {
          const frame = new Uint8Array(frameLen);
          let at = 0;
          for (const part of frameBuf) {
            frame.set(part, at);
            at += part.length;
          }
          const plain = await decryptFileFrame(opts.fileId, frameIdx, frame);
          plainParts.push(plain);
          plainDone += plain.length;
          frameIdx += 1;
          frameBuf = [];
          frameLen = 0;
          resumeFrom = frameOffset(frameIdx);
          opts.onProgress?.(plainDone, opts.size);
        }
      }
    }

    if (!encrypted) {
      if (opts.size && plainDone < opts.size) {
        throw new Error("incomplete download — will resume");
      }
      return;
    }
    if (frameIdx < totalFrames || frameLen > 0) {
      throw new Error("incomplete download — will resume");
    }
    if (plainDone !== opts.size) {
      throw new Error("download size mismatch");
    }
  };

  for (let tries = 0; tries < maxAttempts; tries++) {
    try {
      await attempt();
      return new Blob(plainParts, { type: opts.mime ?? "application/octet-stream" });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      if (tries === maxAttempts - 1) throw error;
      await new Promise((r) => setTimeout(r, 400 * 2 ** tries));
    }
  }
  throw new Error("download failed");
}

/** Trigger a browser save for an in-memory blob. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
