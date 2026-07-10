import { useEffect, useState } from 'react';
import { getLeaderboard, ApiError, type Leaderboard as LeaderboardData } from '../lib/api';

const REGIONS = [
  { value: 'na', label: 'NA' },
  { value: 'eu', label: 'EU' },
  { value: 'ap', label: 'APAC' },
] as const;

type Region = (typeof REGIONS)[number]['value'];

interface LeaderboardProps {
  onPlayerSelect?: (name: string, tag: string) => void;
}

export function Leaderboard({ onPlayerSelect }: LeaderboardProps) {
  const [region, setRegion] = useState<Region>('na');
  const [data, setData] = useState<Record<Region, LeaderboardData | null>>({
    na: null,
    eu: null,
    ap: null,
  });
  const [errors, setErrors] = useState<Record<Region, string | null>>({
    na: null,
    eu: null,
    ap: null,
  });
  const [loading, setLoading] = useState<Record<Region, boolean>>({
    na: true,
    eu: true,
    ap: true,
  });

  useEffect(() => {
    const controller = new AbortController();

    for (const { value } of REGIONS) {
      getLeaderboard(value, 10, controller.signal)
        .then((res) => {
          setData((prev) => ({ ...prev, [value]: res }));
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setErrors((prev) => ({
            ...prev,
            [value]: err instanceof ApiError ? err.message : 'Failed to load leaderboard.',
          }));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading((prev) => ({ ...prev, [value]: false }));
        });
    }

    return () => controller.abort();
  }, []);

  const active = data[region];
  const activeError = errors[region];
  const activeLoading = loading[region];

  return (
    <div className="w-full max-w-2xl rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-300">Top 10 Leaderboard</h2>
        <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
          {REGIONS.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setRegion(r.value)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                region === r.value
                  ? 'bg-valorant-red/15 text-valorant-red'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        {!active && activeLoading && (
          <p className="py-6 text-center text-sm text-zinc-500">Loading leaderboard…</p>
        )}

        {!active && !activeLoading && activeError && (
          <p className="py-6 text-center text-sm text-red-300">{activeError}</p>
        )}

        {active && (
          <ol className="divide-y divide-zinc-800">
            {active.entries.map((entry) => {
              const clickable = !entry.anonymized && Boolean(onPlayerSelect);
              return (
                <li key={entry.rank}>
                  <button
                    type="button"
                    disabled={!clickable}
                    onClick={() => onPlayerSelect?.(entry.name, entry.tag)}
                    className={`flex w-full items-center gap-3 rounded-md py-2 pl-1 pr-2 text-left transition ${
                      clickable ? 'hover:bg-zinc-800/50' : 'cursor-default'
                    }`}
                  >
                    <span className="w-5 shrink-0 text-right text-sm font-semibold text-zinc-500">
                      {entry.rank}
                    </span>
                    {entry.cardUrl ? (
                      <img src={entry.cardUrl} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
                    ) : (
                      <div className="h-8 w-8 shrink-0 rounded bg-zinc-800" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">
                        {entry.name}
                        {entry.tag && <span className="text-zinc-500">#{entry.tag}</span>}
                      </p>
                      <p className="text-xs text-zinc-500">{entry.tierName}</p>
                    </div>
                    <div className="shrink-0 text-right text-sm">
                      <p className="font-medium text-white">{entry.rr} RR</p>
                      <p className="text-xs text-zinc-500">{entry.wins}W</p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
