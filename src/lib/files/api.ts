"use client";

import type { Sealed } from "@/lib/crypto/room";

export interface UploadResult {
  fileId: string;
  rev: number;
  sha256: string | null;
  size: number;
  existing?: boolean;
}

export interface UploadHandle {
  promise: Promise<UploadResult>;
  abort: () => void;
}

/** POST raw bytes to the hub with upload progress (XHR upload events). */
export function uploadFile(opts: {
  roomId: string;
  token: string;
  fileId: string;
  file: File;
  name: Sealed;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<UploadResult>((resolve, reject) => {
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

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) opts.onProgress?.(event.loaded, event.total);
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
    xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));

    if (opts.signal) {
      if (opts.signal.aborted) {
        xhr.abort();
      } else {
        opts.signal.addEventListener("abort", () => xhr.abort(), { once: true });
      }
    }
    xhr.send(opts.file);
  });
  return { promise, abort: () => xhr.abort() };
}

/**
 * GET bytes with progress; retries with `Range` from what was already
 * received so an interrupted download resumes (AC-FILES).
 */
export async function downloadFile(opts: {
  roomId: string;
  token: string;
  fileId: string;
  size: number;
  mime?: string;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
  maxAttempts?: number;
}): Promise<Blob> {
  const parts: BlobPart[] = [];
  let received = 0;
  const maxAttempts = opts.maxAttempts ?? 4;

  const attempt = async (): Promise<void> => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${opts.token}`,
    };
    if (received > 0) headers.Range = `bytes=${received}-`;

    const res = await fetch(`/api/rooms/${opts.roomId}/files/${opts.fileId}`, {
      headers,
      signal: opts.signal,
    });
    if (!res.ok && res.status !== 206) {
      throw new Error(`download failed (${res.status})`);
    }
    if (received > 0 && res.status !== 206) {
      // Server restarted the body — drop the partial bytes and start over.
      parts.length = 0;
      received = 0;
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("response has no body");
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        parts.push(value);
        received += value.length;
        opts.onProgress?.(received, Math.max(opts.size, received));
      }
      if (opts.signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
    }
    if (opts.size && received < opts.size) {
      throw new Error("incomplete download — will resume");
    }
  };

  for (let tries = 0; tries < maxAttempts; tries++) {
    try {
      await attempt();
      return new Blob(parts, { type: opts.mime ?? "application/octet-stream" });
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
