"use client";

import { getDb, type HttpOutboxEntry } from "@/lib/idb/db";

const STORE_NAME = "httpOutbox";

export async function enqueueHttpRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: unknown | null,
): Promise<void> {
  const db = await getDb();
  const id = `${method}:${url}:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;
  const entry: HttpOutboxEntry = {
    id,
    url,
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
    attempts: 0,
    createdAt: Date.now(),
  };
  await db.put(STORE_NAME, entry);
  void flushHttpOutbox();
}

export async function flushHttpOutbox(): Promise<void> {
  if (typeof window === "undefined") return;
  // Check online status via navigator.onLine (best effort)
  if (!navigator.onLine) return;

  const db = await getDb();
  const entries = (await db.getAll(STORE_NAME))
    .filter((e) => !e.failed)
    .sort((a, b) => a.createdAt - b.createdAt);

  for (const entry of entries) {
    if (!navigator.onLine) return;

    // Backoff gate
    if (entry.nextAttemptAt && entry.nextAttemptAt > Date.now()) {
      // Schedule a retry
      setTimeout(() => void flushHttpOutbox(), entry.nextAttemptAt - Date.now());
      return;
    }

    try {
      const res = await fetch(entry.url, {
        method: entry.method,
        headers: entry.headers,
        body: entry.body,
      });
      if (res.ok) {
        await db.delete(STORE_NAME, entry.id);
      } else {
        // Server error - retry if 5xx, fail if 4xx
        const retryable = res.status >= 500;
        const attempts = entry.attempts + 1;
        if (retryable && attempts < 8) {
          const nextAttemptAt = Date.now() + Math.min(1500 * 2 ** attempts, 30_000);
          await db.put(STORE_NAME, { ...entry, attempts, nextAttemptAt });
        } else {
          await db.put(STORE_NAME, { ...entry, attempts, failed: true });
        }
      }
    } catch {
      // Network error - retry
      const attempts = entry.attempts + 1;
      if (attempts < 8) {
        const nextAttemptAt = Date.now() + Math.min(1500 * 2 ** attempts, 30_000);
        await db.put(STORE_NAME, { ...entry, attempts, nextAttemptAt });
      } else {
        await db.put(STORE_NAME, { ...entry, attempts, failed: true });
      }
    }
  }
}

// Listen for online event to flush
if (typeof window !== "undefined") {
  window.addEventListener("online", () => void flushHttpOutbox());
}

export async function getHttpOutboxStats(): Promise<{ pending: number; failed: number }> {
  const db = await getDb();
  const entries = await db.getAll(STORE_NAME);
  return {
    pending: entries.filter((e) => !e.failed).length,
    failed: entries.filter((e) => e.failed).length,
  };
}

export async function retryFailedHttpRequests(): Promise<void> {
  const db = await getDb();
  const entries = await db.getAll(STORE_NAME);
  for (const entry of entries) {
    if (entry.failed) {
      await db.put(STORE_NAME, { ...entry, failed: false, attempts: 0, nextAttemptAt: undefined });
    }
  }
  await flushHttpOutbox();
}