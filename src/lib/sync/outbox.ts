"use client";

import { getDb, type OutboxEntry } from "@/lib/idb/db";
import type { ClientFrame } from "@/lib/protocol";
import { meshSocket, FrameError } from "@/lib/ws/client";

const MAX_ATTEMPTS = 8;
const RETRYABLE = new Set(["INTERNAL", "RATE_LIMITED"]);

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

function scheduleFlush(delayMs: number): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushOutbox();
  }, delayMs);
}

export async function enqueue(frame: ClientFrame & { clientId: string }): Promise<void> {
  const db = await getDb();
  const entry: OutboxEntry = {
    clientId: frame.clientId,
    frame,
    attempts: 0,
    createdAt: Date.now(),
  };
  await db.put("outbox", entry);
  void flushOutbox();
}

export interface OutboxStats {
  pending: number;
  failed: number;
}

export async function outboxDepth(): Promise<number> {
  const db = await getDb();
  return (await db.getAll("outbox")).length;
}

export async function outboxStats(): Promise<OutboxStats> {
  const db = await getDb();
  const entries = await db.getAll("outbox");
  return {
    pending: entries.filter((e) => !e.failed).length,
    failed: entries.filter((e) => e.failed).length,
  };
}

/** Re-arm failed frames and try again immediately. */
export async function retryFailed(): Promise<void> {
  const db = await getDb();
  const entries = await db.getAll("outbox");
  for (const entry of entries) {
    if (entry.failed) await db.put("outbox", { ...entry, failed: false, attempts: 0 });
  }
  await flushOutbox();
}

export async function flushOutbox(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    if (!meshSocket.isOpen) return;
    const db = await getDb();
    const entries = (await db.getAll("outbox"))
      .filter((e) => !e.failed)
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const entry of entries) {
      if (!meshSocket.isOpen) return;
      try {
        await meshSocket.request(entry.frame);
        await db.delete("outbox", entry.clientId);
      } catch (error) {
        const retryable = error instanceof FrameError && RETRYABLE.has(error.code);
        const attempts = entry.attempts + 1;
        if (retryable && attempts < MAX_ATTEMPTS) {
          await db.put("outbox", { ...entry, attempts });
          scheduleFlush(Math.min(1500 * 2 ** attempts, 30_000));
          return;
        }
        if (error instanceof FrameError && !RETRYABLE.has(error.code)) {
          await db.delete("outbox", entry.clientId);
          continue;
        }
        await db.put("outbox", { ...entry, attempts, failed: true });
      }
    }
  } finally {
    flushing = false;
  }
}
