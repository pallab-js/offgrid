"use client";

import { getDb, type OutboxEntry } from "@/lib/idb/db";
import type { ClientFrame } from "@/lib/protocol";
import { meshSocket, FrameError } from "@/lib/ws/client";

/** Shared retry budget across every outbox (chat + generic shared frames). */
export const MAX_ATTEMPTS = 8;
export const RETRYABLE = new Set(["INTERNAL", "RATE_LIMITED"]);
export const BASE_RETRY_MS = 1500;
export const MAX_RETRY_MS = 30_000;

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

/** Shared scheduler — coalesces many rapid flush requests into one. */
export function scheduleFlush(delayMs: number): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushOutbox();
  }, delayMs);
}

/** Exponential backoff with a hard cap, shared by every outbox. */
export function backoffDelay(attempts: number): number {
  return Math.min(BASE_RETRY_MS * 2 ** attempts, MAX_RETRY_MS);
}

/* ---------------------------------------------------------------- outcomes */

interface Outcome {
  promise: Promise<void>;
  settled: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
}

const outcomes = new Map<string, Outcome>();

/**
 * Watch one queued frame's delivery. Resolves when the hub acks it; rejects
 * when it is permanently rejected or retries are exhausted (the entry is then
 * retained as `failed` — visible in the offline banner and re-armable via
 * `retryFailed`, never silently dropped).
 *
 * Register *before* `enqueue` so a fast flush can't settle first. Callers
 * that don't await still can't trigger unhandled rejections (an internal
 * catch is attached); watchers are one-shot — `retryFailed` re-arms the
 * entry but not previously settled watchers.
 */
export function watchOutcome(clientId: string): Promise<void> {
  const existing = outcomes.get(clientId);
  if (existing) return existing.promise;
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  void promise.catch(() => undefined);
  outcomes.set(clientId, { promise, settled: false, resolve, reject });
  return promise;
}

function settle(clientId: string, ok: boolean, reason = ""): void {
  const outcome = outcomes.get(clientId);
  if (!outcome || outcome.settled) return;
  outcome.settled = true;
  outcomes.delete(clientId);
  if (ok) outcome.resolve();
  else outcome.reject(new Error(reason || "frame rejected by hub"));
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
    if (entry.failed) {
      await db.put("outbox", { ...entry, failed: false, attempts: 0, nextAttemptAt: undefined });
    }
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
      // Backoff gate: an entry inside its retry window pauses the queue
      // (ordering is by createdAt) without consuming attempts — enqueue
      // bursts during an outage can no longer inflate `attempts` past
      // MAX_ATTEMPTS and mark healthy frames failed. Re-arm the coalescing
      // timer so a reload during backoff still retries.
      if (entry.nextAttemptAt && entry.nextAttemptAt > Date.now()) {
        scheduleFlush(entry.nextAttemptAt - Date.now());
        return;
      }
      try {
        await meshSocket.request(entry.frame);
        await db.delete("outbox", entry.clientId);
        settle(entry.clientId, true);
      } catch (error) {
        const retryable = error instanceof FrameError && RETRYABLE.has(error.code);
        const attempts = entry.attempts + 1;
        if (retryable && attempts < MAX_ATTEMPTS) {
          const nextAttemptAt = Date.now() + backoffDelay(attempts);
          await db.put("outbox", { ...entry, attempts, nextAttemptAt });
          scheduleFlush(backoffDelay(attempts));
          return;
        }
        // Permanent rejection or retries exhausted: KEEP the entry as `failed`
        // (banner-visible, re-armable via retryFailed) — never silently
        // delete a queued change, and tell any watcher the truth.
        const code = error instanceof FrameError ? error.code : "INTERNAL";
        await db.put("outbox", { ...entry, attempts, failed: true });
        console.warn(`outbox: frame ${entry.clientId} marked failed (${code})`);
        settle(entry.clientId, false, code);
        continue;
      }
    }
  } finally {
    flushing = false;
  }
}

/**
 * Single orchestrator for every outbox. Chat owns its own message outbox
 * (with deletePending + status semantics); everything else routes through
 * the generic outbox above. Call this from the socket provider on connect.
 */
export async function flushAllOutboxes(): Promise<void> {
  // Import lazily to avoid a circular dependency with the chat store.
  const { useChatStore } = await import("@/stores/chat");
  await useChatStore.getState().flushOutbox();
  await flushOutbox();
}
