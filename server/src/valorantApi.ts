import {
  countPlayerMatches,
  getCached,
  setCached,
  getMatchPlayers,
  getPlayerFilterOptions,
  getPlayerMatchRows,
  hasMatch,
  storeFullMatch,
  type PlayerFilterOptions,
  type PlayerMatchFilter,
  type PlayerMatchWithStatsRow,
  type StoredMatchPlayerRow,
} from "./db";

const BASE_URL = "https://api.henrikdev.xyz/valorant";
// How many recent matches to keep stored per player. Henrik's stored-matches
// paging goes much deeper for frequently-tracked players; 50 keeps sync time
// and rate-limit budget sane.
const SYNC_DEPTH = 50;
// Max new matches fetched while the HTTP request waits; anything beyond this
// backfills in the background so a lookup never blocks for minutes.
const SYNC_FOREGROUND_NEW = 10;
const SYNC_DELAY_MS = 2000;
// Background backfills aren't latency-sensitive, so they run at half pace and
// leave rate-limit headroom for interactive requests.
const BACKGROUND_SYNC_DELAY_MS = 4000;
const BACKGROUND_429_MAX_RETRIES = 5;
const BACKGROUND_429_DEFAULT_WAIT_S = 60;
const STORED_MATCHES_PAGE_SIZE = 20;
const MATCH_LIST_DEFAULT = 20;

interface HenrikErrorBody {
  errors?: { code: number; message: string; status: number; details: unknown }[];
}

export class ValorantApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterSeconds: number | null = null,
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
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new ValorantApiError(
        429,
        "Rate limited by the Henrik API. Try again shortly.",
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
      );
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
  missing: number;
  fetched: number;
  queuedForBackground: number;
  failed: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Walks stored-matches pages (newest first) up to `depth` entries and returns
// ids not yet in the store. A page with nothing missing ends the walk early,
// but only once the player's store has reached the depth target — otherwise a
// previously interrupted backfill (newest page stored, deeper pages not)
// would never resume.
async function discoverMissingMatchIds(
  puuid: string,
  region: string,
  depth: number,
): Promise<string[]> {
  const backfillComplete = countPlayerMatches(puuid) >= depth;
  const missing: string[] = [];
  let seen = 0;
  for (let page = 1; seen < depth; page++) {
    if (page > 1) await sleep(SYNC_DELAY_MS);
    const entries = await henrikGet<StoredMatchListEntry[]>(
      `/v1/by-puuid/stored-matches/${region}/${encodeURIComponent(puuid)}`,
      { size: String(STORED_MATCHES_PAGE_SIZE), page: String(page) },
    );
    let pageMissing = 0;
    for (const entry of entries) {
      if (seen >= depth) break;
      seen++;
      if (!hasMatch(entry.meta.id)) {
        missing.push(entry.meta.id);
        pageMissing++;
      }
    }
    if (entries.length < STORED_MATCHES_PAGE_SIZE) break; // history exhausted
    if (pageMissing === 0 && backfillComplete) break;
  }
  return missing;
}

// Rethrows 429 (the caller decides whether to back off or abort); other
// failures are logged and skipped — the match stays absent, so the next sync
// retries it.
async function fetchAndStore(matchId: string, region: string, delayMs: number): Promise<boolean> {
  // Space every match-details call out from the previous API request.
  await sleep(delayMs);
  try {
    storeFullMatch(await getFullMatchDetails(matchId, region));
    return true;
  } catch (err) {
    if (err instanceof ValorantApiError && err.status === 429) throw err;
    console.error(`Failed to sync match ${matchId}:`, err);
    return false;
  }
}

// Deep backfills run one player at a time on a shared chain so concurrent
// lookups can't stack API traffic past the per-request spacing.
let backgroundChain = Promise.resolve();
const backgroundQueued = new Set<string>();

function queueBackgroundSync(puuid: string, region: string, matchIds: string[]): void {
  if (backgroundQueued.has(puuid)) return;
  backgroundQueued.add(puuid);
  backgroundChain = backgroundChain.then(async () => {
    let fetched = 0;
    let rateLimitRetries = 0;
    try {
      for (const id of matchIds) {
        if (hasMatch(id)) continue;
        for (;;) {
          try {
            if (await fetchAndStore(id, region, BACKGROUND_SYNC_DELAY_MS)) fetched++;
            break;
          } catch (err) {
            // A backfill has no user waiting on it: wait out the limiter and
            // resume rather than abort.
            if (
              err instanceof ValorantApiError &&
              err.status === 429 &&
              rateLimitRetries < BACKGROUND_429_MAX_RETRIES
            ) {
              rateLimitRetries++;
              const waitSeconds = err.retryAfterSeconds ?? BACKGROUND_429_DEFAULT_WAIT_S;
              console.log(
                `Background sync for ${puuid}: rate limited, waiting ${waitSeconds}s ` +
                  `(retry ${rateLimitRetries}/${BACKGROUND_429_MAX_RETRIES})`,
              );
              await sleep(waitSeconds * 1000);
              continue;
            }
            throw err;
          }
        }
      }
    } catch (err) {
      console.error(`Background sync for ${puuid} aborted:`, err);
    } finally {
      backgroundQueued.delete(puuid);
      console.log(`Background sync for ${puuid}: stored ${fetched} of ${matchIds.length} queued`);
    }
  });
}

export async function syncPlayerHistory(puuid: string, region: string): Promise<SyncResult> {
  const missing = await discoverMissingMatchIds(puuid, region, SYNC_DEPTH);
  const foreground = missing.slice(0, SYNC_FOREGROUND_NEW);
  const background = missing.slice(SYNC_FOREGROUND_NEW);

  const result: SyncResult = {
    missing: missing.length,
    fetched: 0,
    queuedForBackground: background.length,
    failed: 0,
  };

  for (const id of foreground) {
    if (await fetchAndStore(id, region, SYNC_DELAY_MS)) result.fetched++;
    else result.failed++;
  }

  if (background.length > 0) queueBackgroundSync(puuid, region, background);
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

// v4 no longer ships asset URLs the way v3 did; build the CDN URL ourselves.
function agentIconUrl(agentId: string): string {
  return `https://media.valorant-api.com/agents/${agentId}/displayicon.png`;
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

function rowToMatchSummary(m: PlayerMatchWithStatsRow): MatchSummary {
  const teams = JSON.parse(m.teams_json) as FullMatchDetails["teams"];
  const myTeam = teams.find((t) => t.team_id === m.team_id);

  return {
    matchId: m.match_id,
    map: m.map_name,
    mode: m.queue_name,
    queue: m.queue_id,
    playedAt: m.started_at,
    roundsPlayed: m.rounds_played,
    won: myTeam?.won ?? null,
    agent: m.agent_name,
    agentIconUrl: agentIconUrl(m.agent_id),
    kills: m.kills,
    deaths: m.deaths,
    assists: m.assists,
    score: myTeam ? { won: myTeam.rounds.won, lost: myTeam.rounds.lost } : null,
    players: getMatchPlayers(m.match_id)
      .map((p) => toScoreboardPlayer(p, m.rounds_played))
      .sort((a, b) => b.acs - a.acs),
  };
}

export interface HistorySummary {
  matches: number;
  wins: number;
  losses: number;
  winRate: number;
  kd: number;
  avgAcs: number;
  hsPercent: number;
}

export interface FilteredMatchHistory {
  summary: HistorySummary;
  filters: PlayerFilterOptions;
  matches: MatchSummary[];
}

// Summary aggregates cover every stored match passing the filter; only the
// match list is capped at `size`.
export function getFilteredMatchHistory(
  puuid: string,
  filter: PlayerMatchFilter = {},
  size = MATCH_LIST_DEFAULT,
): FilteredMatchHistory {
  const rows = getPlayerMatchRows(puuid, filter);

  let wins = 0;
  let losses = 0;
  let kills = 0;
  let deaths = 0;
  let score = 0;
  let rounds = 0;
  let head = 0;
  let shots = 0;
  for (const m of rows) {
    const teams = JSON.parse(m.teams_json) as FullMatchDetails["teams"];
    const won = teams.find((t) => t.team_id === m.team_id)?.won;
    if (won === true) wins++;
    if (won === false) losses++;
    kills += m.kills;
    deaths += m.deaths;
    // ACS only makes sense for round-based modes; deathmatch score over its
    // single "round" would dwarf every real value.
    if (m.mode_type === "Standard") {
      score += m.score;
      rounds += m.rounds_played;
    }
    head += m.headshots;
    shots += m.headshots + m.bodyshots + m.legshots;
  }

  return {
    summary: {
      matches: rows.length,
      wins,
      losses,
      winRate: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0,
      kd: Math.round((deaths > 0 ? kills / deaths : kills) * 100) / 100,
      avgAcs: rounds > 0 ? Math.round(score / rounds) : 0,
      hsPercent: shots > 0 ? Math.round((head / shots) * 1000) / 10 : 0,
    },
    filters: getPlayerFilterOptions(puuid),
    matches: rows.slice(0, size).map(rowToMatchSummary),
  };
}
