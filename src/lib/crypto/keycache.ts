"use client";

import { importRoomKey, open, seal, type Sealed } from "@/lib/crypto/room";
import { useSessionStore } from "@/stores/session";

let cached: { b64: string; key: CryptoKey } | null = null;
let inflight: Promise<CryptoKey> | null = null;
let inflightB64: string | null = null;
/** Imported previous-generation keys (post-rotation), keyed by their b64. */
const prevCache = new Map<string, CryptoKey>();

/** Cached AES key for the active room (sessionStorage-backed passphrase). */
export async function getRoomKey(): Promise<CryptoKey> {
  const b64 = useSessionStore.getState().roomKeyB64;
  if (!b64) throw new Error("room key unavailable — join a room first");
  if (cached?.b64 === b64) return cached.key;
  if (inflight && inflightB64 === b64) return inflight;
  inflightB64 = b64;
  inflight = importRoomKey(b64).then((key) => {
    cached = { b64, key };
    inflight = null;
    inflightB64 = null;
    return key;
  });
  return inflight;
}

/**
 * Every key that may decrypt this room's content, current first: the active
 * passphrase key, then previous-generation keys (newest first) unwrapped at
 * join time after a passphrase rotation. Sealing always uses the current
 * key only — decrypt falls back down the chain, so content written before a
 * rotation stays readable.
 */
export async function getRoomKeys(): Promise<CryptoKey[]> {
  const keys: CryptoKey[] = [await getRoomKey()];
  for (const b64 of useSessionStore.getState().prevRoomKeysB64) {
    let key = prevCache.get(b64);
    if (!key) {
      key = await importRoomKey(b64);
      prevCache.set(b64, key);
    }
    keys.push(key);
  }
  return keys;
}

export async function sealText(text: string): Promise<Sealed> {
  return seal(await getRoomKey(), text);
}

export async function openText(sealed: Sealed): Promise<string | null> {
  try {
    return await open(await getRoomKey(), sealed);
  } catch {
    /* current key misses — content may predate a rotation; fall back */
  }
  for (const key of (await getRoomKeys().catch(() => [])).slice(1)) {
    try {
      return await open(key, sealed);
    } catch {
      /* try the next older key */
    }
  }
  return null; // wrong key or tampered ciphertext — UI shows a placeholder
}
