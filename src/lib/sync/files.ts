import { getDb, type FileRecord } from "@/lib/idb/db";
import type { FileMeta } from "@/lib/protocol";

export async function putFileRecord(record: FileRecord): Promise<void> {
  const db = await getDb();
  await db.put("files", record);
}

export async function getFileRecord(id: string): Promise<FileRecord | null> {
  const db = await getDb();
  return (await db.get("files", id)) ?? null;
}

export async function patchFileRecord(
  id: string,
  patch: Partial<FileRecord>,
): Promise<FileRecord | null> {
  const db = await getDb();
  const existing = await db.get("files", id);
  if (!existing) return null;
  const next = { ...existing, ...patch };
  await db.put("files", next);
  return next;
}

export async function listFileRecords(roomId: string): Promise<FileRecord[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex("files", "by-room", roomId);
  return rows.filter((r) => r.roomId === roomId);
}

export function fileRecordFromMeta(meta: FileMeta, roomId: string): FileRecord {
  return {
    id: meta.id,
    roomId,
    deviceId: meta.deviceId,
    name: meta.name,
    mime: meta.mime,
    size: meta.size,
    sha256: meta.sha256,
    createdAt: meta.createdAt,
    deletedAt: meta.deletedAt,
    rev: meta.rev,
    blob: null,
  };
}
