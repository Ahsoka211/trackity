export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
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

export interface RankHistoryPoint {
  matchId: string;
  map: string;
  playedAt: string;
  tier: number;
  tierName: string;
  rr: number;
  chartRr: number;
  eloChange: number;
  iconUrl: string | null;
  rankChange: { fromTier: number; fromTierName: string } | null;
}

export interface RankHistory {
  region: string;
  points: RankHistoryPoint[];
}

export function getRankHistory(
  name: string,
  tag: string,
  region: string,
  signal?: AbortSignal,
): Promise<RankHistory> {
  return apiGet<RankHistory>(
    `/api/player/${encodeURIComponent(name)}/${encodeURIComponent(tag)}/rank-history?region=${encodeURIComponent(region)}`,
    signal,
  );
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  tag: string;
  anonymized: boolean;
  tier: number;
  tierName: string;
  rr: number;
  wins: number;
  cardUrl: string | null;
}

export interface Leaderboard {
  region: string;
  updatedAt: string;
  entries: LeaderboardEntry[];
}

export function getLeaderboard(
  region: string,
  size = 10,
  signal?: AbortSignal,
): Promise<Leaderboard> {
  return apiGet<Leaderboard>(
    `/api/leaderboard/${encodeURIComponent(region)}?size=${size}`,
    signal,
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

export interface MatchStreak {
  type: 'W' | 'L';
  count: number;
}

export interface HistorySummary {
  matches: number;
  wins: number;
  losses: number;
  winRate: number;
  kd: number;
  avgAcs: number;
  hsPercent: number;
  streak: MatchStreak | null;
}

export interface FilterOptions {
  modes: { id: string; name: string }[];
  maps: string[];
  agents: string[];
}

export interface MatchFilters {
  mode?: string;
  map?: string;
  agent?: string;
  since?: string;
}

export interface MatchHistoryResponse {
  summary: HistorySummary;
  filters: FilterOptions;
  matches: MatchSummary[];
}

export function getMatchHistory(
  name: string,
  tag: string,
  region: string,
  filters: MatchFilters = {},
  size = 20,
  signal?: AbortSignal,
): Promise<MatchHistoryResponse> {
  const params = new URLSearchParams({ region, size: String(size) });
  if (filters.mode) params.set('mode', filters.mode);
  if (filters.map) params.set('map', filters.map);
  if (filters.agent) params.set('agent', filters.agent);
  if (filters.since) params.set('since', filters.since);
  return apiGet<MatchHistoryResponse>(
    `/api/player/${encodeURIComponent(name)}/${encodeURIComponent(tag)}/matches?${params.toString()}`,
    signal,
  );
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

export type AgentRole = 'Duelist' | 'Initiator' | 'Controller' | 'Sentinel';

export interface RoleStat {
  role: AgentRole | 'Unknown';
  matches: number;
  wins: number;
  losses: number;
  winRate: number;
  kills: number;
  deaths: number;
  kd: number;
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

export interface RoundTypeStat {
  roundType: 'pistol' | 'eco' | 'semi' | 'fullBuy' | 'unknown';
  rounds: number;
  won: number;
  winRate: number;
}

export interface WeaponStat {
  weaponId: string;
  weapon: string;
  type: string;
  kills: number;
  hsPercent: number | null;
  hsSampleRounds: number;
}

export type RoundPhase = 'opening' | 'mid' | 'late' | 'postPlant';

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
  byRoundType: Record<string, PhaseCounts>;
}

export interface FirstBloodStats {
  rounds: number;
  firstBloods: number;
  firstDeaths: number;
  firstBloodRate: number;
  firstDeathRate: number;
}

export interface ClutchRecord {
  attempts: number;
  wins: number;
}

export interface ClutchStats {
  attempts: number;
  wins: number;
  bySituation: Record<'1v1' | '1v2' | '1v3' | '1v4' | '1v5', ClutchRecord>;
}

export interface MultiKillStats {
  doubleKills: number;
  tripleKills: number;
  quadKills: number;
  aces: number;
}

export interface PlayerInsights {
  matchesAnalyzed: number;
  roundsAnalyzed: number;
  overall: OverallStats;
  maps: MapStat[];
  agents: AgentStat[];
  roles: RoleStat[];
  sidesByMap: SideStatByMap[];
  roundTypes: RoundTypeStat[];
  weapons: WeaponStat[];
  deathTimes: DeathTimeStats;
  firstBlood: FirstBloodStats;
  clutches: ClutchStats;
  multiKills: MultiKillStats;
}

export interface Recommendation {
  id: string;
  category: string;
  message: string;
  evidence: string;
  sampleSize: number;
  score: number;
}

export interface PlayerRecommendations {
  matchesAnalyzed: number;
  roundsAnalyzed: number;
  recommendations: Recommendation[];
}

export function getInsights(
  name: string,
  tag: string,
  region: string,
  signal?: AbortSignal,
): Promise<PlayerInsights> {
  return apiGet<PlayerInsights>(
    `/api/player/${encodeURIComponent(name)}/${encodeURIComponent(tag)}/insights?region=${encodeURIComponent(region)}`,
    signal,
  );
}

export function getRecommendations(
  name: string,
  tag: string,
  region: string,
  signal?: AbortSignal,
): Promise<PlayerRecommendations> {
  return apiGet<PlayerRecommendations>(
    `/api/player/${encodeURIComponent(name)}/${encodeURIComponent(tag)}/recommendations?region=${encodeURIComponent(region)}`,
    signal,
  );
}
