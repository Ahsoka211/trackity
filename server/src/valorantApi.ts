const BASE_URL = "https://api.henrikdev.xyz/valorant";

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

export async function getAccount(name: string, tag: string): Promise<Account> {
  const data = await henrikGet<{
    puuid: string;
    name: string;
    tag: string;
    region: string;
    account_level: number;
    card: string;
  }>(`/v2/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);

  return {
    puuid: data.puuid,
    name: data.name,
    tag: data.tag,
    region: data.region,
    accountLevel: data.account_level,
    card: data.card,
  };
}

export interface MMR {
  tier: number;
  tierName: string;
  rr: number;
  elo: number;
  lastGameChange: number;
}

export async function getMMR(
  name: string,
  tag: string,
  region: string,
): Promise<MMR> {
  const data = await henrikGet<{
    current_data: {
      currenttier: number;
      currenttierpatched: string;
      ranking_in_tier: number;
      elo: number;
      mmr_change_to_last_game: number;
    };
  }>(`/v2/mmr/${region}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);

  const current = data.current_data;
  return {
    tier: current.currenttier,
    tierName: current.currenttierpatched,
    rr: current.ranking_in_tier,
    elo: current.elo,
    lastGameChange: current.mmr_change_to_last_game,
  };
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
  kills: number | null;
  deaths: number | null;
  assists: number | null;
}

interface HenrikMatch {
  metadata: {
    matchid: string;
    map: string;
    mode: string;
    queue: string;
    game_start_patched: string;
    rounds_played: number;
  };
  players: {
    all_players: {
      name: string;
      tag: string;
      team: string;
      character: string;
      stats: { kills: number; deaths: number; assists: number };
    }[];
  };
  teams: Record<string, { has_won: boolean }>;
}

export async function getMatchHistory(
  name: string,
  tag: string,
  region: string,
  size = 10,
): Promise<MatchSummary[]> {
  const matches = await henrikGet<HenrikMatch[]>(
    `/v3/matches/${region}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
    { size: String(size) },
  );

  return matches.map((match) => {
    const player = match.players.all_players.find(
      (p) => p.name.toLowerCase() === name.toLowerCase() && p.tag.toLowerCase() === tag.toLowerCase(),
    );
    const team = player ? match.teams[player.team.toLowerCase()] : undefined;

    return {
      matchId: match.metadata.matchid,
      map: match.metadata.map,
      mode: match.metadata.mode,
      queue: match.metadata.queue,
      playedAt: match.metadata.game_start_patched,
      roundsPlayed: match.metadata.rounds_played,
      won: team?.has_won ?? null,
      agent: player?.character ?? null,
      kills: player?.stats.kills ?? null,
      deaths: player?.stats.deaths ?? null,
      assists: player?.stats.assists ?? null,
    };
  });
}
