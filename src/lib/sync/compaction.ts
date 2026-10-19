"use client";

import { getDb } from "@/lib/idb/db";
import { MESSAGE_HISTORY_TTL_MS, FILE_BLOB_MAX_BYTES, STORAGE_QUOTA_THRESHOLD } from "@/lib/protocol/constants";

/**
 * IndexedDB compaction utilities.
 * - Deletes synced messages older than MESSAGE_HISTORY_TTL_MS
 * - Removes file blobs larger than FILE_BLOB_MAX_BYTES
 * - Runs when storage estimate exceeds STORAGE_QUOTA_THRESHOLD
 */

/** Runs full compaction pass. Returns number of deleted records. */
export async function compactDatabase(): Promise<{ messagesDeleted: number; fileBlobsCleared: number }> {
  const db = await getDb();
  const now = Date.now();
  let messagesDeleted = 0;
  let fileBlobsCleared = 0;

  // 1. Delete old synced messages
  const messageTx = db.transaction("messages", "readwrite");
  const messageStore = messageTx.store;
  const cursor = await messageStore.openCursor();
  for (let c = cursor; c; c = await c.continue()) {
    const record = c.value;
    if (record.status === "synced" && record.deletedAt !== null && now - record.deletedAt > MESSAGE_HISTORY_TTL_MS) {
      await c.delete();
      messagesDeleted += 1;
    } else if (record.status === "synced" && record.createdAt !== null && now - record.createdAt > MESSAGE_HISTORY_TTL_MS && record.deletedAt === null) {
      // Also delete very old messages even if not deleted (archival)
      await c.delete();
      messagesDeleted += 1;
    }
  }
  await messageTx.done;

  // 2. Clear large file blobs
  const fileTx = db.transaction("files", "readwrite");
  const fileStore = fileTx.store;
  const fileCursor = await fileStore.openCursor();
  for (let c = fileCursor; c; c = await c.continue()) {
    const record = c.value;
    if (record.blob && record.size > FILE_BLOB_MAX_BYTES) {
      const updated = { ...record, blob: null };
      await c.update(updated);
      fileBlobsCleared += 1;
    }
  }
  await fileTx.done;

  return { messagesDeleted, fileBlobsCleared };
}

/** Checks storage quota and runs compaction if over threshold. */
export async function checkAndCompact(): Promise<{ compacted: boolean; messagesDeleted: number; fileBlobsCleared: number }> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return { compacted: false, messagesDeleted: 0, fileBlobsCleared: 0 };
  }

  const estimate = await navigator.storage.estimate();
  if (!estimate.usage || !estimate.quota) return { compacted: false, messagesDeleted: 0, fileBlobsCleared: 0 };

  const usageRatio = estimate.usage / estimate.quota;
  if (usageRatio < STORAGE_QUOTA_THRESHOLD) {
    return { compacted: false, messagesDeleted: 0, fileBlobsCleared: 0 };
  }

  console.log(`[compaction] Storage quota ${Math.round(usageRatio * 100)}% used, running compaction...`);
  const result = await compactDatabase();
  return { compacted: true, ...result };
}

/** Scheduled compaction: runs periodically and on quota pressure. */
let compactionTimer: ReturnType<typeof setInterval> | null = null;

export function scheduleCompaction(intervalMs = 60 * 60 * 1000): void {
  if (compactionTimer) return;
  compactionTimer = setInterval(async () => {
    try {
      await checkAndCompact();
    } catch (error) {
      console.warn("[compaction] scheduled run failed:", error);
    }
  }, intervalMs);
  compactionTimer.unref?.();
}

export function stopCompaction(): void {
  if (compactionTimer) clearInterval(compactionTimer);
  compactionTimer = null;
}

/** Manual trigger for settings "Free up space" button. */
export async function manualCompaction(): Promise<{ messagesDeleted: number; fileBlobsCleared: number }> {
  return compactDatabase();
}