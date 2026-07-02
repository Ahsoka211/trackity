import {
  getCached,
  setCached,
  getMatchPlayers,
  getPlayerMatches,
  hasMatch,
  storeFullMatch,
  type StoredMatchPlayerRow,
} from "./db";

const BASE_URL = "https://api.henrikdev.xyz/valorant";
const MAX_MATCHES = 10;
const SYNC_DELAY_MS = 2000;

interface HenrikErrorBody {
  errors?: { code: number; message: string; status: number; details: unknown }[];
}

export class ValorantApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ValorantApiError";
  }
}

async function henrikGet<T>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: { Authorization: process.env.HENRIK_API_KEY ?? "" },
  });
  const body = await response.json();

  if (!response.ok) {
    if (response.status === 429) {
      throw new ValorantApiError(429, "Rate limited by the Henrik API. Try again shortly.");
    }
    if (response.status === 404) {
      throw new ValorantApiError(404, "Player or match data not found.");
    }
    const message =
      (body as HenrikErrorBody).errors?.[0]?.message ?? "Henrik API request failed.";
    throw new ValorantApiError(response.status, message);
  }

  return (body as { data: T }).data;
}

export interface Account {
  puuid: string;
  name: string;
  tag: string;
  region: string;
  accountLevel: number;
  card: string;
}

export async function getAccount(
  name: string,
  tag: string,
  forceRefresh = false,
): Promise<Account> {
  const riotId = `${name}#${tag}`;
  if (!forceRefresh) {
    const cached = getCached<Account>("account", riotId, "");
    if (cached) return cached;
  }

  const data = await henrikGet<{
    puuid: string;
    name: string;
    tag: string;
    region: string;
    account_level: number;
    card: string;
  }>(`/v2/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);

  const account: Account = {
    puuid: data.puuid,
    name: data.name,
    tag: data.tag,
    region: data.region,
    accountLevel: data.account_level,
    card: data.card,
  };

  setCached("account", riotId, "", account);
  return account;
}

export interface MMR {
  tier: number;
  tierName: string;
  rr: number;
  elo: number;
  lastGameChange: number;
  iconUrl: string | null;
  peak: {
    tier: number;
    tierName: string;
    season: string;
  } | null;
}

export async function getMMR(
  name: string,
  tag: string,
  region: string,
  forceRefresh = false,
): Promise<MMR> {
  const riotId = `${name}#${tag}`;
  if (!forceRefresh) {
    const cached = getCached<MMR>("mmr", riotId, region);
    if (cached) return cached;
  }

  const data = await henrikGet<{
    current_data: {
      currenttier: number;
      currenttierpatched: string;
      ranking_in_tier: number;
      elo: number;
      mmr_change_to_last_game: number;
      images: { small: string; large: string } | null;
    } | null;
    highest_rank: { tier: number; patched_tier: string; season: string } | null;
  }>(`/v2/mmr/${region}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);

  const current = data.current_data;
  const mmr: MMR = !current
    ? {
        tier: 0,
        tierName: "Unranked",
        rr: 0,
        elo: 0,
        lastGameChange: 0,
        iconUrl: null,
        peak: data.highest_rank
          ? {
              tier: data.highest_rank.tier,
              tierName: data.highest_rank.patched_tier,
              season: data.highest_rank.season,
            }
          : null,
      }
    : {
        tier: current.currenttier,
        tierName: current.currenttierpatched,
        rr: current.ranking_in_tier,
        elo: current.elo,
        lastGameChange: current.mmr_change_to_last_game,
        iconUrl: current.images?.large ?? null,
        peak: data.highest_rank
          ? {
              tier: data.highest_rank.tier,
              tierName: data.highest_rank.patched_tier,
              season: data.highest_rank.season,
            }
          : null,
      };

  setCached("mmr", riotId, region, mmr);
  return mmr;
}

interface V4PlayerRef {
  puuid: string;
  name: string;
  tag: string;
  team: string;
}

export interface V4MatchPlayer {
  puuid: string;
  name: string;
  tag: string;
  team_id: string;
  agent: { id: string; name: string };
  stats: {
    score: number;
    kills: number;
    deaths: number;
    assists: number;
    headshots: number;
    bodyshots: number;
    legshots: number;
    damage: { dealt: number; received: number };
  };
  tier: { id: number; name: string } | null;
  account_level: number | null;
}

export interface V4DamageEvent {
  player: V4PlayerRef | null;
  bodyshots: number;
  headshots: number;
  legshots: number;
  damage: number;
}

export interface V4RoundPlayerStats {
  player: V4PlayerRef;
  damage_events: V4DamageEvent[];
  stats: {
    score: number;
    kills: number;
    headshots: number;
    bodyshots: number;
    legshots: number;
  };
  economy: {
    loadout_value: number | null;
    remaining: number | null;
    weapon: { id: string; name: string | null; type: string } | null;
    armor: { id: string; name: string } | null;
  } | null;
  was_afk: boolean;
  received_penalty: boolean;
  stayed_in_spawn: boolean;
}

export interface V4Round {
  id: number;
  result: string;
  ceremony: string | null;
  winning_team: string | null;
  plant: {
    round_time_in_ms: number;
    site: string;
    location: { x: number; y: number } | null;
    player: V4PlayerRef;
  } | null;
  defuse: {
    round_time_in_ms: number;
    location: { x: number; y: number } | null;
    player: V4PlayerRef;
  } | null;
  stats: V4RoundPlayerStats[] | null;
}

export interface V4Kill {
  time_in_round_in_ms: number;
  time_in_match_in_ms: number;
  round: number;
  killer: V4PlayerRef;
  victim: V4PlayerRef;
  assistants: V4PlayerRef[];
  location: { x: number; y: number } | null;
  // weapon.name is null for some weapon ids in real responses; key off id.
  weapon: { id: string; name: string | null; type: string };
  secondary_fire_mode: boolean;
}

// Shape confirmed against a live v4 response. Kill events carry no headshot
// flag — headshot counts only exist in per-round damage_events, which we
// don't persist yet.
export interface FullMatchDetails {
  metadata: {
    match_id: string;
    map: { id: string; name: string };
    game_length_in_ms: number;
    started_at: string;
    is_completed: boolean;
    queue: { id: string; name: string | null; mode_type: string | null };
    season: { id: string; short: string } | null;
    region: string;
  };
  players: V4MatchPlayer[];
  teams: { team_id: string; rounds: { won: number; lost: number }; won: boolean }[];
  rounds: V4Round[];
  kills: V4Kill[];
}

export async function getFullMatchDetails(
  matchId: string,
  region: string,
): Promise<FullMatchDetails> {
  return henrikGet<FullMatchDetails>(`/v4/match/${region}/${encodeURIComponent(matchId)}`);
}

interface StoredMatchListEntry {
  meta: { id: string };
}

export interface SyncResult {
  discovered: number;
  fetched: number;
  alreadyStored: number;
  failed: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function syncPlayerHistory(puuid: string, region: string): Promise<SyncResult> {
  const entries = await henrikGet<StoredMatchListEntry[]>(
    `/v1/by-puuid/stored-matches/${region}/${encodeURIComponent(puuid)}`,
    { size: String(MAX_MATCHES) },
  );

  const result: SyncResult = {
    discovered: entries.length,
    fetched: 0,
    alreadyStored: 0,
    failed: 0,
  };

  for (const entry of entries) {
    if (hasMatch(entry.meta.id)) {
      result.alreadyStored++;
      continue;
    }
    // Space every match-details call out from the previous API request.
    await sleep(SYNC_DELAY_MS);
    try {
      storeFullMatch(await getFullMatchDetails(entry.meta.id, region));
      result.fetched++;
    } catch (err) {
      if (err instanceof ValorantApiError && err.status === 429) throw err;
      // One broken match shouldn't sink the sync; it stays absent from the
      // store, so the next sync retries it.
      console.error(`Failed to sync match ${entry.meta.id}:`, err);
      result.failed++;
    }
  }

  return result;
}

export interface ScoreboardPlayer {
  puuid: string;
  name: string;
  tag: string;
  team: string;
  agent: string;
  agentIconUrl: string | null;
  kills: number;
  deaths: number;
  assists: number;
  acs: number;
  headshotPercent: number;
}

export interface MatchSummary {
  matchId: string;
  map: string;
  mode: string;
  queue: string;
  playedAt: string;
  roundsPlayed: number;
  won: boolean | null;
  agent: string | null;
  agentIconUrl: string | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  score: { won: number; lost: number } | null;
  players: ScoreboardPlayer[];
}

// v4 no longer ships asset URLs the way v3 did; build the same CDN URL v3 used.
function agentIconUrl(agentId: string): string {
  return `https://media.valorant-api.com/agents/${agentId}/displayiconsmall.png`;
}

function toScoreboardPlayer(p: StoredMatchPlayerRow, roundsPlayed: number): ScoreboardPlayer {
  const totalShots = p.headshots + p.bodyshots + p.legshots;
  return {
    puuid: p.puuid,
    name: p.name,
    tag: p.tag,
    team: p.team_id,
    agent: p.agent_name,
    agentIconUrl: agentIconUrl(p.agent_id),
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    acs: roundsPlayed > 0 ? Math.round(p.score / roundsPlayed) : 0,
    headshotPercent: totalShots > 0 ? Math.round((p.headshots / totalShots) * 100) : 0,
  };
}

export function getStoredMatchHistory(puuid: string, size = MAX_MATCHES): MatchSummary[] {
  return getPlayerMatches(puuid, size).map((m) => {
    const players = getMatchPlayers(m.match_id);
    const me = players.find((p) => p.puuid === puuid);
    const teams = JSON.parse(m.teams_json) as FullMatchDetails["teams"];
    const myTeam = me ? teams.find((t) => t.team_id === me.team_id) : undefined;

    return {
      matchId: m.match_id,
      map: m.map_name,
      mode: m.queue_name,
      queue: m.queue_id,
      playedAt: m.started_at,
      roundsPlayed: m.rounds_played,
      won: myTeam?.won ?? null,
      agent: me?.agent_name ?? null,
      agentIconUrl: me ? agentIconUrl(me.agent_id) : null,
      kills: me?.kills ?? null,
      deaths: me?.deaths ?? null,
      assists: me?.assists ?? null,
      score: myTeam ? { won: myTeam.rounds.won, lost: myTeam.rounds.lost } : null,
      players: players
        .map((p) => toScoreboardPlayer(p, m.rounds_played))
        .sort((a, b) => b.acs - a.acs),
    };
  });
}
