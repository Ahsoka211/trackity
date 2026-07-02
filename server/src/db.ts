import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, "cache.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS player_cache (
    cache_key TEXT PRIMARY KEY,
    riot_id TEXT NOT NULL,
    region TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL,
    data TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );
`);

const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey(kind: string, riotId: string, region: string): string {
  return `${kind}:${riotId.toLowerCase()}:${region.toLowerCase()}`;
}

const selectStmt = db.prepare(
  "SELECT data, fetched_at FROM player_cache WHERE cache_key = ?",
);
const upsertStmt = db.prepare(`
  INSERT INTO player_cache (cache_key, riot_id, region, kind, data, fetched_at)
  VALUES (@cacheKey, @riotId, @region, @kind, @data, @fetchedAt)
  ON CONFLICT(cache_key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at
`);

export function getCached<T>(kind: string, riotId: string, region: string): T | null {
  const row = selectStmt.get(cacheKey(kind, riotId, region)) as
    | { data: string; fetched_at: number }
    | undefined;

  if (!row) return null;
  if (Date.now() - row.fetched_at > CACHE_TTL_MS) return null;
  return JSON.parse(row.data) as T;
}

export function setCached(kind: string, riotId: string, region: string, data: unknown): void {
  upsertStmt.run({
    cacheKey: cacheKey(kind, riotId, region),
    riotId,
    region,
    kind,
    data: JSON.stringify(data),
    fetchedAt: Date.now(),
  });
}
