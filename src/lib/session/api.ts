"use client";

import { useSessionStore } from "@/stores/session";

/**
 * Hub REST calls made with (or minted by) room credentials. Kept apart from
 * `token.ts` (revocation) so each module has one job.
 */

export interface JoinResponse {
  token: string;
  moderators: string[];
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
  const body = (await res.json()) as { token: string; moderators?: string[] };
  return { token: body.token, moderators: Array.isArray(body.moderators) ? body.moderators : [] };
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
  const body = (await res.json()) as { moderators?: string[] };
  return Array.isArray(body.moderators) ? body.moderators : [];
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
  const body = (await res.json()) as { cleared?: number };
  return body.cleared ?? 0;
}
