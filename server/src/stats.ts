import { db } from "./db";

// All insights are computed over Standard-mode matches only (competitive,
// unrated, premier); deathmatch-style modes have no teams, sides, or economy.

// Round-type thresholds: average loadout value (credits) per player on the
// player's own team. Pistol rounds are fixed by round number instead.
const PISTOL_ROUNDS = new Set([0, 12]);
const ECO_MAX_AVG_LOADOUT = 2500;
const FULL_BUY_MIN_AVG_LOADOUT = 4000;

// Death-phase boundaries relative to round start. A death after the spike
// plant counts as post-plant regardless of the clock.
const OPENING_PHASE_MAX_MS = 15_000;
const MID_PHASE_MAX_MS = 35_000;

export type RoundType = "pistol" | "eco" | "semi" | "fullBuy" | "unknown";
export type RoundPhase = "opening" | "mid" | "late" | "postPlant";

const ROUND_TYPES: RoundType[] = ["pistol", "eco", "semi", "fullBuy", "unknown"];
const ROUND_PHASES: RoundPhase[] = ["opening", "mid", "late", "postPlant"];

// --- row shapes ---

interface PlayerMatchRow {
  match_id: string;
  map_name: string;
  rounds_played: number;
  teams_json: string;
  team_id: string;
  agent_id: string;
  agent_name: string;
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  bodyshots: number;
  legshots: number;
  damage_dealt: number;
}

interface TeamMemberRow {
  match_id: string;
  puuid: string;
  team_id: string;
}

interface RoundRow {
  match_id: string;
  round_num: number;
  winning_team: string | null;
  plant_time_in_round_ms: number | null;
  plant_player_puuid: string | null;
  defuse_player_puuid: string | null;
}

interface KillRow {
  match_id: string;
  round_num: number;
  time_in_round_ms: number;
  killer_puuid: string;
  victim_puuid: string;
  weapon_id: string | null;
  weapon_name: string | null;
  weapon_type: string | null;
}

interface RpsRow {
  match_id: string;
  round_num: number;
  puuid: string;
  team_id: string;
  headshots: number;
  bodyshots: number;
  legshots: number;
  loadout_value: number | null;
}

// Every query anchors on the player's Standard-mode matches.
const playerMatchesStmt = db.prepare(`
  SELECT m.match_id, m.map_name, m.rounds_played, m.teams_json,
         mp.team_id, mp.agent_id, mp.agent_name, mp.kills, mp.deaths, mp.assists,
         mp.headshots, mp.bodyshots, mp.legshots, mp.damage_dealt
  FROM matches m
  JOIN match_players mp ON mp.match_id = m.match_id
  WHERE mp.puuid = ? AND m.mode_type = 'Standard'
  ORDER BY m.started_at DESC
`);

const teamMembersStmt = db.prepare(`
  SELECT mp.match_id, mp.puuid, mp.team_id
  FROM match_players mp
  JOIN match_players me ON me.match_id = mp.match_id AND me.puuid = ?
  JOIN matches m ON m.match_id = mp.match_id AND m.mode_type = 'Standard'
`);

const playerRoundsStmt = db.prepare(`
  SELECT r.match_id, r.round_num, r.winning_team,
         r.plant_time_in_round_ms, r.plant_player_puuid, r.defuse_player_puuid
  FROM rounds r
  JOIN match_players me ON me.match_id = r.match_id AND me.puuid = ?
  JOIN matches m ON m.match_id = r.match_id AND m.mode_type = 'Standard'
  ORDER BY r.match_id, r.round_num
`);

const playerKillsStmt = db.prepare(`
  SELECT k.match_id, k.round_num, k.time_in_round_ms,
         k.killer_puuid, k.victim_puuid, k.weapon_id, k.weapon_name, k.weapon_type
  FROM kills k
  JOIN match_players me ON me.match_id = k.match_id AND me.puuid = ?
  JOIN matches m ON m.match_id = k.match_id AND m.mode_type = 'Standard'
  ORDER BY k.match_id, k.round_num, k.time_in_round_ms
`);

const playerRoundStatsStmt = db.prepare(`
  SELECT rps.match_id, rps.round_num, rps.puuid, rps.team_id,
         rps.headshots, rps.bodyshots, rps.legshots, rps.loadout_value
  FROM round_player_stats rps
  JOIN match_players me ON me.match_id = rps.match_id AND me.puuid = ?
  JOIN matches m ON m.match_id = rps.match_id AND m.mode_type = 'Standard'
`);

// --- dataset ---

interface MatchInfo {
  matchId: string;
  map: string;
  roundsPlayed: number;
  myTeam: string;
  agent: string;
  agentId: string;
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  bodyshots: number;
  legshots: number;
  damageDealt: number;
  won: boolean | null;
  teamOf: Map<string, string>;
  teamIds: string[];
  // round_num -> attacking team_id, when it can be determined
  attackTeamByRound: Map<number, string | null>;
}

export interface PlayerDataset {
  puuid: string;
  matches: MatchInfo[];
  byMatch: Map<string, MatchInfo>;
  rounds: RoundRow[];
  roundByKey: Map<string, RoundRow>;
  kills: KillRow[];
  roundTypeByKey: Map<string, RoundType>;
  myRoundStatsByKey: Map<string, RpsRow>;
}

const roundKey = (matchId: string, roundNum: number) => `${matchId}#${roundNum}`;

// The planter is always attacking and the defuser always defending; sides
// within a half are constant, so one signal labels the whole half. Rounds
// with no signal in their half (and unplanted overtime rounds) stay unknown.
function buildAttackTeams(
  match: MatchInfo,
  rounds: RoundRow[],
): Map<number, string | null> {
  const otherTeam = (team: string | undefined): string | null =>
    team === undefined ? null : (match.teamIds.find((t) => t !== team) ?? null);

  const direct = new Map<number, string | null>();
  for (const r of rounds) {
    let attacker: string | null = null;
    if (r.plant_player_puuid) {
      attacker = match.teamOf.get(r.plant_player_puuid) ?? null;
    } else if (r.defuse_player_puuid) {
      attacker = otherTeam(match.teamOf.get(r.defuse_player_puuid));
    }
    direct.set(r.round_num, attacker);
  }

  const halfAttacker = (from: number, to: number): string | null => {
    const votes = new Map<string, number>();
    for (const [num, team] of direct) {
      if (team && num >= from && num < to) votes.set(team, (votes.get(team) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestVotes = 0;
    for (const [team, count] of votes) {
      if (count > bestVotes) [best, bestVotes] = [team, count];
    }
    return best;
  };

  const firstHalf = halfAttacker(0, 12);
  const secondHalf = halfAttacker(12, 24);

  const result = new Map<number, string | null>();
  for (const r of rounds) {
    const half = r.round_num < 12 ? firstHalf : r.round_num < 24 ? secondHalf : null;
    result.set(r.round_num, direct.get(r.round_num) ?? half);
  }
  return result;
}

function classifyRoundType(
  roundNum: number,
  teamAvgLoadout: number | null,
): RoundType {
  if (PISTOL_ROUNDS.has(roundNum)) return "pistol";
  if (teamAvgLoadout === null) return "unknown";
  if (teamAvgLoadout <= ECO_MAX_AVG_LOADOUT) return "eco";
  if (teamAvgLoadout >= FULL_BUY_MIN_AVG_LOADOUT) return "fullBuy";
  return "semi";
}

export function loadPlayerDataset(puuid: string): PlayerDataset {
  const matchRows = playerMatchesStmt.all(puuid) as PlayerMatchRow[];
  const memberRows = teamMembersStmt.all(puuid) as TeamMemberRow[];
  const rounds = playerRoundsStmt.all(puuid) as RoundRow[];
  const kills = playerKillsStmt.all(puuid) as KillRow[];
  const rpsRows = playerRoundStatsStmt.all(puuid) as RpsRow[];

  const membersByMatch = new Map<string, TeamMemberRow[]>();
  for (const row of memberRows) {
    let list = membersByMatch.get(row.match_id);
    if (!list) membersByMatch.set(row.match_id, (list = []));
    list.push(row);
  }
  const roundsByMatch = new Map<string, RoundRow[]>();
  for (const r of rounds) {
    let list = roundsByMatch.get(r.match_id);
    if (!list) roundsByMatch.set(r.match_id, (list = []));
    list.push(r);
  }

  const matches: MatchInfo[] = matchRows.map((row) => {
    const teamOf = new Map<string, string>();
    for (const m of membersByMatch.get(row.match_id) ?? []) teamOf.set(m.puuid, m.team_id);
    const teams = JSON.parse(row.teams_json) as {
      team_id: string;
      rounds: { won: number; lost: number };
      won: boolean;
    }[];

    const match: MatchInfo = {
      matchId: row.match_id,
      map: row.map_name,
      roundsPlayed: row.rounds_played,
      myTeam: row.team_id,
      agent: row.agent_name,
      agentId: row.agent_id,
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
      headshots: row.headshots,
      bodyshots: row.bodyshots,
      legshots: row.legshots,
      damageDealt: row.damage_dealt,
      won: teams.find((t) => t.team_id === row.team_id)?.won ?? null,
      teamOf,
      teamIds: [...new Set(teamOf.values())],
      attackTeamByRound: new Map(),
    };
    match.attackTeamByRound = buildAttackTeams(match, roundsByMatch.get(row.match_id) ?? []);
    return match;
  });
  const byMatch = new Map(matches.map((m) => [m.matchId, m]));

  // Average loadout of the player's own team, per round, for buy classification.
  const teamLoadouts = new Map<string, number[]>();
  const myRoundStatsByKey = new Map<string, RpsRow>();
  for (const rps of rpsRows) {
    const match = byMatch.get(rps.match_id);
    if (!match) continue;
    if (rps.puuid === puuid) myRoundStatsByKey.set(roundKey(rps.match_id, rps.round_num), rps);
    if (rps.team_id !== match.myTeam || rps.loadout_value === null) continue;
    const key = roundKey(rps.match_id, rps.round_num);
    let list = teamLoadouts.get(key);
    if (!list) teamLoadouts.set(key, (list = []));
    list.push(rps.loadout_value);
  }

  const roundTypeByKey = new Map<string, RoundType>();
  const roundByKey = new Map<string, RoundRow>();
  for (const r of rounds) {
    const key = roundKey(r.match_id, r.round_num);
    roundByKey.set(key, r);
    const loadouts = teamLoadouts.get(key);
    const avg = loadouts?.length
      ? loadouts.reduce((total, v) => total + v, 0) / loadouts.length
      : null;
    roundTypeByKey.set(key, classifyRoundType(r.round_num, avg));
  }

  return { puuid, matches, byMatch, rounds, roundByKey, kills, roundTypeByKey, myRoundStatsByKey };
}

// --- helpers ---

const pct = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

const ratio = (kills: number, deaths: number): number =>
  Math.round((deaths > 0 ? kills / deaths : kills) * 100) / 100;

function isEnemyKill(ds: PlayerDataset, k: KillRow): boolean {
  const teamOf = ds.byMatch.get(k.match_id)?.teamOf;
  return teamOf?.get(k.killer_puuid) !== teamOf?.get(k.victim_puuid);
}

// The player's cross-team kills, grouped per round.
function myKillsByRound(ds: PlayerDataset): Map<string, KillRow[]> {
  const grouped = new Map<string, KillRow[]>();
  for (const k of ds.kills) {
    if (k.killer_puuid !== ds.puuid || !isEnemyKill(ds, k)) continue;
    const key = roundKey(k.match_id, k.round_num);
    let list = grouped.get(key);
    if (!list) grouped.set(key, (list = []));
    list.push(k);
  }
  return grouped;
}

// --- stat sections ---

export interface MapStat {
  map: string;
  matches: number;
  wins: number;
  losses: number;
  winRate: number;
  kills: number;
  deaths: number;
  kd: number;
}

export function computeMapStats(ds: PlayerDataset): MapStat[] {
  return computeGroupedMatchStats(ds, (m) => m.map).map(({ group, ...rest }) => ({
    map: group,
    ...rest,
  }));
}

export interface AgentStat {
  agent: string;
  agentId: string;
  matches: number;
  wins: number;
  losses: number;
  winRate: number;
  kills: number;
  deaths: number;
  kd: number;
}

export function computeAgentStats(ds: PlayerDataset): AgentStat[] {
  const idByAgent = new Map<string, string>();
  for (const m of ds.matches) {
    if (!idByAgent.has(m.agent)) idByAgent.set(m.agent, m.agentId);
  }
  return computeGroupedMatchStats(ds, (m) => m.agent).map(({ group, ...rest }) => ({
    agent: group,
    agentId: idByAgent.get(group) ?? "",
    ...rest,
  }));
}

function computeGroupedMatchStats(ds: PlayerDataset, groupBy: (m: MatchInfo) => string) {
  const groups = new Map<
    string,
    { matches: number; wins: number; losses: number; kills: number; deaths: number }
  >();
  for (const m of ds.matches) {
    const key = groupBy(m);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { matches: 0, wins: 0, losses: 0, kills: 0, deaths: 0 }));
    g.matches++;
    if (m.won === true) g.wins++;
    if (m.won === false) g.losses++;
    g.kills += m.kills;
    g.deaths += m.deaths;
  }
  return [...groups.entries()]
    .map(([group, g]) => ({
      group,
      matches: g.matches,
      wins: g.wins,
      losses: g.losses,
      winRate: pct(g.wins, g.wins + g.losses),
      kills: g.kills,
      deaths: g.deaths,
      kd: ratio(g.kills, g.deaths),
    }))
    .sort((a, b) => b.matches - a.matches);
}

export interface SideRecord {
  rounds: number;
  won: number;
  winRate: number;
}

export interface SideStatByMap {
  map: string;
  attack: SideRecord;
  defense: SideRecord;
}

export function computeSideStatsByMap(ds: PlayerDataset): SideStatByMap[] {
  const byMap = new Map<string, { attack: [number, number]; defense: [number, number] }>();
  for (const r of ds.rounds) {
    const match = ds.byMatch.get(r.match_id);
    if (!match) continue;
    const attackTeam = match.attackTeamByRound.get(r.round_num);
    if (!attackTeam) continue; // side unknown for this round
    const side = attackTeam === match.myTeam ? "attack" : "defense";
    let g = byMap.get(match.map);
    if (!g) byMap.set(match.map, (g = { attack: [0, 0], defense: [0, 0] }));
    g[side][0]++;
    if (r.winning_team === match.myTeam) g[side][1]++;
  }
  const record = ([rounds, won]: [number, number]): SideRecord => ({
    rounds,
    won,
    winRate: pct(won, rounds),
  });
  return [...byMap.entries()]
    .map(([map, g]) => ({ map, attack: record(g.attack), defense: record(g.defense) }))
    .sort((a, b) => b.attack.rounds + b.defense.rounds - (a.attack.rounds + a.defense.rounds));
}

export interface WeaponStat {
  weaponId: string;
  weapon: string;
  type: string;
  kills: number;
  // Estimated: kill events carry no headshot flag, so a round's shot stats are
  // attributed to a weapon only when all of the player's kills that round used
  // that one weapon. Null when no round qualified.
  hsPercent: number | null;
  hsSampleRounds: number;
}

export function computeWeaponStats(ds: PlayerDataset): WeaponStat[] {
  const weapons = new Map<
    string,
    { weapon: string; type: string; kills: number; head: number; shots: number; rounds: number }
  >();
  const killRounds = myKillsByRound(ds);

  for (const kills of killRounds.values()) {
    for (const k of kills) {
      const id = k.weapon_id ?? "unknown";
      let w = weapons.get(id);
      if (!w) {
        weapons.set(
          id,
          (w = {
            weapon: k.weapon_name ?? "Unknown",
            type: k.weapon_type ?? "Unknown",
            kills: 0,
            head: 0,
            shots: 0,
            rounds: 0,
          }),
        );
      }
      w.kills++;
      if (k.weapon_name && w.weapon === "Unknown") w.weapon = k.weapon_name;
    }
  }

  for (const [key, kills] of killRounds) {
    const ids = new Set(kills.map((k) => k.weapon_id ?? "unknown"));
    if (ids.size !== 1) continue;
    const stats = ds.myRoundStatsByKey.get(key);
    if (!stats) continue;
    const shots = stats.headshots + stats.bodyshots + stats.legshots;
    if (shots === 0) continue;
    const w = weapons.get([...ids][0]);
    if (!w) continue;
    w.head += stats.headshots;
    w.shots += shots;
    w.rounds++;
  }

  return [...weapons.entries()]
    .map(([weaponId, w]) => ({
      weaponId,
      weapon: w.weapon,
      type: w.type,
      kills: w.kills,
      hsPercent: w.shots > 0 ? pct(w.head, w.shots) : null,
      hsSampleRounds: w.rounds,
    }))
    .sort((a, b) => b.kills - a.kills);
}

export interface PhaseCounts {
  opening: number;
  mid: number;
  late: number;
  postPlant: number;
  total: number;
}

export interface DeathTimeStats {
  totalDeaths: number;
  byPhase: Record<RoundPhase, number>;
  byRoundType: Record<RoundType, PhaseCounts>;
}

export function computeDeathTimeStats(ds: PlayerDataset): DeathTimeStats {
  const emptyPhases = (): PhaseCounts => ({ opening: 0, mid: 0, late: 0, postPlant: 0, total: 0 });
  const byRoundType = Object.fromEntries(
    ROUND_TYPES.map((t) => [t, emptyPhases()]),
  ) as Record<RoundType, PhaseCounts>;
  const byPhase = Object.fromEntries(ROUND_PHASES.map((p) => [p, 0])) as Record<
    RoundPhase,
    number
  >;

  let totalDeaths = 0;
  for (const k of ds.kills) {
    if (k.victim_puuid !== ds.puuid) continue;
    const key = roundKey(k.match_id, k.round_num);
    const round = ds.roundByKey.get(key);
    if (!round) continue;

    const plantTime = round.plant_time_in_round_ms;
    const phase: RoundPhase =
      plantTime !== null && k.time_in_round_ms >= plantTime
        ? "postPlant"
        : k.time_in_round_ms < OPENING_PHASE_MAX_MS
          ? "opening"
          : k.time_in_round_ms < MID_PHASE_MAX_MS
            ? "mid"
            : "late";
    const roundType = ds.roundTypeByKey.get(key) ?? "unknown";

    totalDeaths++;
    byPhase[phase]++;
    byRoundType[roundType][phase]++;
    byRoundType[roundType].total++;
  }

  return { totalDeaths, byPhase, byRoundType };
}

export interface FirstBloodStats {
  rounds: number;
  firstBloods: number;
  firstDeaths: number;
  firstBloodRate: number;
  firstDeathRate: number;
}

export function computeFirstBloodStats(ds: PlayerDataset): FirstBloodStats {
  const firstKillByRound = new Map<string, KillRow>();
  for (const k of ds.kills) {
    if (!isEnemyKill(ds, k)) continue;
    const key = roundKey(k.match_id, k.round_num);
    const current = firstKillByRound.get(key);
    if (!current || k.time_in_round_ms < current.time_in_round_ms) {
      firstKillByRound.set(key, k);
    }
  }

  let firstBloods = 0;
  let firstDeaths = 0;
  for (const k of firstKillByRound.values()) {
    if (k.killer_puuid === ds.puuid) firstBloods++;
    if (k.victim_puuid === ds.puuid) firstDeaths++;
  }
  const rounds = ds.rounds.length;
  return {
    rounds,
    firstBloods,
    firstDeaths,
    firstBloodRate: pct(firstBloods, rounds),
    firstDeathRate: pct(firstDeaths, rounds),
  };
}

export interface ClutchRecord {
  attempts: number;
  wins: number;
}

export interface ClutchStats {
  attempts: number;
  wins: number;
  // Keyed by enemies alive when the player became the last one standing.
  bySituation: Record<"1v1" | "1v2" | "1v3" | "1v4" | "1v5", ClutchRecord>;
}

// Alive-tracking is reconstructed from kill events, so resurrections (Sage)
// and non-combat deaths (fall damage, spike) aren't visible; counts are a
// close approximation.
export function computeClutchStats(ds: PlayerDataset): ClutchStats {
  const bySituation = Object.fromEntries(
    (["1v1", "1v2", "1v3", "1v4", "1v5"] as const).map((k) => [k, { attempts: 0, wins: 0 }]),
  ) as ClutchStats["bySituation"];
  let attempts = 0;
  let wins = 0;

  const killsByRound = new Map<string, KillRow[]>();
  for (const k of ds.kills) {
    const key = roundKey(k.match_id, k.round_num);
    let list = killsByRound.get(key);
    if (!list) killsByRound.set(key, (list = []));
    list.push(k); // already time-ordered by the query
  }

  for (const [key, kills] of killsByRound) {
    const round = ds.roundByKey.get(key);
    const match = ds.byMatch.get(kills[0].match_id);
    if (!round || !match) continue;

    const aliveMine = new Set<string>();
    const aliveEnemy = new Set<string>();
    for (const [puuid, team] of match.teamOf) {
      (team === match.myTeam ? aliveMine : aliveEnemy).add(puuid);
    }
    if (!aliveMine.has(ds.puuid)) continue;

    for (const k of kills) {
      aliveMine.delete(k.victim_puuid);
      aliveEnemy.delete(k.victim_puuid);
      if (k.victim_puuid === ds.puuid) break; // dead players don't clutch
      if (aliveMine.size === 1 && aliveMine.has(ds.puuid) && aliveEnemy.size >= 1) {
        const enemies = Math.min(aliveEnemy.size, 5) as 1 | 2 | 3 | 4 | 5;
        const record = bySituation[`1v${enemies}`];
        record.attempts++;
        attempts++;
        if (round.winning_team === match.myTeam) {
          record.wins++;
          wins++;
        }
        break; // record the situation once, at its start
      }
    }
  }

  return { attempts, wins, bySituation };
}

export interface MultiKillStats {
  doubleKills: number;
  tripleKills: number;
  quadKills: number;
  aces: number;
}

export function computeMultiKillStats(ds: PlayerDataset): MultiKillStats {
  const stats: MultiKillStats = { doubleKills: 0, tripleKills: 0, quadKills: 0, aces: 0 };
  for (const kills of myKillsByRound(ds).values()) {
    if (kills.length === 2) stats.doubleKills++;
    else if (kills.length === 3) stats.tripleKills++;
    else if (kills.length === 4) stats.quadKills++;
    else if (kills.length >= 5) stats.aces++;
  }
  return stats;
}

export interface OverallStats {
  matches: number;
  wins: number;
  losses: number;
  winRate: number;
  kills: number;
  deaths: number;
  assists: number;
  kd: number;
  hsPercent: number;
  adr: number;
}

export function computeOverallStats(ds: PlayerDataset): OverallStats {
  let wins = 0;
  let losses = 0;
  let kills = 0;
  let deaths = 0;
  let assists = 0;
  let head = 0;
  let shots = 0;
  let damage = 0;
  let rounds = 0;
  for (const m of ds.matches) {
    if (m.won === true) wins++;
    if (m.won === false) losses++;
    kills += m.kills;
    deaths += m.deaths;
    assists += m.assists;
    head += m.headshots;
    shots += m.headshots + m.bodyshots + m.legshots;
    damage += m.damageDealt;
    rounds += m.roundsPlayed;
  }
  return {
    matches: ds.matches.length,
    wins,
    losses,
    winRate: pct(wins, wins + losses),
    kills,
    deaths,
    assists,
    kd: ratio(kills, deaths),
    hsPercent: pct(head, shots),
    adr: rounds > 0 ? Math.round((damage / rounds) * 10) / 10 : 0,
  };
}

export interface RoundTypeStat {
  roundType: RoundType;
  rounds: number;
  won: number;
  winRate: number;
}

export function computeRoundTypeStats(ds: PlayerDataset): RoundTypeStat[] {
  const groups = new Map<RoundType, { rounds: number; won: number }>(
    ROUND_TYPES.map((t) => [t, { rounds: 0, won: 0 }]),
  );
  for (const r of ds.rounds) {
    const match = ds.byMatch.get(r.match_id);
    if (!match) continue;
    const type = ds.roundTypeByKey.get(roundKey(r.match_id, r.round_num)) ?? "unknown";
    const g = groups.get(type)!;
    g.rounds++;
    if (r.winning_team === match.myTeam) g.won++;
  }
  return ROUND_TYPES.map((roundType) => {
    const g = groups.get(roundType)!;
    return { roundType, rounds: g.rounds, won: g.won, winRate: pct(g.won, g.rounds) };
  });
}

// --- combined payload ---

export interface PlayerInsights {
  matchesAnalyzed: number;
  roundsAnalyzed: number;
  overall: OverallStats;
  maps: MapStat[];
  agents: AgentStat[];
  sidesByMap: SideStatByMap[];
  roundTypes: RoundTypeStat[];
  weapons: WeaponStat[];
  deathTimes: DeathTimeStats;
  firstBlood: FirstBloodStats;
  clutches: ClutchStats;
  multiKills: MultiKillStats;
}

export function getPlayerInsights(puuid: string): PlayerInsights {
  const ds = loadPlayerDataset(puuid);
  return {
    matchesAnalyzed: ds.matches.length,
    roundsAnalyzed: ds.rounds.length,
    overall: computeOverallStats(ds),
    maps: computeMapStats(ds),
    agents: computeAgentStats(ds),
    sidesByMap: computeSideStatsByMap(ds),
    roundTypes: computeRoundTypeStats(ds),
    weapons: computeWeaponStats(ds),
    deathTimes: computeDeathTimeStats(ds),
    firstBlood: computeFirstBloodStats(ds),
    clutches: computeClutchStats(ds),
    multiKills: computeMultiKillStats(ds),
  };
}
