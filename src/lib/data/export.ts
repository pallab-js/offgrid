"use client";

import { getDb } from "@/lib/idb/db";
import type { Cipher } from "@/lib/protocol";
import { openText } from "@/lib/crypto/keycache";
import { useSessionStore } from "@/stores/session";
import { saveBlob } from "@/lib/files/api";

export const EXPORT_FORMAT = "offgrid-export";
export const EXPORT_VERSION = 1;

type Decrypted = string | { ct: string; iv: string };

async function maybeOpen(cipher: Cipher): Promise<Decrypted> {
  const text = await openText(cipher);
  return text ?? { ct: cipher.ct, iv: cipher.iv };
}

/**
 * Full local export: everything in IndexedDB for this device. Text fields
 * become plaintext while the room key is unlocked, ciphertext otherwise.
 * File blobs are excluded (metadata only) to keep exports human-sized.
 */
export async function buildExport(): Promise<string> {
  const db = await getDb();
  const { deviceId, profile, roomId, roomName } = useSessionStore.getState();
  const roomIdFilter = (row: { roomId: string }) => row.roomId === roomId;

  const [messages, files, notes, waypoints, progress, sos] = await Promise.all([
    db.getAll("messages"),
    db.getAll("files"),
    db.getAll("notes"),
    db.getAll("waypoints"),
    db.getAll("progress"),
    db.getAll("sos"),
  ]);

  const roomMessages = messages.filter(roomIdFilter);
  const out = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    device: { id: deviceId, name: profile?.name ?? null, color: profile?.color ?? null },
    room: { id: roomId, name: roomName },
    counts: {
      messages: roomMessages.length,
      notes: notes.filter(roomIdFilter).length,
      files: files.filter(roomIdFilter).length,
      waypoints: waypoints.filter(roomIdFilter).length,
      progress: progress.filter(roomIdFilter).length,
      sos: sos.filter(roomIdFilter).length,
    },
    messages: await Promise.all(
      roomMessages.map(async (m) => ({
        uid: m.uid,
        channelId: m.channelId,
        author: m.author,
        kind: m.kind,
        body: m.body ? await maybeOpen(m.body) : null,
        replyTo: m.replyTo,
        attachments: m.attachments,
        createdAt: m.createdAt,
        deletedAt: m.deletedAt,
      })),
    ),
    notes: await Promise.all(
      notes
        .filter(roomIdFilter)
        .map(async (n) => ({
          id: n.id,
          title: await maybeOpen(n.title),
          body: await maybeOpen(n.body),
          updatedAt: n.updatedAt,
          updatedBy: n.updatedBy,
          deletedAt: n.deletedAt,
        })),
    ),
    files: files
      .filter(roomIdFilter)
      .map((f) => ({
        id: f.id,
        mime: f.mime,
        size: f.size,
        sha256: f.sha256,
        createdAt: f.createdAt,
        deletedAt: f.deletedAt,
        hasLocalBlob: f.blob !== null,
      })),
    waypoints: await Promise.all(
      waypoints
        .filter(roomIdFilter)
        .map(async (w) => ({
          id: w.id,
          lat: w.lat,
          lng: w.lng,
          gx: w.gx,
          gy: w.gy,
          label: await maybeOpen(w.label),
          color: w.color,
          updatedAt: w.updatedAt,
          deletedAt: w.deletedAt,
        })),
    ),
    progress: progress
      .filter(roomIdFilter)
      .map((p) => ({
        itemId: p.itemId,
        checked: p.checked,
        updatedAt: p.updatedAt,
        updatedBy: p.updatedBy,
      })),
    sos: await Promise.all(
      sos
        .filter(roomIdFilter)
        .map(async (s) => ({
          id: s.id,
          deviceId: s.deviceId,
          note: s.note ? await maybeOpen(s.note) : null,
          lat: s.lat,
          lng: s.lng,
          active: s.active,
          createdAt: s.createdAt,
          clearedAt: s.clearedAt,
        })),
    ),
  };

  return JSON.stringify(out, null, 2);
}

export function downloadExport(): Promise<void> {
  return buildExport().then((json) => {
    const stamp = new Date().toISOString().slice(0, 10);
    saveBlob(new Blob([json], { type: "application/json" }), `offgrid-export-${stamp}.json`);
  });
}

/** Full local wipe: session, room key cache, and the IndexedDB database. */
export async function wipeLocalData(): Promise<void> {
  const { reset } = useSessionStore.getState();
  reset();
  try {
    const { closeDb } = await import("@/lib/idb/db");
    await closeDb();
  } catch {
    /* ignore */
  }
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("offgrid");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
  window.location.reload();
}
