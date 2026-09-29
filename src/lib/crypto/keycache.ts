"use client";

import { importRoomKey, open, seal, type Sealed } from "@/lib/crypto/room";
import { useSessionStore } from "@/stores/session";

let cached: { b64: string; key: CryptoKey } | null = null;
let inflight: Promise<CryptoKey> | null = null;
let inflightB64: string | null = null;

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

export async function sealText(text: string): Promise<Sealed> {
  return seal(await getRoomKey(), text);
}

export async function openText(sealed: Sealed): Promise<string | null> {
  try {
    return await open(await getRoomKey(), sealed);
  } catch {
    return null; // wrong key or tampered ciphertext — UI shows a placeholder
  }
}
