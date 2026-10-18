"use client";

import { useSessionStore } from "@/stores/session";

/**
 * Best-effort server-side revocation of this device's room token — called on
 * Leave and wipe so a lost device's credential stops working immediately
 * instead of only via expiry.
 *
 * Fire-and-forget on purpose: an offline leave still clears local state and
 * the token lapses server-side within TOKEN_TTL_DAYS of its last use; a
 * network failure must never block or surface in the leave flow.
 */
export function revokeOwnToken(): void {
  const { roomId, token } = useSessionStore.getState();
  if (!roomId || !token) return;
  void fetch(`/api/rooms/${encodeURIComponent(roomId)}/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => undefined);
}
