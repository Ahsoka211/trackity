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
