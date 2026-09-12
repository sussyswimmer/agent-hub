// bun:sqlite against the same database Rust owns. WAL + busy_timeout so both sides can write.
import { Database } from "bun:sqlite";

import { ulid } from "./ulid";

export function openDb(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;");
  return db;
}

export const nowIso = (): string => new Date().toISOString();
export { ulid };

/** Insert a row with generated id/created_at/updated_at; returns the id. */
export function insertRow(db: Database, table: string, fields: Record<string, string | number | null>): string {
  const id = ulid();
  const now = nowIso();
  const cols = ["id", ...Object.keys(fields), "created_at", "updated_at"];
  const values = [id, ...Object.values(fields), now, now];
  db.query(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...values);
  return id;
}

export function schemaVersion(db: Database): number {
  try {
    const row = db.query<{ v: number | null }, []>("SELECT MAX(version) AS v FROM schema_migrations").get();
    return row?.v ?? 0;
  } catch {
    return 0;
  }
}
