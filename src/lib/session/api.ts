"use client";

import { z } from "zod";
import { useSessionStore } from "@/stores/session";

/**
 * Hub REST calls made with (or minted by) room credentials. Kept apart from
 * `token.ts` (revocation) so each module has one job.
 */

interface Sealed {
  ct: string;
  iv: string;
}

export interface JoinResponse {
  token: string;
  moderators: string[];
  /** Wrapped previous room keys (oldest first) — see TRD §9.13. */
  keyHistory: Sealed[];
}

// Zod schemas for API response validation
const sealedSchema = z.object({
  ct: z.string().min(1),
  iv: z.string().min(1),
});

const joinResponseSchema = z.object({
  token: z.string().min(1),
  moderators: z.array(z.string()).default([]),
  keyHistory: z.array(sealedSchema).default([]),
});

const moderatorsResponseSchema = z.object({
  moderators: z.array(z.string()).optional(),
});

const clearedResponseSchema = z.object({
  cleared: z.number().int().nonnegative().optional(),
});

function parseJson<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid API response: ${issues}`);
  }
  return result.data;
}

/**
 * Exchanges a passphrase proof for a fresh device token. Throws with a
 * human-readable message: 403 means the proof did not match (wrong or
 * rotated passphrase), everything else is transient.
 */
export async function postRoomJoin(
  roomId: string,
  input: { deviceId: string; name: string; color: string; proof: string },
): Promise<JoinResponse> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status === 403) {
    throw new Error("Wrong passphrase for this room.");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new Error(body?.error?.message ?? "Could not join the room.");
  }
  const body = await res.json();
  return parseJson(joinResponseSchema, body);
}

/** Adds or removes one device from the room's moderator list (moderator-only). */
export async function setRoomModerator(
  roomId: string,
  deviceId: string,
  on: boolean,
): Promise<string[]> {
  const { token } = useSessionStore.getState();
  if (!token) throw new Error("Not connected to this room.");
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/mods`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ deviceId, on }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new Error(body?.error?.message ?? "Could not update moderators.");
  }
  const body = await res.json();
  const parsed = parseJson(moderatorsResponseSchema, body);
  return parsed.moderators ?? [];
}

/** Bulk-clears the room's join notices (moderator-only). Returns count cleared. */
export async function clearJoinNotices(roomId: string): Promise<number> {
  const { token } = useSessionStore.getState();
  if (!token) throw new Error("Not connected to this room.");
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/notices/clear`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new Error(body?.error?.message ?? "Could not clear join notices.");
  }
  const body = await res.json();
  const parsed = parseJson(clearedResponseSchema, body);
  return parsed.cleared ?? 0;
}

/**
 * Rotates the room passphrase: swaps salt+proof, wraps the previous room
 * key under the new one (`prevKey`), and revokes every token in the room.
 * 403 means `oldProof` did not match the current passphrase — the room was
 * left untouched.
 */
export async function rotateRoom(
  roomId: string,
  input: { oldProof: string; salt: string; proof: string; prevKey: Sealed },
): Promise<void> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/rotate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status === 403) {
    throw new Error("Current passphrase is wrong — the room was not changed.");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new Error(body?.error?.message ?? "Could not rotate the passphrase.");
  }
}
