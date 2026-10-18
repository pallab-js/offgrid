import type { Database } from "better-sqlite3";
import { config } from "../config";
import { log } from "../log";

/**
 * Forward-only migration runner — TRD §5.
 *
 * - `schema_version` in `meta` records the last migration applied.
 * - Each pending migration runs in its own transaction **together with its
 *   version bump** — SQLite DDL is transactional, so a failure rolls back
 *   both the schema change and the version, and the next startup retries.
 * - Migrations only ever move forward (id ascending); a database from a
 *   newer build (version ahead of code) is left untouched with a warning.
 * - Baseline (id 1) is idempotent DDL so databases from before the runner
 *   (which carried `schema_version = '1'` + guarded column adds) upgrade by
 *   simply skipping to their first pending step.
 */
export interface Migration {
  id: number;
  name: string;
  up: (db: Database) => void;
}

/** Initial schema (v1): everything a brand-new database needs, latest shape. */
const BASELINE_DDL = `
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    salt TEXT NOT NULL,
    proof TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    settings TEXT NOT NULL DEFAULT '{}',
    key_history TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS tokens (
    hash TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'normal',
    created_at INTEGER NOT NULL,
    rev INTEGER NOT NULL,
    UNIQUE(room_id, name)
  );

  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen INTEGER,
    battery REAL,
    rtt REAL,
    meta TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    client_id TEXT,
    room_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    author TEXT NOT NULL,
    kind TEXT NOT NULL,
    body TEXT,
    iv TEXT,
    reply_to TEXT,
    attachments TEXT NOT NULL DEFAULT '[]',
    reactions TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    deleted_at INTEGER,
    rev INTEGER NOT NULL,
    UNIQUE(room_id, client_id)
  );
  CREATE INDEX IF NOT EXISTS idx_messages_room_ch ON messages(room_id, channel_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_rev ON messages(rev);

  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    name_ct TEXT NOT NULL,
    name_iv TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT,
    enc TEXT NOT NULL DEFAULT 'none',
    path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER,
    rev INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_files_rev ON files(rev);

  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    title_ct TEXT NOT NULL,
    title_iv TEXT NOT NULL,
    body_ct TEXT NOT NULL,
    body_iv TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    updated_by TEXT NOT NULL,
    deleted_at INTEGER,
    rev INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notes_rev ON notes(rev);

  CREATE TABLE IF NOT EXISTS progress (
    room_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    checked INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    updated_by TEXT NOT NULL,
    rev INTEGER NOT NULL,
    PRIMARY KEY (room_id, item_id)
  );
  CREATE INDEX IF NOT EXISTS idx_progress_rev ON progress(rev);

  CREATE TABLE IF NOT EXISTS waypoints (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    lat REAL,
    lng REAL,
    gx REAL,
    gy REAL,
    label_ct TEXT NOT NULL,
    label_iv TEXT NOT NULL,
    color TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    updated_by TEXT NOT NULL,
    deleted_at INTEGER,
    rev INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_waypoints_rev ON waypoints(rev);

  CREATE TABLE IF NOT EXISTS sos_events (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    note_ct TEXT,
    note_iv TEXT,
    lat REAL,
    lng REAL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    cleared_at INTEGER,
    cleared_by TEXT,
    rev INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sos_rev ON sos_events(rev);

  CREATE TABLE IF NOT EXISTS beacons (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    text_ct TEXT NOT NULL,
    text_iv TEXT NOT NULL,
    wpm INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    rev INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_beacons_rev ON beacons(rev);

  CREATE TABLE IF NOT EXISTS rev_seq (v INTEGER NOT NULL);

  CREATE TABLE IF NOT EXISTS reads (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    rev INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reads_rev ON reads(rev);
`;

function hasColumn(db: Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "baseline",
    up: (db) => {
      db.exec(BASELINE_DDL);
      const row = db.prepare("SELECT v FROM rev_seq").get();
      if (!row) db.prepare("INSERT INTO rev_seq (v) VALUES (0)").run();
    },
  },
  {
    // Databases created before the runner existed carry version 1 and got
    // these columns (if at all) through ad-hoc guarded ALTERs; keep the
    // backfill as a real migration so the upgrade is versioned and tested.
    id: 2,
    name: "backfill messages.reactions, files.enc",
    up: (db) => {
      if (!hasColumn(db, "messages", "reactions")) {
        db.exec("ALTER TABLE messages ADD COLUMN reactions TEXT NOT NULL DEFAULT '[]'");
      }
      if (!hasColumn(db, "files", "enc")) {
        db.exec("ALTER TABLE files ADD COLUMN enc TEXT NOT NULL DEFAULT 'none'");
      }
    },
  },
  {
    id: 3,
    name: "tokens.expires_at (sliding expiry)",
    up: (db) => {
      if (!hasColumn(db, "tokens", "expires_at")) {
        db.exec("ALTER TABLE tokens ADD COLUMN expires_at INTEGER");
      }
      // One-time grace: every pre-migration token gets a full window from
      // the upgrade moment, so no deployed device is locked out at the
      // moment expiry ships; the window then slides on each authenticated
      // use and lapses only after TOKEN_TTL_DAYS of disuse.
      db.prepare("UPDATE tokens SET expires_at = ? WHERE expires_at IS NULL").run(
        Date.now() + config.tokenTtlMs,
      );
    },
  },
  {
    // Passphrase rotation (TRD §9.13): `key_history` accumulates one
    // wrapped copy of the previous room key per rotation — AES-GCM(K_new,
    // K_prev) — so holders of the new passphrase can still decrypt content
    // written before the rotation. Rooms start with an empty list.
    id: 4,
    name: "rooms.key_history (passphrase rotation)",
    up: (db) => {
      if (!hasColumn(db, "rooms", "key_history")) {
        db.exec("ALTER TABLE rooms ADD COLUMN key_history TEXT NOT NULL DEFAULT '[]'");
      }
    },
  },
];

function schemaVersion(db: Database): number {
  const meta = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
    .get();
  if (!meta) return 0;
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  const v = Number(row?.value);
  return Number.isInteger(v) ? v : 0;
}

function setSchemaVersion(db: Database, id: number): void {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('schema_version', ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(String(id));
}

/**
 * Idempotent DDL + forward-only runner — TRD §5. Safe to call on every open.
 */
export function migrate(db: Database, migrations: Migration[] = MIGRATIONS): void {
  // Pragmas stay outside transactions (SQLite ignores some of them there).
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec("PRAGMA synchronous=NORMAL;");
  // Bookkeeping table is the runner's own dependency — bootstrap it before
  // any step can record its version, regardless of what the steps create.
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");

  const sorted = [...migrations].sort((a, b) => a.id - b.id);
  const latest = sorted.length > 0 ? sorted[sorted.length - 1]!.id : 0;
  let current = schemaVersion(db);

  if (current > latest) {
    // Data written by a newer build — don't downgrade its bookkeeping.
    log("warn", "db.schema_ahead", { version: current, supported: latest });
    return;
  }

  for (const migration of sorted) {
    if (migration.id <= current) continue;
    const from = current;
    const run = db.transaction(() => {
      migration.up(db);
      setSchemaVersion(db, migration.id);
    });
    run(); // throws → schema + version both rolled back; retried next open
    current = migration.id;
    log("info", "db.migrated", { from, to: migration.id, name: migration.name });
  }
}
