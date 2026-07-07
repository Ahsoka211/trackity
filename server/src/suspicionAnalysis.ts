import {
  getMatch,
  getMatchAnalysis,
  getMatchPlayers,
  getPlayerDeepScan,
  setMatchAnalysis,
  setPlayerDeepScan,
  type StoredMatchPlayerRow,
  type StoredMatchRow,
} from "./db";
import {
  ValorantApiError,
  getFullMatchDetails,
  getMMRByPuuid,
  getRecentCompetitiveMatches,
  type StoredMatchStatsEntry,
} from "./valorantApi";

// On-demand, button-triggered analysis of every player on a match's
// scoreboard. Entirely separate from the automatic insights pipeline in
// stats.ts — nothing here runs unless the analyze endpoint is called.
//
// The output is deliberately framed as statistical *signals*, never a
// cheater/smurf verdict: every heuristic here has innocent explanations
// (alt accounts, returning players, a hot streak).

const RECENT_SAMPLE_SIZE = 10;
// Spacing between Henrik calls. The whole analysis makes 2 calls per player
// (~20 total), which can exceed the key's per-minute budget on its own —
// so on 429 we wait out the limiter and resume instead of aborting a run
// that's already spent most of its calls.
const CALL_DELAY_MS = 500;
const RATE_LIMIT_MAX_WAITS = 4;
const RATE_LIMIT_DEFAULT_WAIT_S = 30;
const MIN_SAMPLE_FOR_PERFORMANCE_SIGNALS = 5;

export type SignalTier = "low" | "medium" | "high";
export type MatchVsRecent = "consistent" | "outlier-high" | "outlier-low" | "unknown";

export interface PlayerSuspicionResult {
  puuid: string;
  name: string;
  tag: string;
  agent: string;
  accountLevel: number | null;
  tierName: string;
  peakTierName: string | null;
  matchAcs: number;
  recentAvgAcs: number | null;
  recentSampleSize: number;
  matchVsRecent: MatchVsRecent;
  score: number;
  signalTier: SignalTier;
  signals: string[];
  // Set when Henrik lookups failed for this player; signals are then computed
  // from match-time data only.
  fetchError: string | null;
}

export interface MatchSuspicionAnalysis {
  matchId: string;
  analyzedAt: string;
  players: PlayerSuspicionResult[];
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Runs one Henrik call, waiting out up to RATE_LIMIT_MAX_WAITS rate-limit
// hits before giving up. `waitsUsed` is shared across the whole analysis so a
// persistently exhausted key fails the run instead of stalling for minutes.
async function withRateLimitWait<T>(
  call: () => Promise<T>,
  waitsUsed: { count: number },
): Promise<T> {
  for (;;) {
    await sleep(CALL_DELAY_MS);
    try {
      return await call();
    } catch (err) {
      if (
        err instanceof ValorantApiError &&
        err.status === 429 &&
        waitsUsed.count < RATE_LIMIT_MAX_WAITS
      ) {
        waitsUsed.count++;
        await sleep((err.retryAfterSeconds ?? RATE_LIMIT_DEFAULT_WAIT_S) * 1000);
        continue;
      }
      throw err;
    }
  }
}

// Tier ids 3..27 (Iron 1 .. Radiant); 0-2 are unranked/unused.
const RANK_BANDS = [
  "Iron",
  "Bronze",
  "Silver",
  "Gold",
  "Platinum",
  "Diamond",
  "Ascendant",
  "Immortal",
  "Radiant",
] as const;

// Approximate population-typical values per band, from public aggregate
// stats. Deliberately generous so only clear deviations trigger signals —
// especially at Immortal/Radiant, where 30-40% HS is routine and the smurf
// question is mostly moot anyway; the mid bands are where these matter.
const TYPICAL_HS_BY_BAND = [12, 14, 16, 18, 20, 22, 25, 28, 32];
const TYPICAL_ACS_BY_BAND = [190, 195, 200, 205, 210, 215, 220, 230, 245];

const DIAMOND_1 = 18;

function bandIndex(tier: number): number {
  if (tier >= 27) return 8;
  if (tier < 3) return 0;
  return Math.floor((tier - 3) / 3);
}

function bandName(tier: number): string {
  return RANK_BANDS[bandIndex(tier)];
}

interface RecentPerformance {
  sampleSize: number;
  avgAcs: number | null;
  hsPercent: number | null;
  oldestTier: number | null;
}

function summarizeRecent(
  entries: StoredMatchStatsEntry[],
  excludeMatchId: string,
): RecentPerformance {
  const usable = entries
    .filter((e) => e.meta.id !== excludeMatchId)
    .filter((e) => (e.teams.red ?? 0) + (e.teams.blue ?? 0) > 0)
    .slice(0, RECENT_SAMPLE_SIZE);

  if (usable.length === 0) {
    return { sampleSize: 0, avgAcs: null, hsPercent: null, oldestTier: null };
  }

  let acsTotal = 0;
  let head = 0;
  let shots = 0;
  for (const e of usable) {
    const rounds = (e.teams.red ?? 0) + (e.teams.blue ?? 0);
    acsTotal += e.stats.score / rounds;
    head += e.stats.shots.head;
    shots += e.stats.shots.head + e.stats.shots.body + e.stats.shots.leg;
  }
  // Entries are newest-first, so the last usable entry is the oldest.
  const oldest = usable[usable.length - 1];
  return {
    sampleSize: usable.length,
    avgAcs: Math.round(acsTotal / usable.length),
    hsPercent: shots > 0 ? Math.round((head / shots) * 1000) / 10 : null,
    oldestTier: oldest.stats.tier > 0 ? oldest.stats.tier : null,
  };
}

function tierFromScore(score: number): SignalTier {
  if (score >= 4) return "high";
  if (score >= 2) return "medium";
  return "low";
}

async function analyzePlayer(
  player: StoredMatchPlayerRow,
  match: StoredMatchRow,
  waitsUsed: { count: number },
): Promise<PlayerSuspicionResult> {
  let fetchError: string | null = null;
  let currentTier: number | null = null;
  let currentTierName: string | null = null;
  let peakTierName: string | null = null;
  let recent: RecentPerformance = { sampleSize: 0, avgAcs: null, hsPercent: null, oldestTier: null };

  try {
    const mmr = await withRateLimitWait(() => getMMRByPuuid(player.puuid, match.region), waitsUsed);
    currentTier = mmr.tier > 0 ? mmr.tier : null;
    currentTierName = mmr.tier > 0 ? mmr.tierName : null;
    peakTierName = mmr.peakTierName;

    // Fetch a few extra so excluding this match still leaves a full sample.
    const entries = await withRateLimitWait(
      () => getRecentCompetitiveMatches(player.puuid, match.region, RECENT_SAMPLE_SIZE + 3),
      waitsUsed,
    );
    recent = summarizeRecent(entries, match.match_id);
  } catch (err) {
    if (err instanceof ValorantApiError && err.status === 429) throw err;
    fetchError = "Could not fetch this player's history; signals are based on match data only.";
  }

  // Fall back to the rank recorded on the scoreboard when the live lookup
  // failed or the player hides their MMR.
  const tier = currentTier ?? (player.tier_id && player.tier_id > 0 ? player.tier_id : null);
  const tierName = currentTierName ?? player.tier_name ?? "Unranked";
  const level = player.account_level;
  const band = tier !== null ? bandIndex(tier) : null;

  const matchAcs =
    match.rounds_played > 0 ? Math.round(player.score / match.rounds_played) : 0;

  const signals: string[] = [];
  let score = 0;

  // 1. Low account level for a high displayed rank.
  if (tier !== null && tier >= DIAMOND_1 && level !== null) {
    if (level < 40) {
      score += 2;
      signals.push(`Account level ${level} at ${tierName} — very low for this rank`);
    } else if (level < 80) {
      score += 1;
      signals.push(`Account level ${level} is on the low side for ${tierName}`);
    }
  }

  const enoughSample = recent.sampleSize >= MIN_SAMPLE_FOR_PERFORMANCE_SIGNALS;

  // 2. Recent headshot rate well above what's typical for the displayed rank.
  if (enoughSample && band !== null && recent.hsPercent !== null) {
    const diff = Math.round(recent.hsPercent - TYPICAL_HS_BY_BAND[band]);
    if (diff >= 12) {
      score += 2;
      signals.push(
        `Recent headshot rate ${recent.hsPercent}% is ${diff} points above the ~${TYPICAL_HS_BY_BAND[band]}% typical for ${RANK_BANDS[band]}`,
      );
    } else if (diff >= 8) {
      score += 1;
      signals.push(
        `Recent headshot rate ${recent.hsPercent}% is ${diff} points above the ~${TYPICAL_HS_BY_BAND[band]}% typical for ${RANK_BANDS[band]}`,
      );
    }
  }

  // 3. Recent average ACS well above what's typical for the displayed rank.
  if (enoughSample && band !== null && recent.avgAcs !== null) {
    const diff = recent.avgAcs - TYPICAL_ACS_BY_BAND[band];
    if (diff >= 90) {
      score += 2;
      signals.push(
        `Recent average ACS ${recent.avgAcs} is far above the ~${TYPICAL_ACS_BY_BAND[band]} typical for ${RANK_BANDS[band]}`,
      );
    } else if (diff >= 60) {
      score += 1;
      signals.push(
        `Recent average ACS ${recent.avgAcs} is well above the ~${TYPICAL_ACS_BY_BAND[band]} typical for ${RANK_BANDS[band]}`,
      );
    }
  }

  // 4. Steep rank climb across the recent sample.
  if (tier !== null && recent.oldestTier !== null && recent.sampleSize >= 3) {
    const climb = tier - recent.oldestTier;
    if (climb >= 5) {
      score += 2;
      signals.push(
        `Climbed ${climb} rank tiers (${bandName(recent.oldestTier)} → ${bandName(tier)}) within their last ${recent.sampleSize} competitive matches`,
      );
    } else if (climb >= 3) {
      score += 1;
      signals.push(`Climbed ${climb} rank tiers within their last ${recent.sampleSize} competitive matches`);
    }
  }

  // 5. Is this match consistent with their recent average, or an outlier?
  let matchVsRecent: MatchVsRecent = "unknown";
  if (enoughSample && recent.avgAcs !== null && recent.avgAcs > 0) {
    const ratio = matchAcs / recent.avgAcs;
    if (ratio >= 1.5 && matchAcs >= 240) {
      matchVsRecent = "outlier-high";
      score += 1;
      signals.push(
        `ACS ${matchAcs} in this match is a major outlier vs their recent average of ${recent.avgAcs}`,
      );
    } else if (ratio <= 0.6) {
      matchVsRecent = "outlier-low";
    } else {
      matchVsRecent = "consistent";
    }
  }

  return {
    puuid: player.puuid,
    name: player.name,
    tag: player.tag,
    agent: player.agent_name,
    accountLevel: level,
    tierName,
    peakTierName,
    matchAcs,
    recentAvgAcs: recent.avgAcs,
    recentSampleSize: recent.sampleSize,
    matchVsRecent,
    score,
    signalTier: tierFromScore(score),
    signals,
    fetchError,
  };
}

// Analyzes every player on the scoreboard (the caller filters out the tracked
// player from the response). Caching the full lobby keyed by match_id means
// the same match re-viewed — even while tracking a different player — never
// re-triggers the ~20 Henrik calls.
export async function analyzeMatchPlayers(matchId: string): Promise<MatchSuspicionAnalysis> {
  const cached = getMatchAnalysis<MatchSuspicionAnalysis>(matchId);
  if (cached) return cached;

  const match = getMatch(matchId);
  if (!match) throw new ValorantApiError(404, "Match not found in the local store.");
  const players = getMatchPlayers(matchId);

  const waitsUsed = { count: 0 };
  const results: PlayerSuspicionResult[] = [];
  for (const player of players) {
    results.push(await analyzePlayer(player, match, waitsUsed));
  }
  results.sort((a, b) => b.score - a.score);

  const analysis: MatchSuspicionAnalysis = {
    matchId,
    analyzedAt: new Date().toISOString(),
    players: results,
  };
  setMatchAnalysis(matchId, analysis);
  return analysis;
}

// --- Deep scan: opt-in, per-flagged-player follow-up ---
//
// Looks for a duo-boosting pattern: a teammate who shows up often in this
// player's recent competitive matches at a much lower rank, with a large,
// consistent performance gap. Both halves matter — a frequent lower-rank
// teammate could just be a friend; a big performance gap in an isolated game
// could just be a carry. The combination, repeated, is the actual signal.
// Still not proof: could be coaching a friend, a family account, or a
// legitimate skill gap between duo partners.

// A duo-boosting pattern (a frequent, lopsided teammate) can easily miss a
// 10-game window — that's often just the last couple of sessions. 25 covers
// several weeks of typical play, giving repeated pairings room to show up.
const DEEP_SCAN_MATCH_COUNT = 25;
const MIN_SHARED_GAMES_FOR_DUO = 3;
const BOOSTING_TIER_GAP = 6; // ~2 rank colors (bands are 3 tiers wide)
const BOOSTING_ACS_RATIO = 1.6;

export interface FrequentTeammate {
  puuid: string;
  name: string;
  tag: string;
  gamesTogether: number;
  scannedAvgAcs: number;
  teammateAvgAcs: number;
  teammateTierName: string;
  possibleBoostingSignal: boolean;
}

export interface PlayerDeepScan {
  puuid: string;
  scannedAt: string;
  matchesScanned: number;
  // How deep this scan was configured to look, independent of matchesScanned
  // (which can fall short for a player with little competitive history, or a
  // few failed lookups). Lets a cache hit tell "targeted N, only found M
  // matches" apart from "was computed against an older, shallower target" —
  // only the latter should be treated as stale and recomputed.
  requestedMatchCount: number;
  frequentTeammates: FrequentTeammate[];
  summary: string;
}

interface TeammateAccumulator {
  name: string;
  tag: string;
  games: number;
  teammateAcsSum: number;
  scannedAcsSum: number;
  teammateTierSum: number;
  teammateTierCount: number;
  scannedTierSum: number;
  scannedTierCount: number;
  // Set from the first (most recent, since matches are newest-first) shared
  // game — a single representative label rather than an averaged-and-thus-
  // meaningless tier name.
  latestTierName: string;
}

export async function deepScanPlayer(puuid: string, region: string): Promise<PlayerDeepScan> {
  const cached = getPlayerDeepScan<PlayerDeepScan>(puuid);
  if (cached && cached.requestedMatchCount >= DEEP_SCAN_MATCH_COUNT) return cached;

  const waitsUsed = { count: 0 };
  const stored = await withRateLimitWait(
    () => getRecentCompetitiveMatches(puuid, region, DEEP_SCAN_MATCH_COUNT),
    waitsUsed,
  );

  const teammates = new Map<string, TeammateAccumulator>();
  let matchesScanned = 0;

  for (const entry of stored) {
    let details;
    try {
      details = await withRateLimitWait(() => getFullMatchDetails(entry.meta.id, region), waitsUsed);
    } catch (err) {
      if (err instanceof ValorantApiError && err.status === 429) throw err;
      continue; // Henrik occasionally can't return details for one match; skip it.
    }

    const me = details.players.find((p) => p.puuid === puuid);
    const rounds = details.rounds.length;
    if (!me || rounds === 0) continue;
    matchesScanned++;
    const myAcs = me.stats.score / rounds;
    const myTier = me.tier && me.tier.id > 0 ? me.tier.id : null;

    for (const p of details.players) {
      if (p.puuid === puuid || p.team_id !== me.team_id) continue;
      let acc = teammates.get(p.puuid);
      if (!acc) {
        acc = {
          name: p.name,
          tag: p.tag,
          games: 0,
          teammateAcsSum: 0,
          scannedAcsSum: 0,
          teammateTierSum: 0,
          teammateTierCount: 0,
          scannedTierSum: 0,
          scannedTierCount: 0,
          latestTierName: p.tier?.name ?? "Unranked",
        };
        teammates.set(p.puuid, acc);
      }
      acc.games++;
      acc.teammateAcsSum += p.stats.score / rounds;
      acc.scannedAcsSum += myAcs;
      if (p.tier && p.tier.id > 0) {
        acc.teammateTierSum += p.tier.id;
        acc.teammateTierCount++;
      }
      if (myTier !== null) {
        acc.scannedTierSum += myTier;
        acc.scannedTierCount++;
      }
    }
  }

  const frequentTeammates: FrequentTeammate[] = [...teammates.entries()]
    .filter(([, acc]) => acc.games >= MIN_SHARED_GAMES_FOR_DUO)
    .map(([teammatePuuid, acc]) => {
      const teammateAvgAcs = Math.round(acc.teammateAcsSum / acc.games);
      const scannedAvgAcs = Math.round(acc.scannedAcsSum / acc.games);
      const teammateAvgTier = acc.teammateTierCount > 0 ? acc.teammateTierSum / acc.teammateTierCount : null;
      const scannedAvgTier = acc.scannedTierCount > 0 ? acc.scannedTierSum / acc.scannedTierCount : null;
      const tierGap = teammateAvgTier !== null && scannedAvgTier !== null ? scannedAvgTier - teammateAvgTier : null;
      const acsRatio = teammateAvgAcs > 0 ? scannedAvgAcs / teammateAvgAcs : 0;
      const possibleBoostingSignal =
        tierGap !== null && tierGap >= BOOSTING_TIER_GAP && acsRatio >= BOOSTING_ACS_RATIO;

      return {
        puuid: teammatePuuid,
        name: acc.name,
        tag: acc.tag,
        gamesTogether: acc.games,
        scannedAvgAcs,
        teammateAvgAcs,
        teammateTierName: acc.latestTierName,
        possibleBoostingSignal,
      };
    })
    .sort((a, b) => Number(b.possibleBoostingSignal) - Number(a.possibleBoostingSignal) || b.gamesTogether - a.gamesTogether);

  const flagged = frequentTeammates.filter((t) => t.possibleBoostingSignal);
  const summary =
    flagged.length > 0
      ? `Plays regularly with ${flagged.length} teammate${flagged.length > 1 ? "s" : ""} at a notably lower rank with a large, consistent performance gap — a pattern that can indicate boosting, though it may also be a friend, duo partner, or family account.`
      : frequentTeammates.length > 0
        ? `No unusual rank or performance gap found among ${frequentTeammates.length} frequent teammate${frequentTeammates.length > 1 ? "s" : ""}.`
        : `No teammates appeared often enough across the ${matchesScanned} scanned matches to assess duo patterns.`;

  const scan: PlayerDeepScan = {
    puuid,
    scannedAt: new Date().toISOString(),
    matchesScanned,
    requestedMatchCount: DEEP_SCAN_MATCH_COUNT,
    frequentTeammates,
    summary,
  };
  setPlayerDeepScan(puuid, scan);
  return scan;
}
