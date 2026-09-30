"use client";

import { getDb, type OutboxEntry } from "@/lib/idb/db";
import type { ClientFrame } from "@/lib/protocol";
import { meshSocket, FrameError } from "@/lib/ws/client";

/**
 * Generic outbox (TRD §6): every non-chat mutation is written here first,
 * then flushed as an acknowledged frame when the hub is reachable. The
 * broadcast event (or a later sync.pull) applies the authoritative row.
 */
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

export async function outboxDepth(): Promise<number> {
  const db = await getDb();
  return (await db.getAll("outbox")).length;
}

export async function flushOutbox(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    if (!meshSocket.isOpen) return;
    const db = await getDb();
    const entries = (await db.getAll("outbox")).sort((a, b) => a.createdAt - b.createdAt);
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
        console.warn("[outbox] dropping frame", entry.frame.t, error);
        await db.delete("outbox", entry.clientId);
      }
    }
  } finally {
    flushing = false;
  }
}
