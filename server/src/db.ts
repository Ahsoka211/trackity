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
  CREATE INDEX IF NOT EXISTS idx_matches_queue ON matches (queue_id);
  CREATE INDEX IF NOT EXISTS idx_matches_map ON matches (map_name);
  CREATE INDEX IF NOT EXISTS idx_matches_started ON matches (started_at);

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
  CREATE INDEX IF NOT EXISTS idx_match_players_agent ON match_players (agent_name);

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

  CREATE TABLE IF NOT EXISTS match_analysis (
    match_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS round_player_stats (
    match_id TEXT NOT NULL REFERENCES matches(match_id),
    round_num INTEGER NOT NULL,
    puuid TEXT NOT NULL,
    team_id TEXT NOT NULL,
    score INTEGER NOT NULL,
    kills INTEGER NOT NULL,
    headshots INTEGER NOT NULL,
    bodyshots INTEGER NOT NULL,
    legshots INTEGER NOT NULL,
    damage INTEGER NOT NULL,
    loadout_value INTEGER,
    remaining INTEGER,
    weapon_id TEXT,
    weapon_name TEXT,
    UNIQUE (match_id, round_num, puuid)
  );
`);

// Match data now lives in the tables above; the old TTL-cache rows for it are dead weight.
db.exec("DELETE FROM player_cache WHERE kind IN ('matches', 'match_details')");

// Matches stored before round_player_stats existed can't be backfilled from
// the store, so wipe them once; the next sync refetches everything.
const SCHEMA_VERSION = 1;
if ((db.pragma("user_version", { simple: true }) as number) < SCHEMA_VERSION) {
  db.exec(`
    DELETE FROM kills;
    DELETE FROM rounds;
    DELETE FROM round_player_stats;
    DELETE FROM match_players;
    DELETE FROM matches;
  `);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

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

// Like getCached, but with a caller-supplied TTL instead of the fixed 5-minute
// one — for cache entries that are just freshness markers (no data payload
// worth returning) rather than lookup results.
export function isCacheFresh(kind: string, riotId: string, region: string, ttlMs: number): boolean {
  const row = selectStmt.get(cacheKey(kind, riotId, region)) as
    | { data: string; fetched_at: number }
    | undefined;
  return row !== undefined && Date.now() - row.fetched_at <= ttlMs;
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

const insertRoundPlayerStatsStmt = db.prepare(`
  INSERT OR IGNORE INTO round_player_stats (
    match_id, round_num, puuid, team_id, score, kills,
    headshots, bodyshots, legshots, damage,
    loadout_value, remaining, weapon_id, weapon_name
  ) VALUES (
    @matchId, @roundNum, @puuid, @teamId, @score, @kills,
    @headshots, @bodyshots, @legshots, @damage,
    @loadoutValue, @remaining, @weaponId, @weaponName
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

    for (const s of r.stats ?? []) {
      insertRoundPlayerStatsStmt.run({
        matchId: meta.match_id,
        roundNum: r.id,
        puuid: s.player.puuid,
        teamId: s.player.team,
        score: s.stats.score,
        kills: s.stats.kills,
        headshots: s.stats.headshots,
        bodyshots: s.stats.bodyshots,
        legshots: s.stats.legshots,
        damage: s.damage_events.reduce((total, e) => total + e.damage, 0),
        loadoutValue: s.economy?.loadout_value ?? null,
        remaining: s.economy?.remaining ?? null,
        weaponId: s.economy?.weapon?.id ?? null,
        weaponName: s.economy?.weapon?.name ?? null,
      });
    }
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

const matchPlayersStmt = db.prepare(
  "SELECT * FROM match_players WHERE match_id = ?",
);

const getMatchStmt = db.prepare("SELECT * FROM matches WHERE match_id = ?");

export function getMatch(matchId: string): StoredMatchRow | undefined {
  return getMatchStmt.get(matchId) as StoredMatchRow | undefined;
}

// --- On-demand match analysis cache (permanent per match; a finished match's
// scoreboard never changes, so re-viewing must not re-trigger API calls) ---

const getAnalysisStmt = db.prepare("SELECT data FROM match_analysis WHERE match_id = ?");
const setAnalysisStmt = db.prepare(`
  INSERT INTO match_analysis (match_id, data, created_at) VALUES (?, ?, ?)
  ON CONFLICT(match_id) DO UPDATE SET data = excluded.data, created_at = excluded.created_at
`);

export function getMatchAnalysis<T>(matchId: string): T | null {
  const row = getAnalysisStmt.get(matchId) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as T) : null;
}

export function setMatchAnalysis(matchId: string, data: unknown): void {
  setAnalysisStmt.run(matchId, JSON.stringify(data), Date.now());
}

const countPlayerMatchesStmt = db.prepare(
  "SELECT COUNT(*) AS n FROM match_players WHERE puuid = ?",
);

export function countPlayerMatches(puuid: string): number {
  return (countPlayerMatchesStmt.get(puuid) as { n: number }).n;
}

export function getMatchPlayers(matchId: string): StoredMatchPlayerRow[] {
  return matchPlayersStmt.all(matchId) as StoredMatchPlayerRow[];
}

export interface PlayerMatchFilter {
  queueId?: string;
  map?: string;
  agent?: string;
  // ISO timestamp lower bound on started_at
  since?: string;
}

export interface PlayerMatchWithStatsRow extends StoredMatchRow {
  agent_id: string;
  agent_name: string;
  team_id: string;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  headshots: number;
  bodyshots: number;
  legshots: number;
}

// Filtered, newest-first match rows joined with the player's own per-match
// stats. Prepared per call because the WHERE clause is dynamic; every filter
// column is indexed.
export function getPlayerMatchRows(
  puuid: string,
  filter: PlayerMatchFilter = {},
): PlayerMatchWithStatsRow[] {
  const clauses = ["mp.puuid = @puuid"];
  const params: Record<string, string> = { puuid };
  if (filter.queueId) {
    clauses.push("m.queue_id = @queueId");
    params.queueId = filter.queueId;
  }
  if (filter.map) {
    clauses.push("m.map_name = @map");
    params.map = filter.map;
  }
  if (filter.agent) {
    clauses.push("mp.agent_name = @agent");
    params.agent = filter.agent;
  }
  if (filter.since) {
    clauses.push("m.started_at >= @since");
    params.since = filter.since;
  }
  return db
    .prepare(
      `SELECT m.*, mp.agent_id, mp.agent_name, mp.team_id,
              mp.kills, mp.deaths, mp.assists, mp.score,
              mp.headshots, mp.bodyshots, mp.legshots
       FROM matches m
       JOIN match_players mp ON mp.match_id = m.match_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY m.started_at DESC`,
    )
    .all(params) as PlayerMatchWithStatsRow[];
}

export interface PlayerFilterOptions {
  modes: { id: string; name: string }[];
  maps: string[];
  agents: string[];
}

const playerModesStmt = db.prepare(`
  SELECT DISTINCT m.queue_id AS id, m.queue_name AS name
  FROM matches m
  JOIN match_players mp ON mp.match_id = m.match_id
  WHERE mp.puuid = ?
  ORDER BY name
`);

const playerMapsStmt = db.prepare(`
  SELECT DISTINCT m.map_name AS map
  FROM matches m
  JOIN match_players mp ON mp.match_id = m.match_id
  WHERE mp.puuid = ?
  ORDER BY map
`);

const playerAgentsStmt = db.prepare(
  "SELECT DISTINCT agent_name FROM match_players WHERE puuid = ? ORDER BY agent_name",
);

// Dropdown options are derived from what's actually stored for the player,
// unaffected by the active filter so narrowing never collapses the choices.
export function getPlayerFilterOptions(puuid: string): PlayerFilterOptions {
  return {
    modes: playerModesStmt.all(puuid) as { id: string; name: string }[],
    maps: (playerMapsStmt.all(puuid) as { map: string }[]).map((r) => r.map),
    agents: (playerAgentsStmt.all(puuid) as { agent_name: string }[]).map(
      (r) => r.agent_name,
    ),
  };
}
