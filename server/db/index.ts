import fs from "node:fs";
import Database from "better-sqlite3";
import { dbFile, config } from "../config";
import { migrate } from "./schema";
import { log } from "../log";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(config.dataDir, { recursive: true });
  db = new Database(dbFile());
  migrate(db);
  log("info", "db.open", { file: dbFile() });
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}

/** Monotonic event revision — one row per broadcastable change (SDA §5.2). */
export function nextRev(database: Database.Database = getDb()): number {
  const row = database
    .prepare("UPDATE rev_seq SET v = v + 1 RETURNING v")
    .get() as { v: number };
  return row.v;
}

export function currentRev(database: Database.Database = getDb()): number {
  const row = database.prepare("SELECT v FROM rev_seq").get() as { v: number };
  return row.v;
}
