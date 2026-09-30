import { getDb, type MessageRecord } from "@/lib/idb/db";
import { openText } from "@/lib/crypto/keycache";
import type { Message } from "@/lib/protocol";

export function compareMessages(a: MessageRecord, b: MessageRecord): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
}

export async function putRecord(record: MessageRecord): Promise<void> {
  const db = await getDb();
  await db.put("messages", record);
}

export async function patchRecord(
  uid: string,
  patch: Partial<MessageRecord>,
): Promise<MessageRecord | null> {
  const db = await getDb();
  const existing = await db.get("messages", uid);
  if (!existing) return null;
  const next = { ...existing, ...patch };
  await db.put("messages", next);
  return next;
}

export async function removeRecord(uid: string): Promise<void> {
  const db = await getDb();
  await db.delete("messages", uid);
}

export async function getRecord(uid: string): Promise<MessageRecord | null> {
  const db = await getDb();
  return (await db.get("messages", uid)) ?? null;
}

export async function findByClientId(
  clientId: string,
): Promise<MessageRecord | null> {
  const db = await getDb();
  return (await db.getFromIndex("messages", "by-client", clientId)) ?? null;
}

export async function findByServerId(
  serverId: string,
): Promise<MessageRecord | null> {
  const db = await getDb();
  return (await db.getFromIndex("messages", "by-server", serverId)) ?? null;
}

export async function listByChannel(channelId: string): Promise<MessageRecord[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex("messages", "by-channel", channelId);
  return rows.sort(compareMessages);
}

/** Outbox: unsent messages plus tombstones still owed to the hub. */
export async function listPending(): Promise<MessageRecord[]> {
  const db = await getDb();
  const rows = await db.getAll("messages");
  return rows
    .filter((r) => r.status === "pending" || (r.deletePending && r.serverId))
    .sort(compareMessages);
}

export function recordFromServer(msg: Message, roomId: string): MessageRecord {
  return {
    uid: msg.clientId ?? msg.id,
    roomId,
    clientId: msg.clientId,
    serverId: msg.id,
    channelId: msg.channelId,
    deviceId: msg.deviceId,
    author: msg.author,
    kind: msg.kind,
    body: msg.body,
    replyTo: msg.replyTo,
    attachments: msg.attachments,
    reactions: msg.reactions ?? [],
    createdAt: msg.createdAt,
    deletedAt: msg.deletedAt,
    rev: msg.rev,
    status: "synced",
    attempts: 0,
    deletePending: false,
  };
}

/** Decrypt a stored record into its renderable form. */
export async function decryptText(record: MessageRecord): Promise<string | null> {
  if (record.deletedAt !== null || record.kind === "system" || !record.body) {
    return null;
  }
  return openText(record.body);
}
