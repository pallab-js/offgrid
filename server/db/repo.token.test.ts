import { vi, describe, it, expect, afterAll } from "vitest";

vi.hoisted(() => {
  process.env.DATA_DIR = `/tmp/offgrid-token-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.LOG_LEVEL = "error";
});

import { config } from "../config";
import { createRoom, hashToken, issueToken, resolveToken, revokeToken } from "./repo";
import { closeDb, getDb } from "./index";

afterAll(() => {
  closeDb();
});

const ROOM = "01TOKENROOM000000000000001";
const OTHER = "01TOKENROOMB00000000000001";

function setup(): void {
  createRoom({ id: ROOM, name: "Tok", salt: "c2FsdA==", proof: "cHJvb2Y=" });
  createRoom({ id: OTHER, name: "TokB", salt: "c2FsdA==", proof: "cHJvb2Y=" });
}

function expiry(token: string): number | null {
  const row = getDb()
    .prepare("SELECT expires_at FROM tokens WHERE hash = ?")
    .get(hashToken(token)) as { expires_at: number | null } | undefined;
  return row?.expires_at ?? null;
}

function forceExpiry(token: string, at: number): void {
  getDb().prepare("UPDATE tokens SET expires_at = ? WHERE hash = ?").run(at, hashToken(token));
}

describe("token lifecycle (server)", () => {
  setup();

  it("issues tokens that resolve with room, device and hash", () => {
    const token = issueToken(ROOM, "dev-a");
    const resolved = resolveToken(token, ROOM);
    expect(resolved).toMatchObject({
      roomId: ROOM,
      deviceId: "dev-a",
      tokenHash: hashToken(token),
    });
    const at = expiry(token)!;
    expect(at).toBeGreaterThan(Date.now());
    expect(at).toBeLessThanOrEqual(Date.now() + config.tokenTtlMs + 1_000);
  });

  it("treats expired tokens as invalid", () => {
    const token = issueToken(ROOM, "dev-a");
    forceExpiry(token, Date.now() - 1);
    expect(resolveToken(token, ROOM)).toBeNull();
  });

  it("slides the expiry forward on every successful resolution", () => {
    const token = issueToken(ROOM, "dev-a");
    const soon = Date.now() + 60_000;
    forceExpiry(token, soon);
    expect(resolveToken(token, ROOM)).not.toBeNull();
    const at = expiry(token)!;
    expect(at).toBeGreaterThan(soon);
    expect(at).toBeGreaterThanOrEqual(Date.now() + config.tokenTtlMs - 1_000);
  });

  it("neither accepts nor refreshes a token presented for a foreign room", () => {
    const token = issueToken(ROOM, "dev-a");
    const at = expiry(token);
    expect(resolveToken(token, OTHER)).toBeNull();
    expect(expiry(token)).toBe(at);
  });

  it("revokes room-scoped and idempotently", () => {
    const token = issueToken(ROOM, "dev-a");
    expect(revokeToken(token, OTHER)).toBe(false); // wrong room deletes nothing
    expect(resolveToken(token, ROOM)).not.toBeNull();
    expect(revokeToken(token, ROOM)).toBe(true);
    expect(resolveToken(token, ROOM)).toBeNull();
    expect(revokeToken(token, ROOM)).toBe(false);
  });
});
