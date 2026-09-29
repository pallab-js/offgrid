import type { Database } from "better-sqlite3";

/** Idempotent DDL — TRD §5. */
export function migrate(db: Database): void {
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    PRAGMA synchronous=NORMAL;

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
      settings TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS tokens (
      hash TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
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
  `);

  const row = db.prepare("SELECT v FROM rev_seq").get() as { v: number } | undefined;
  if (!row) db.prepare("INSERT INTO rev_seq (v) VALUES (0)").run();

  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('schema_version', '1') ON CONFLICT(key) DO NOTHING",
  ).run();
}
