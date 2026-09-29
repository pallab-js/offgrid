const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(out);
  } else {
    for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

function encodeTime(now: number): string {
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[now % 32] + out;
    now = Math.floor(now / 32);
  }
  return out;
}

function encodeRandom(len: number): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += CROCKFORD[bytes[i]! % 32];
  return out;
}

/** 26-char lexicographically sortable id (ULID, Crockford base32). */
export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom(16);
}

/** URL-safe random token (default 32 bytes → 43 chars). */
export function randomToken(bytes = 32): string {
  const buf = randomBytes(bytes);
  let binary = "";
  for (const b of buf) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
