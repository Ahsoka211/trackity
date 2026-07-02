import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { FullMatchDetails } from "./valorantApi";

const DATA_DIR = path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, "cache.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS player_cache (
    cache_key TEXT PRIMARY KEY,
    riot_id TEXT NOT NULL,
    region TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL,
    data TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS matches (
    match_id TEXT PRIMARY KEY,
    region TEXT NOT NULL,
    map_id TEXT NOT NULL,
    map_name TEXT NOT NULL,
    queue_id TEXT NOT NULL,
    queue_name TEXT NOT NULL,
    mode_type TEXT,
    season_short TEXT,
    started_at TEXT NOT NULL,
    game_length_in_ms INTEGER NOT NULL,
    rounds_played INTEGER NOT NULL,
    teams_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS match_players (
    match_id TEXT NOT NULL REFERENCES matches(match_id),
    puuid TEXT NOT NULL,
    name TEXT NOT NULL,
    tag TEXT NOT NULL,
    team_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    score INTEGER NOT NULL,
    kills INTEGER NOT NULL,
    deaths INTEGER NOT NULL,
    assists INTEGER NOT NULL,
    headshots INTEGER NOT NULL,
    bodyshots INTEGER NOT NULL,
    legshots INTEGER NOT NULL,
    damage_dealt INTEGER NOT NULL,
    damage_received INTEGER NOT NULL,
    tier_id INTEGER,
    tier_name TEXT,
    account_level INTEGER,
    UNIQUE (match_id, puuid)
  );
  CREATE INDEX IF NOT EXISTS idx_match_players_puuid ON match_players (puuid);

  CREATE TABLE IF NOT EXISTS rounds (
    match_id TEXT NOT NULL REFERENCES matches(match_id),
    round_num INTEGER NOT NULL,
    result TEXT NOT NULL,
    ceremony TEXT,
    winning_team TEXT,
    plant_time_in_round_ms INTEGER,
    plant_site TEXT,
    plant_player_puuid TEXT,
    defuse_time_in_round_ms INTEGER,
    defuse_player_puuid TEXT,
    UNIQUE (match_id, round_num)
  );

  CREATE TABLE IF NOT EXISTS kills (
    match_id TEXT NOT NULL REFERENCES matches(match_id),
    round_num INTEGER NOT NULL,
    time_in_round_ms INTEGER NOT NULL,
    time_in_match_ms INTEGER NOT NULL,
    killer_puuid TEXT NOT NULL,
    victim_puuid TEXT NOT NULL,
    assistant_puuids TEXT NOT NULL,
    weapon_id TEXT,
    weapon_name TEXT,
    weapon_type TEXT,
    secondary_fire_mode INTEGER NOT NULL DEFAULT 0,
    location_x INTEGER,
    location_y INTEGER,
    UNIQUE (match_id, round_num, time_in_match_ms, killer_puuid, victim_puuid)
  );
  CREATE INDEX IF NOT EXISTS idx_kills_match ON kills (match_id);
`);

// Match data now lives in the tables above; the old TTL-cache rows for it are dead weight.
db.exec("DELETE FROM player_cache WHERE kind IN ('matches', 'match_details')");

// --- 5-minute TTL cache (account + rank/MMR lookups only) ---

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

// --- Permanent match store ---

export interface StoredMatchRow {
  match_id: string;
  region: string;
  map_id: string;
  map_name: string;
  queue_id: string;
  queue_name: string;
  mode_type: string | null;
  season_short: string | null;
  started_at: string;
  game_length_in_ms: number;
  rounds_played: number;
  teams_json: string;
}

export interface StoredMatchPlayerRow {
  match_id: string;
  puuid: string;
  name: string;
  tag: string;
  team_id: string;
  agent_id: string;
  agent_name: string;
  score: number;
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  bodyshots: number;
  legshots: number;
  damage_dealt: number;
  damage_received: number;
  tier_id: number | null;
  tier_name: string | null;
  account_level: number | null;
}

const hasMatchStmt = db.prepare("SELECT 1 FROM matches WHERE match_id = ?");

const insertMatchStmt = db.prepare(`
  INSERT OR IGNORE INTO matches (
    match_id, region, map_id, map_name, queue_id, queue_name, mode_type,
    season_short, started_at, game_length_in_ms, rounds_played, teams_json
  ) VALUES (
    @matchId, @region, @mapId, @mapName, @queueId, @queueName, @modeType,
    @seasonShort, @startedAt, @gameLengthInMs, @roundsPlayed, @teamsJson
  )
`);

const insertPlayerStmt = db.prepare(`
  INSERT OR IGNORE INTO match_players (
    match_id, puuid, name, tag, team_id, agent_id, agent_name, score,
    kills, deaths, assists, headshots, bodyshots, legshots,
    damage_dealt, damage_received, tier_id, tier_name, account_level
  ) VALUES (
    @matchId, @puuid, @name, @tag, @teamId, @agentId, @agentName, @score,
    @kills, @deaths, @assists, @headshots, @bodyshots, @legshots,
    @damageDealt, @damageReceived, @tierId, @tierName, @accountLevel
  )
`);

const insertRoundStmt = db.prepare(`
  INSERT OR IGNORE INTO rounds (
    match_id, round_num, result, ceremony, winning_team,
    plant_time_in_round_ms, plant_site, plant_player_puuid,
    defuse_time_in_round_ms, defuse_player_puuid
  ) VALUES (
    @matchId, @roundNum, @result, @ceremony, @winningTeam,
    @plantTimeInRoundMs, @plantSite, @plantPlayerPuuid,
    @defuseTimeInRoundMs, @defusePlayerPuuid
  )
`);

const insertKillStmt = db.prepare(`
  INSERT OR IGNORE INTO kills (
    match_id, round_num, time_in_round_ms, time_in_match_ms,
    killer_puuid, victim_puuid, assistant_puuids,
    weapon_id, weapon_name, weapon_type, secondary_fire_mode,
    location_x, location_y
  ) VALUES (
    @matchId, @roundNum, @timeInRoundMs, @timeInMatchMs,
    @killerPuuid, @victimPuuid, @assistantPuuids,
    @weaponId, @weaponName, @weaponType, @secondaryFireMode,
    @locationX, @locationY
  )
`);

export function hasMatch(matchId: string): boolean {
  return hasMatchStmt.get(matchId) !== undefined;
}

// Returns false (and writes nothing) when the match is already stored.
export const storeFullMatch = db.transaction((match: FullMatchDetails): boolean => {
  const meta = match.metadata;
  const inserted = insertMatchStmt.run({
    matchId: meta.match_id,
    region: meta.region,
    mapId: meta.map.id,
    mapName: meta.map.name,
    queueId: meta.queue.id,
    queueName: meta.queue.name ?? meta.queue.id,
    modeType: meta.queue.mode_type,
    seasonShort: meta.season?.short ?? null,
    startedAt: meta.started_at,
    gameLengthInMs: meta.game_length_in_ms,
    roundsPlayed: match.rounds.length,
    teamsJson: JSON.stringify(match.teams),
  });
  if (inserted.changes === 0) return false;

  for (const p of match.players) {
    insertPlayerStmt.run({
      matchId: meta.match_id,
      puuid: p.puuid,
      name: p.name,
      tag: p.tag,
      teamId: p.team_id,
      agentId: p.agent.id,
      agentName: p.agent.name,
      score: p.stats.score,
      kills: p.stats.kills,
      deaths: p.stats.deaths,
      assists: p.stats.assists,
      headshots: p.stats.headshots,
      bodyshots: p.stats.bodyshots,
      legshots: p.stats.legshots,
      damageDealt: p.stats.damage.dealt,
      damageReceived: p.stats.damage.received,
      tierId: p.tier?.id ?? null,
      tierName: p.tier?.name ?? null,
      accountLevel: p.account_level,
    });
  }

  for (const r of match.rounds) {
    insertRoundStmt.run({
      matchId: meta.match_id,
      roundNum: r.id,
      result: r.result,
      ceremony: r.ceremony,
      winningTeam: r.winning_team,
      plantTimeInRoundMs: r.plant?.round_time_in_ms ?? null,
      plantSite: r.plant?.site ?? null,
      plantPlayerPuuid: r.plant?.player?.puuid ?? null,
      defuseTimeInRoundMs: r.defuse?.round_time_in_ms ?? null,
      defusePlayerPuuid: r.defuse?.player?.puuid ?? null,
    });
  }

  for (const k of match.kills) {
    insertKillStmt.run({
      matchId: meta.match_id,
      roundNum: k.round,
      timeInRoundMs: k.time_in_round_in_ms,
      timeInMatchMs: k.time_in_match_in_ms,
      killerPuuid: k.killer.puuid,
      victimPuuid: k.victim.puuid,
      assistantPuuids: JSON.stringify(k.assistants.map((a) => a.puuid)),
      weaponId: k.weapon?.id ?? null,
      weaponName: k.weapon?.name ?? null,
      weaponType: k.weapon?.type ?? null,
      secondaryFireMode: k.secondary_fire_mode ? 1 : 0,
      locationX: k.location?.x ?? null,
      locationY: k.location?.y ?? null,
    });
  }

  return true;
});

const playerMatchesStmt = db.prepare(`
  SELECT m.*
  FROM matches m
  JOIN match_players mp ON mp.match_id = m.match_id
  WHERE mp.puuid = ?
  ORDER BY m.started_at DESC
  LIMIT ?
`);

const matchPlayersStmt = db.prepare(
  "SELECT * FROM match_players WHERE match_id = ?",
);

export function getPlayerMatches(puuid: string, limit: number): StoredMatchRow[] {
  return playerMatchesStmt.all(puuid, limit) as StoredMatchRow[];
}

export function getMatchPlayers(matchId: string): StoredMatchPlayerRow[] {
  return matchPlayersStmt.all(matchId) as StoredMatchPlayerRow[];
}
