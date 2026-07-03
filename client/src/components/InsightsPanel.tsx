import { useEffect, useState } from 'react';
import {
  getInsights,
  getRecommendations,
  ApiError,
  type PlayerInsights,
  type Recommendation,
} from '../lib/api';
import { DeathTimingChart } from './DeathTimingChart';

interface InsightsPanelProps {
  name: string;
  tag: string;
  region: string;
}

function agentIconUrl(agentId: string): string {
  return `https://media.valorant-api.com/agents/${agentId}/displayicon.png`;
}

export function InsightsPanel({ name, tag, region }: InsightsPanelProps) {
  const [insights, setInsights] = useState<PlayerInsights | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setInsights(null);

    Promise.all([
      getInsights(name, tag, region, controller.signal),
      getRecommendations(name, tag, region, controller.signal),
    ])
      .then(([insightsData, recsData]) => {
        setInsights(insightsData);
        setRecommendations(recsData.recommendations);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load insights.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [name, tag, region]);

  if (loading) {
    return (
      <div className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-6 text-center text-sm text-zinc-500">
        Crunching your match data…
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full rounded-md border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
        {error}
      </div>
    );
  }

  if (!insights || insights.matchesAnalyzed === 0) {
    return (
      <div className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-6 text-center text-sm text-zinc-500">
        No stored matches to analyze yet. Check back after a few games.
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      <p className="text-center text-xs text-zinc-600">
        Based on {insights.matchesAnalyzed} matches · {insights.roundsAnalyzed} rounds
      </p>

      <RecommendationList recommendations={recommendations} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/60">
          <h3 className="px-4 pt-4 pb-2 text-sm font-semibold text-zinc-400">Map performance</h3>
          <MapTable insights={insights} />
        </section>

        <section>
          <h3 className="pb-2 text-sm font-semibold text-zinc-400">Agent performance</h3>
          <AgentCards insights={insights} />
        </section>

        <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <h3 className="pb-1 text-sm font-semibold text-zinc-400">Weapon accuracy</h3>
          <WeaponBreakdown insights={insights} />
        </section>

        <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <h3 className="text-sm font-semibold text-zinc-400">Death timing</h3>
          <p className="pb-3 text-xs text-zinc-600">
            When you die within a round · {insights.deathTimes.totalDeaths} deaths
          </p>
          <DeathTimingChart deathTimes={insights.deathTimes} />
        </section>
      </div>
    </div>
  );
}

function RecommendationList({ recommendations }: { recommendations: Recommendation[] }) {
  if (recommendations.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-4 text-sm text-zinc-500">
        No standout patterns yet — recommendations get sharper as more matches are stored.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {recommendations.map((rec) => (
        <div
          key={rec.id}
          className="rounded-lg border border-zinc-800 border-l-4 border-l-valorant-red bg-zinc-900/60 p-4"
        >
          <div className="flex items-center gap-2">
            <span className="rounded bg-valorant-red/15 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-valorant-red">
              {rec.category}
            </span>
            <span className="text-xs text-zinc-600">sample: {rec.sampleSize}</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-zinc-100">{rec.message}</p>
          <p className="mt-1.5 text-xs text-zinc-500">{rec.evidence}</p>
        </div>
      ))}
    </div>
  );
}

function MapTable({ insights }: { insights: PlayerInsights }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-zinc-500">
          <th className="px-4 py-2 text-left font-normal">Map</th>
          <th className="py-2 text-right font-normal">W–L</th>
          <th className="py-2 pl-4 text-left font-normal">Win rate</th>
          <th className="px-4 py-2 text-right font-normal">K/D</th>
        </tr>
      </thead>
      <tbody>
        {insights.maps.map((m) => (
          <tr key={m.map} className="border-t border-zinc-800/70 text-zinc-300">
            <td className="px-4 py-2 font-medium text-white">{m.map}</td>
            <td className="py-2 text-right tabular-nums">
              {m.wins}–{m.losses}
            </td>
            <td className="py-2 pl-4">
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-valorant-red"
                    style={{ width: `${m.winRate}%` }}
                  />
                </div>
                <span className="text-xs tabular-nums text-zinc-400">{m.winRate}%</span>
              </div>
            </td>
            <td className="px-4 py-2 text-right tabular-nums">{m.kd.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AgentCards({ insights }: { insights: PlayerInsights }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {insights.agents.map((a) => (
        <div key={a.agent} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="flex items-center gap-2.5">
            {a.agentId ? (
              <img src={agentIconUrl(a.agentId)} alt={a.agent} className="h-9 w-9 rounded" />
            ) : (
              <div className="h-9 w-9 rounded bg-zinc-800" />
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{a.agent}</p>
              <p className="text-xs text-zinc-500">
                {a.matches} {a.matches === 1 ? 'match' : 'matches'}
              </p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1 border-t border-zinc-800 pt-2 text-center">
            <div>
              <p className="text-xs text-zinc-500">W–L</p>
              <p className="text-sm font-medium tabular-nums text-zinc-200">
                {a.wins}–{a.losses}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Win %</p>
              <p className="text-sm font-medium tabular-nums text-zinc-200">{a.winRate}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">K/D</p>
              <p className="text-sm font-medium tabular-nums text-zinc-200">{a.kd.toFixed(2)}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function WeaponBreakdown({ insights }: { insights: PlayerInsights }) {
  const weapons = insights.weapons.filter((w) => w.kills > 0).slice(0, 8);

  if (weapons.length === 0) {
    return <p className="py-3 text-sm text-zinc-500">No weapon kills recorded yet.</p>;
  }

  return (
    <div>
      <div className="divide-y divide-zinc-800/70">
        {weapons.map((w) => (
          <div key={w.weaponId} className="flex items-center gap-3 py-2">
            <span className="w-24 truncate text-sm text-zinc-200" title={w.weapon}>
              {w.weapon}
            </span>
            <span className="w-14 shrink-0 text-xs tabular-nums text-zinc-500">
              {w.kills} {w.kills === 1 ? 'kill' : 'kills'}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-valorant-red"
                style={{ width: `${Math.min(w.hsPercent ?? 0, 100)}%` }}
              />
            </div>
            <span className="w-12 shrink-0 text-right text-sm tabular-nums text-zinc-200">
              {w.hsPercent !== null ? `${w.hsPercent}%` : '—'}
            </span>
          </div>
        ))}
      </div>
      <p className="pt-2 text-xs text-zinc-600">
        HS% estimated from rounds where all kills came from one weapon.
      </p>
    </div>
  );
}
