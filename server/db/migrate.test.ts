import { vi, describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

vi.hoisted(() => {
  process.env.DATA_DIR = `/tmp/offgrid-mig-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.LOG_LEVEL = "error";
});

import { MIGRATIONS, migrate, type Migration } from "./schema";

const dirs: string[] = [];

function openDb(): Database.Database {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "offgrid-mig-"));
  dirs.push(dir);
  return new Database(path.join(dir, "mig.db"));
}

afterEach(() => {
  while (dirs.length > 0) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

const LATEST = MIGRATIONS[MIGRATIONS.length - 1]!.id;

function version(db: Database.Database): number | null {
  const meta = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
    .get();
  if (!meta) return null;
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  if (!row) return null;
  const v = Number(row.value);
  return Number.isInteger(v) ? v : 0; // unparseable → runner restarts from 0
}

function table(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

function hasColumn(db: Database.Database, name: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

describe("migration runner", () => {
  it("builds a fresh database at the latest version with the full schema", () => {
    const db = openDb();
    migrate(db);

    expect(version(db)).toBe(LATEST);
    for (const name of [
      "meta",
      "rooms",
      "tokens",
      "channels",
      "devices",
      "messages",
      "files",
      "notes",
      "progress",
      "waypoints",
      "sos_events",
      "beacons",
      "rev_seq",
      "reads",
    ]) {
      expect(table(db, name), `table ${name}`).toBe(true);
    }
    expect(hasColumn(db, "messages", "reactions")).toBe(true);
    expect(hasColumn(db, "files", "enc")).toBe(true);
    expect((db.prepare("SELECT v FROM rev_seq").get() as { v: number }).v).toBe(0);
    db.close();
  });

  it("upgrades a legacy pre-runner database (v1, columns absent)", () => {
    const db = openDb();
    migrate(db);
    // Reshape to the pre-runner state: version 1 bookkeeping, no backfills.
    db.exec("ALTER TABLE messages DROP COLUMN reactions");
    db.exec("ALTER TABLE files DROP COLUMN enc");
    db.prepare("UPDATE meta SET value = '1' WHERE key = 'schema_version'").run();
    expect(version(db)).toBe(1);
    expect(hasColumn(db, "messages", "reactions")).toBe(false);

    migrate(db);

    expect(version(db)).toBe(LATEST);
    expect(hasColumn(db, "messages", "reactions")).toBe(true);
    expect(hasColumn(db, "files", "enc")).toBe(true);
    db.close();
  });

  it("is idempotent across repeated opens", () => {
    const db = openDb();
    migrate(db);
    const first = version(db);
    migrate(db);
    migrate(db);
    expect(version(db)).toBe(first);
    db.close();
  });

  it("rolls back schema changes and the version bump when a step fails", () => {
    const db = openDb();
    const steps: Migration[] = [
      { id: 1, name: "ok", up: (d) => d.exec("CREATE TABLE step_one (x INTEGER)") },
      {
        id: 2,
        name: "boom",
        up: (d) => {
          d.exec("CREATE TABLE step_two (x INTEGER)");
          throw new Error("boom");
        },
      },
    ];

    expect(() => migrate(db, steps)).toThrow("boom");

    // Failed step: no partial DDL, version not advanced → retried next open.
    expect(version(db)).toBe(1);
    expect(table(db, "step_one")).toBe(true);
    expect(table(db, "step_two")).toBe(false);
    db.close();
  });

  it("applies steps in id order regardless of input order", () => {
    const db = openDb();
    migrate(db, [
      { id: 2, name: "second", up: (d) => d.exec("CREATE TABLE b (x INTEGER)") },
      { id: 1, name: "first", up: (d) => d.exec("CREATE TABLE a (x INTEGER)") },
    ]);
    expect(table(db, "a")).toBe(true);
    expect(table(db, "b")).toBe(true);
    expect(version(db)).toBe(2);
    db.close();
  });

  it("leaves a database written by a newer build untouched", () => {
    const db = openDb();
    migrate(db);
    db.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(String(LATEST + 5));

    migrate(db); // supported max is LATEST < stored version → no-op, no downgrade

    expect(version(db)).toBe(LATEST + 5);
    db.close();
  });

  it("heals unparseable version bookkeeping by re-running idempotent steps", () => {
    const db = openDb();
    migrate(db);
    db.prepare("UPDATE meta SET value = 'garbage' WHERE key = 'schema_version'").run();
    expect(version(db)).toBe(0);

    migrate(db); // 0 → baseline (IF NOT EXISTS) → backfill (guarded) → latest

    expect(version(db)).toBe(LATEST);
    expect(hasColumn(db, "messages", "reactions")).toBe(true);
    db.close();
  });

  it("adds tokens.expires_at with a one-time grace for pre-expiry tokens", () => {
    const db = openDb();
    migrate(db, MIGRATIONS.filter((m) => m.id < 3));
    // Baseline is latest-shape; drop the column to emulate a pre-expiry DB.
    db.exec("ALTER TABLE tokens DROP COLUMN expires_at");
    db.prepare("INSERT INTO rooms (id, name, salt, proof, created_at) VALUES (?, ?, ?, ?, ?)").run(
      "r-grace",
      "Grace",
      "c2FsdA==",
      "cHJvb2Y=",
      Date.now(),
    );
    // Minted 40 days ago: created_at + TTL would already be in the past, so
    // a naive backfill would lock the device out at the upgrade moment.
    const issued = Date.now() - 40 * 86_400_000;
    db.prepare("INSERT INTO tokens (hash, room_id, device_id, created_at) VALUES (?, ?, ?, ?)").run(
      "hash-grace",
      "r-grace",
      "d1",
      issued,
    );

    migrate(db);

    expect(hasColumn(db, "tokens", "expires_at")).toBe(true);
    const row = db.prepare("SELECT expires_at FROM tokens WHERE hash = 'hash-grace'").get() as {
      expires_at: number;
    };
    expect(row.expires_at).toBeGreaterThan(Date.now()); // grace, not expired
    expect(version(db)).toBe(LATEST);
    db.close();
  });

  it("adds rooms.key_history with an empty list for pre-rotation rooms", () => {
    const db = openDb();
    migrate(db, MIGRATIONS.filter((m) => m.id < 4));
    // Baseline is latest-shape; drop the column to emulate a pre-rotation DB.
    db.exec("ALTER TABLE rooms DROP COLUMN key_history");
    db.prepare("INSERT INTO rooms (id, name, salt, proof, created_at) VALUES (?, ?, ?, ?, ?)").run(
      "r-pre",
      "Pre",
      "c2FsdA==",
      "cHJvb2Y=",
      Date.now(),
    );

    migrate(db);

    expect(hasColumn(db, "rooms", "key_history")).toBe(true);
    const row = db.prepare("SELECT key_history FROM rooms WHERE id = 'r-pre'").get() as {
      key_history: string;
    };
    expect(JSON.parse(row.key_history)).toEqual([]); // no rotations yet
    expect(version(db)).toBe(LATEST);
    db.close();
  });
});
