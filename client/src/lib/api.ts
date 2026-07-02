export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const body = await response.json();

  if (!response.ok) {
    throw new ApiError(response.status, body.error ?? 'Something went wrong.');
  }

  return body as T;
}

export interface Account {
  puuid: string;
  name: string;
  tag: string;
  region: string;
  accountLevel: number;
  card: string;
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

export function getAccount(name: string, tag: string): Promise<Account> {
  return apiGet<Account>(
    `/api/player/${encodeURIComponent(name)}/${encodeURIComponent(tag)}/account`,
  );
}

export function getMMR(name: string, tag: string, region: string): Promise<MMR> {
  return apiGet<MMR>(
    `/api/player/${encodeURIComponent(name)}/${encodeURIComponent(tag)}/mmr?region=${encodeURIComponent(region)}`,
  );
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

export function getMatchHistory(
  name: string,
  tag: string,
  region: string,
  size = 10,
): Promise<MatchSummary[]> {
  return apiGet<MatchSummary[]>(
    `/api/player/${encodeURIComponent(name)}/${encodeURIComponent(tag)}/matches?region=${encodeURIComponent(region)}&size=${size}`,
  );
}
