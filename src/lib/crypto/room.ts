import { PBKDF2_ITERATIONS } from "@/lib/protocol";
import { b64ToBytes, bytesToB64 } from "./base64";

const text = new TextEncoder();
const decoder = new TextDecoder();

export interface Sealed {
  ct: string;
  iv: string;
}

/** roomKey = PBKDF2-SHA256(passphrase, salt, 210k) → AES-GCM-256 (SDA §6.2). */
export async function deriveRoomKey(
  passphrase: string,
  saltB64: string,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    text.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: b64ToBytes(saltB64) as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    base,
    { name: "AES-GCM", length: 256 },
    true, // extractable: cached for the tab session
    ["encrypt", "decrypt"],
  );
}

/** proof = HMAC-SHA256(roomKey, "offgrid-room-proof:" + roomId). */
export async function computeProof(
  key: CryptoKey,
  roomId: string,
): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    text.encode(`offgrid-room-proof:${roomId}`),
  );
  return bytesToB64(new Uint8Array(sig));
}

export async function exportRoomKey(key: CryptoKey): Promise<string> {
  return bytesToB64(new Uint8Array(await crypto.subtle.exportKey("raw", key)));
}

export async function importRoomKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    b64ToBytes(b64) as unknown as BufferSource,
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"],
  );
}

export async function seal(key: CryptoKey, plaintext: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    text.encode(plaintext),
  );
  return { ct: bytesToB64(new Uint8Array(ct)), iv: bytesToB64(iv) };
}

export async function open(key: CryptoKey, sealed: Sealed): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBytes(sealed.iv) as unknown as BufferSource },
    key,
    b64ToBytes(sealed.ct) as unknown as BufferSource,
  );
  return decoder.decode(plain);
}
