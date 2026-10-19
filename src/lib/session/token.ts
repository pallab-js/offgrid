"use client";

import { useSessionStore } from "@/stores/session";
import { enqueueHttpRequest } from "@/lib/sync/httpOutbox";

/**
 * Best-effort server-side revocation of this device's room tokens — called on
 * Leave and wipe so a lost device's credential stops working immediately
 * instead of only via expiry. The body carries our deviceId so the hub
 * removes every token row this device accumulated (one per past join), not
 * just the presented one.
 *
 * Queued in HTTP outbox: if the hub is unreachable, the revocation is stored
 * locally and retried when the app comes back online. The leave flow never
 * blocks on network; local state is cleared immediately.
 */
export function revokeOwnToken(): void {
  const { roomId, token, deviceId } = useSessionStore.getState();
  if (!roomId || !token || !deviceId) return;
  void enqueueHttpRequest(
    `/api/rooms/${encodeURIComponent(roomId)}/revoke`,
    "POST",
    {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    { deviceId },
  );
}

/**
 * Moderator action: revoke every token another device holds in the room
 * (lost/stolen member device). Returns the number of token rows removed, or
 * null on failure — callers surface the result, so this one is not silent.
 */
export async function revokeDeviceToken(targetDeviceId: string): Promise<number | null> {
  const { roomId, token } = useSessionStore.getState();
  if (!roomId || !token) return null;
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/revoke`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ deviceId: targetDeviceId }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { tokens?: number };
    return body.tokens ?? 0;
  } catch {
    return null;
  }
}
