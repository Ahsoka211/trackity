import express, { type Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import {
  ValorantApiError,
  getAccount,
  getFilteredMatchHistory,
  getLeaderboard,
  getMMR,
  getMMRHistory,
  syncPlayerHistory,
} from "./valorantApi";
import { getPlayerInsights } from "./stats";
import { getPlayerRecommendations } from "./recommendations";
import { analyzeMatchPlayers, deepScanPlayer } from "./suspicionAnalysis";
import { getMatch } from "./db";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get("/api/hello", (_req, res) => {
  res.json({ message: "Hello from the server!" });
});

function handleValorantApiError(err: unknown, res: Response) {
  if (err instanceof ValorantApiError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Unexpected error contacting the Henrik API." });
}

function isForceRefresh(value: unknown): boolean {
  return value === "true" || value === "1";
}

app.get("/api/player/:name/:tag/account", async (req, res) => {
  try {
    const account = await getAccount(req.params.name, req.params.tag, isForceRefresh(req.query.refresh));
    res.json(account);
  } catch (err) {
    handleValorantApiError(err, res);
  }
});

app.get("/api/player/:name/:tag/mmr", async (req, res) => {
  const region = req.query.region;
  if (typeof region !== "string") {
    res.status(400).json({ error: "Query param 'region' is required (e.g. na, eu, ap, kr, latam, br)." });
    return;
  }
  try {
    const mmr = await getMMR(req.params.name, req.params.tag, region, isForceRefresh(req.query.refresh));
    res.json(mmr);
  } catch (err) {
    handleValorantApiError(err, res);
  }
});

app.get("/api/player/:name/:tag/rank-history", async (req, res) => {
  const region = req.query.region;
  if (typeof region !== "string") {
    res.status(400).json({ error: "Query param 'region' is required (e.g. na, eu, ap, kr, latam, br)." });
    return;
  }
  try {
    const history = await getMMRHistory(req.params.name, req.params.tag, region, isForceRefresh(req.query.refresh));
    res.json(history);
  } catch (err) {
    handleValorantApiError(err, res);
  }
});

app.get("/api/player/:name/:tag/matches", async (req, res) => {
  const region = req.query.region;
  if (typeof region !== "string") {
    res.status(400).json({ error: "Query param 'region' is required (e.g. na, eu, ap, kr, latam, br)." });
    return;
  }
  const size = Math.min(Number(req.query.size) || 20, 50);
  const param = (value: unknown): string | undefined =>
    typeof value === "string" && value !== "" ? value : undefined;
  const sinceRaw = param(req.query.since);
  const since =
    sinceRaw && !Number.isNaN(Date.parse(sinceRaw))
      ? new Date(sinceRaw).toISOString()
      : undefined;
  try {
    const account = await getAccount(req.params.name, req.params.tag);
    await syncPlayerHistory(account.puuid, region);
    res.json(
      getFilteredMatchHistory(
        account.puuid,
        {
          queueId: param(req.query.mode),
          map: param(req.query.map),
          agent: param(req.query.agent),
          since,
        },
        size,
      ),
    );
  } catch (err) {
    handleValorantApiError(err, res);
  }
});

app.get("/api/player/:name/:tag/insights", async (req, res) => {
  const region = req.query.region;
  if (typeof region !== "string") {
    res.status(400).json({ error: "Query param 'region' is required (e.g. na, eu, ap, kr, latam, br)." });
    return;
  }
  try {
    const account = await getAccount(req.params.name, req.params.tag);
    await syncPlayerHistory(account.puuid, region);
    res.json(getPlayerInsights(account.puuid));
  } catch (err) {
    handleValorantApiError(err, res);
  }
});

app.get("/api/player/:name/:tag/recommendations", async (req, res) => {
  const region = req.query.region;
  if (typeof region !== "string") {
    res.status(400).json({ error: "Query param 'region' is required (e.g. na, eu, ap, kr, latam, br)." });
    return;
  }
  try {
    const account = await getAccount(req.params.name, req.params.tag);
    await syncPlayerHistory(account.puuid, region);
    res.json(getPlayerRecommendations(account.puuid));
  } catch (err) {
    handleValorantApiError(err, res);
  }
});

// On-demand only: analysis runs when the user clicks the button in the match
// detail view, never as part of the automatic match/insights pipeline.
app.post("/api/match/:matchId/analyze-players", async (req, res) => {
  const excludePuuid =
    typeof req.body?.excludePuuid === "string" ? req.body.excludePuuid : null;
  try {
    const analysis = await analyzeMatchPlayers(req.params.matchId);
    res.json({
      ...analysis,
      players: excludePuuid
        ? analysis.players.filter((p) => p.puuid !== excludePuuid)
        : analysis.players,
    });
  } catch (err) {
    handleValorantApiError(err, res);
  }
});

// Also strictly on-demand: a separate, deeper follow-up scan triggered per
// flagged player from the analyze-players results, never run automatically.
app.post("/api/match/:matchId/analyze-players/:puuid/deep-scan", async (req, res) => {
  const match = getMatch(req.params.matchId);
  if (!match) {
    res.status(404).json({ error: "Match not found in the local store." });
    return;
  }
  try {
    const scan = await deepScanPlayer(req.params.puuid, match.region);
    res.json(scan);
  } catch (err) {
    handleValorantApiError(err, res);
  }
});

// On-demand deep scan of the player currently being viewed (as opposed to a
// specific match's flagged player above) — same underlying scan, just
// resolved by name/tag/region like every other player route instead of a
// match_id, since there's no match context on a player's own page.
app.post("/api/player/:name/:tag/deep-scan", async (req, res) => {
  const region = req.query.region;
  if (typeof region !== "string") {
    res.status(400).json({ error: "Query param 'region' is required (e.g. na, eu, ap, kr, latam, br)." });
    return;
  }
  try {
    const account = await getAccount(req.params.name, req.params.tag);
    const scan = await deepScanPlayer(account.puuid, region);
    res.json(scan);
  } catch (err) {
    handleValorantApiError(err, res);
  }
});

app.get("/api/leaderboard/:region", async (req, res) => {
  const size = Math.min(Number(req.query.size) || 10, 25);
  try {
    const leaderboard = await getLeaderboard(req.params.region, size, isForceRefresh(req.query.refresh));
    res.json(leaderboard);
  } catch (err) {
    handleValorantApiError(err, res);
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
