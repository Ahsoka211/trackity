import { getPlayerInsights, type PlayerInsights, type RoundType } from "./stats";

// Rules-based coaching engine: each rule reads the aggregated insights,
// gates on a minimum sample size so single-game noise never fires, and
// emits plain-language recommendations. Results are ranked by score.

// Minimum samples per signal (the unit differs per rule: deaths, rounds,
// matches, clutch attempts, kills).
const MIN_TOTAL_DEATHS = 20;
const MIN_DEATHS_PER_ROUND_TYPE = 5;
const MIN_ROUNDS_PER_SIDE = 10;
const MIN_ROUNDS_PER_SIDE_OVERALL = 30;
const MIN_MATCHES_PER_GROUP = 5; // maps and agents
const MIN_ROUNDS_FOR_FIRST_DEATH = 50;
const MIN_CLUTCH_ATTEMPTS = 6;
const MIN_1V1_ATTEMPTS = 5;
const MIN_PISTOL_ROUNDS = 10;
const MIN_WEAPON_KILLS = 10;
const MIN_WEAPON_SAMPLE_ROUNDS = 5;

// Trigger thresholds.
const EARLY_DEATH_RELATIVE_EXCESS = 0.3; // 30% above own average
const EARLY_DEATH_ABSOLUTE_EXCESS = 0.05; // and at least 5 points above
const SIDE_GAP_POINTS = 12;
const SIDE_GAP_POINTS_OVERALL = 8;
const MAP_WINRATE_GAP_POINTS = 15;
const KD_UNDERPERFORMANCE_RATIO = 0.75;
const FIRST_DEATH_RATE_TRIGGER = 13; // ~10% of rounds is the neutral share
const CLUTCH_CONVERSION_RATIO = 0.6; // of expected wins
const CLUTCH_1V1_WINRATE_TRIGGER = 40;
const PISTOL_GAP_POINTS = 10;
const WEAPON_HS_RATIO = 0.7; // of own overall HS%

// Typical clutch conversion odds, used as the expectation baseline.
const CLUTCH_BASELINE = { "1v1": 0.5, "1v2": 0.25, "1v3": 0.12, "1v4": 0.05, "1v5": 0.02 } as const;

export type RecommendationCategory =
  | "pistols"
  | "sides"
  | "timing"
  | "maps"
  | "agents"
  | "duels"
  | "clutch"
  | "weapons";

// Ranking weight per category: how much round-win leverage fixing it has.
const CATEGORY_WEIGHT: Record<RecommendationCategory, number> = {
  pistols: 1.0,
  sides: 0.9,
  timing: 0.85,
  maps: 0.75,
  agents: 0.7,
  duels: 0.7,
  clutch: 0.6,
  weapons: 0.5,
};

export interface Recommendation {
  id: string;
  category: RecommendationCategory;
  message: string;
  evidence: string;
  sampleSize: number;
  // 0-100: category weight x effect size x sample confidence. Ranking key.
  score: number;
}

const pct1 = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

const points = (n: number): number => Math.round(n * 10) / 10;

function score(
  category: RecommendationCategory,
  effectSize: number, // 0..1, how far past the trigger the signal is
  sample: number,
  sampleForFullConfidence: number,
): number {
  const confidence = Math.min(1, sample / sampleForFullConfidence);
  return Math.round(CATEGORY_WEIGHT[category] * Math.min(1, effectSize) * confidence * 100);
}

type Rule = (i: PlayerInsights) => Recommendation[];

const ROUND_TYPE_LABEL: Partial<Record<RoundType, string>> = {
  pistol: "pistol rounds",
  eco: "eco rounds",
  semi: "semi-buy rounds",
  fullBuy: "full-buy rounds",
};

const earlyDeathRules: Rule = (i) => {
  const recs: Recommendation[] = [];
  const d = i.deathTimes;
  if (d.totalDeaths < MIN_TOTAL_DEATHS) return recs;
  const overallShare = d.byPhase.opening / d.totalDeaths;
  if (overallShare <= 0) return recs;

  for (const [type, label] of Object.entries(ROUND_TYPE_LABEL) as [RoundType, string][]) {
    const t = d.byRoundType[type];
    if (t.total < MIN_DEATHS_PER_ROUND_TYPE) continue;
    const share = t.opening / t.total;
    const excess = share / overallShare - 1;
    if (excess < EARLY_DEATH_RELATIVE_EXCESS || share - overallShare < EARLY_DEATH_ABSOLUTE_EXCESS) {
      continue;
    }
    recs.push({
      id: `early-deaths-${type}`,
      category: "timing",
      message:
        `You die in the first 15 seconds of ${label} ${Math.round(excess * 100)}% more often ` +
        `than your average — consider slower, more coordinated starts on ${label}.`,
      evidence:
        `${t.opening} of your ${t.total} deaths on ${label} come before 0:15 ` +
        `(${pct1(t.opening, t.total)}%), vs ${pct1(d.byPhase.opening, d.totalDeaths)}% of your deaths overall.`,
      sampleSize: t.total,
      score: score("timing", (share - overallShare) / 0.2, t.total, 30),
    });
  }
  return recs;
};

const sideRules: Rule = (i) => {
  const recs: Recommendation[] = [];

  const sideAdvice = (weakSide: "attack" | "defense", where: string): string =>
    weakSide === "defense"
      ? `review your defensive setups and retake decisions ${where}`
      : `review your executes and entry timing ${where}`;

  // Overall attack vs defense across all maps.
  const total = { attack: { rounds: 0, won: 0 }, defense: { rounds: 0, won: 0 } };
  for (const m of i.sidesByMap) {
    total.attack.rounds += m.attack.rounds;
    total.attack.won += m.attack.won;
    total.defense.rounds += m.defense.rounds;
    total.defense.won += m.defense.won;
  }
  if (
    total.attack.rounds >= MIN_ROUNDS_PER_SIDE_OVERALL &&
    total.defense.rounds >= MIN_ROUNDS_PER_SIDE_OVERALL
  ) {
    const attackRate = pct1(total.attack.won, total.attack.rounds);
    const defenseRate = pct1(total.defense.won, total.defense.rounds);
    const gap = attackRate - defenseRate;
    if (Math.abs(gap) >= SIDE_GAP_POINTS_OVERALL) {
      const weakSide = gap > 0 ? "defense" : "attack";
      const [weakRate, strongRate] = gap > 0 ? [defenseRate, attackRate] : [attackRate, defenseRate];
      const weak = gap > 0 ? total.defense : total.attack;
      recs.push({
        id: "side-imbalance-overall",
        category: "sides",
        message:
          `Across all maps your ${weakSide}-side round win rate (${weakRate}%) trails your ` +
          `${gap > 0 ? "attack" : "defense"} side (${strongRate}%) by ${points(Math.abs(gap))} points — ` +
          `${sideAdvice(weakSide, "across the board")}.`,
        evidence:
          `${total.defense.won}/${total.defense.rounds} defense rounds won vs ` +
          `${total.attack.won}/${total.attack.rounds} on attack.`,
        sampleSize: weak.rounds,
        score: score("sides", Math.abs(gap) / 25, weak.rounds, 80),
      });
    }
  }

  // Per-map imbalance.
  for (const m of i.sidesByMap) {
    if (m.attack.rounds < MIN_ROUNDS_PER_SIDE || m.defense.rounds < MIN_ROUNDS_PER_SIDE) continue;
    const gap = m.attack.winRate - m.defense.winRate;
    if (Math.abs(gap) < SIDE_GAP_POINTS) continue;
    const weakSide = gap > 0 ? "defense" : "attack";
    const [weak, strong] = gap > 0 ? [m.defense, m.attack] : [m.attack, m.defense];
    recs.push({
      id: `side-imbalance-${m.map.toLowerCase()}`,
      category: "sides",
      message:
        `Your ${weakSide}-side win rate on ${m.map} (${weak.winRate}%) is ` +
        `${points(Math.abs(gap))} points lower than your ${gap > 0 ? "attack" : "defense"} side ` +
        `(${strong.winRate}%) — ${sideAdvice(weakSide, `on ${m.map}`)}.`,
      evidence:
        `${m.defense.won}/${m.defense.rounds} defense rounds won vs ` +
        `${m.attack.won}/${m.attack.rounds} on attack on ${m.map}.`,
      sampleSize: Math.min(m.attack.rounds, m.defense.rounds),
      score: score("sides", Math.abs(gap) / 30, Math.min(m.attack.rounds, m.defense.rounds), 25),
    });
  }
  return recs;
};

const weakMapRules: Rule = (i) => {
  const recs: Recommendation[] = [];
  for (const m of i.maps) {
    if (m.matches < MIN_MATCHES_PER_GROUP) continue;
    const wrGap = i.overall.winRate - m.winRate;
    const kdRatio = i.overall.kd > 0 ? m.kd / i.overall.kd : 1;
    if (wrGap < MAP_WINRATE_GAP_POINTS && kdRatio > KD_UNDERPERFORMANCE_RATIO) continue;
    recs.push({
      id: `weak-map-${m.map.toLowerCase()}`,
      category: "maps",
      message:
        `${m.map} is dragging your record down — ${m.wins}W-${m.losses}L (${m.winRate}% vs ` +
        `${i.overall.winRate}% overall) at ${m.kd} K/D. Worth focused review, or avoid it in map picks.`,
      evidence: `${m.matches} matches on ${m.map}: ${m.kills} kills / ${m.deaths} deaths.`,
      sampleSize: m.matches,
      score: score("maps", Math.max(wrGap / 30, 1 - kdRatio), m.matches, 10),
    });
  }
  return recs;
};

const weakAgentRules: Rule = (i) => {
  const recs: Recommendation[] = [];
  const best = i.agents.filter((a) => a.matches >= MIN_MATCHES_PER_GROUP).sort((a, b) => b.winRate - a.winRate)[0];
  for (const a of i.agents) {
    if (a.matches < MIN_MATCHES_PER_GROUP) continue;
    const wrGap = i.overall.winRate - a.winRate;
    const kdRatio = i.overall.kd > 0 ? a.kd / i.overall.kd : 1;
    if (wrGap < MAP_WINRATE_GAP_POINTS && kdRatio > KD_UNDERPERFORMANCE_RATIO) continue;
    const alternative = best && best.agent !== a.agent ? ` — consider more ${best.agent} (${best.winRate}% win rate)` : "";
    recs.push({
      id: `weak-agent-${a.agent.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
      category: "agents",
      message:
        `Your ${a.agent} games underperform: ${a.winRate}% win rate at ${a.kd} K/D vs ` +
        `${i.overall.winRate}% and ${i.overall.kd} overall${alternative}.`,
      evidence: `${a.matches} matches on ${a.agent}: ${a.wins}W-${a.losses}L, ${a.kills}/${a.deaths} K/D.`,
      sampleSize: a.matches,
      score: score("agents", Math.max(wrGap / 30, 1 - kdRatio), a.matches, 10),
    });
  }
  return recs;
};

const firstDeathRule: Rule = (i) => {
  const fb = i.firstBlood;
  if (fb.rounds < MIN_ROUNDS_FOR_FIRST_DEATH) return [];
  if (fb.firstDeathRate < FIRST_DEATH_RATE_TRIGGER) return [];
  return [
    {
      id: "first-death-rate",
      category: "duels",
      message:
        `You're the first player to die in ${fb.firstDeathRate}% of rounds (about 10% is neutral) — ` +
        `tighten your early positioning and let utility go in ahead of you.`,
      evidence: `First death in ${fb.firstDeaths} of ${fb.rounds} rounds; first blood in ${fb.firstBloods}.`,
      sampleSize: fb.rounds,
      score: score("duels", (fb.firstDeathRate - 10) / 10, fb.rounds, 150),
    },
  ];
};

const clutchRules: Rule = (i) => {
  const c = i.clutches;

  if (c.attempts >= MIN_CLUTCH_ATTEMPTS) {
    let expectedWins = 0;
    for (const [situation, baseline] of Object.entries(CLUTCH_BASELINE) as [
      keyof typeof CLUTCH_BASELINE,
      number,
    ][]) {
      expectedWins += c.bySituation[situation].attempts * baseline;
    }
    if (expectedWins >= 1.5 && c.wins < expectedWins * CLUTCH_CONVERSION_RATIO) {
      return [
        {
          id: "clutch-conversion",
          category: "clutch",
          message:
            `You're converting ${c.wins} of ${c.attempts} clutches (${pct1(c.wins, c.attempts)}%); ` +
            `situations like yours typically convert around ${pct1(expectedWins, c.attempts)}% — ` +
            `practice endgame scenarios: play the clock, isolate duels, and use the spike.`,
          evidence: `1v1 ${c.bySituation["1v1"].wins}/${c.bySituation["1v1"].attempts}, ` +
            `1v2 ${c.bySituation["1v2"].wins}/${c.bySituation["1v2"].attempts}, ` +
            `1v3+ ${c.bySituation["1v3"].wins + c.bySituation["1v4"].wins + c.bySituation["1v5"].wins}/` +
            `${c.bySituation["1v3"].attempts + c.bySituation["1v4"].attempts + c.bySituation["1v5"].attempts}.`,
          sampleSize: c.attempts,
          score: score("clutch", 1 - c.wins / expectedWins, c.attempts, 20),
        },
      ];
    }
  }

  const duel = c.bySituation["1v1"];
  const duelWinRate = pct1(duel.wins, duel.attempts);
  if (duel.attempts >= MIN_1V1_ATTEMPTS && duelWinRate < CLUTCH_1V1_WINRATE_TRIGGER) {
    return [
      {
        id: "clutch-1v1",
        category: "clutch",
        message:
          `You've won only ${duel.wins} of ${duel.attempts} 1v1 clutches (${duelWinRate}%) — ` +
          `1v1s are the most winnable endgame; slow down, use the timer, and take the fight on your terms.`,
        evidence: `${duel.wins}/${duel.attempts} 1v1s won; a coin flip would be 50%.`,
        sampleSize: duel.attempts,
        score: score("clutch", (CLUTCH_1V1_WINRATE_TRIGGER + 10 - duelWinRate) / 50, duel.attempts, 15),
      },
    ];
  }
  return [];
};

const pistolRule: Rule = (i) => {
  const pistol = i.roundTypes.find((r) => r.roundType === "pistol");
  if (!pistol || pistol.rounds < MIN_PISTOL_ROUNDS) return [];
  let totalRounds = 0;
  let totalWon = 0;
  for (const r of i.roundTypes) {
    totalRounds += r.rounds;
    totalWon += r.won;
  }
  const overallRoundWinRate = pct1(totalWon, totalRounds);
  const gap = overallRoundWinRate - pistol.winRate;
  if (gap < PISTOL_GAP_POINTS) return [];
  return [
    {
      id: "pistol-win-rate",
      category: "pistols",
      message:
        `Your pistol-round win rate (${pistol.winRate}%) is ${points(gap)} points below your ` +
        `overall round win rate (${overallRoundWinRate}%) — pistols decide the two rounds that ` +
        `follow, so agree on a default pistol plan instead of improvising.`,
      evidence: `${pistol.won} of ${pistol.rounds} pistol rounds won, vs ${totalWon}/${totalRounds} overall.`,
      sampleSize: pistol.rounds,
      score: score("pistols", gap / 25, pistol.rounds, 20),
    },
  ];
};

const weaponHsRules: Rule = (i) => {
  const recs: Recommendation[] = [];
  if (i.overall.hsPercent <= 0) return recs;
  for (const w of i.weapons) {
    if (w.type !== "Weapon" || w.kills < MIN_WEAPON_KILLS) continue;
    if (w.hsPercent === null || w.hsSampleRounds < MIN_WEAPON_SAMPLE_ROUNDS) continue;
    if (w.hsPercent > i.overall.hsPercent * WEAPON_HS_RATIO) continue;
    recs.push({
      id: `weapon-hs-${w.weapon.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
      category: "weapons",
      message:
        `Your headshot rate with the ${w.weapon} (${w.hsPercent}%) runs well below your ` +
        `${i.overall.hsPercent}% average — drill crosshair placement with it, or lean on the ` +
        `weapons you hit heads with.`,
      evidence:
        `${w.kills} kills with the ${w.weapon}; HS% estimated from ${w.hsSampleRounds} ` +
        `single-weapon rounds.`,
      sampleSize: w.hsSampleRounds,
      score: score("weapons", 1 - w.hsPercent / i.overall.hsPercent, w.hsSampleRounds, 20),
    });
  }
  return recs;
};

const RULES: Rule[] = [
  pistolRule,
  sideRules,
  earlyDeathRules,
  weakMapRules,
  weakAgentRules,
  firstDeathRule,
  clutchRules,
  weaponHsRules,
];

export function generateRecommendations(insights: PlayerInsights): Recommendation[] {
  return RULES.flatMap((rule) => rule(insights)).sort((a, b) => b.score - a.score);
}

export interface PlayerRecommendations {
  matchesAnalyzed: number;
  roundsAnalyzed: number;
  recommendations: Recommendation[];
}

export function getPlayerRecommendations(puuid: string): PlayerRecommendations {
  const insights = getPlayerInsights(puuid);
  return {
    matchesAnalyzed: insights.matchesAnalyzed,
    roundsAnalyzed: insights.roundsAnalyzed,
    recommendations: generateRecommendations(insights),
  };
}
