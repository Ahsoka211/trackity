import { useEffect, useState } from 'react';
import {
  getAccount,
  getMMR,
  getMatchHistory,
  ApiError,
  type Account,
  type MMR,
  type HistorySummary,
} from '../lib/api';
import { StatTiles } from './StatTiles';

interface PlayerQuickStatsProps {
  name: string;
  tag: string;
}

// Fetched only once rendered (i.e. only after the user clicks a player name)
// — never eagerly for the whole scoreboard.
export function PlayerQuickStats({ name, tag }: PlayerQuickStatsProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [mmr, setMmr] = useState<MMR | null>(null);
  const [summary, setSummary] = useState<HistorySummary | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const accountData = await getAccount(name, tag);
        // size=1 keeps the payload small; the summary already aggregates
        // every stored match regardless of how many are returned.
        const [mmrData, history] = await Promise.all([
          getMMR(name, tag, accountData.region),
          getMatchHistory(name, tag, accountData.region, {}, 1, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setAccount(accountData);
        setMmr(mmrData);
        setSummary(history.summary);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load player stats.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [name, tag]);

  if (loading) {
    return <p className="px-3 py-3 text-xs text-zinc-500">Loading player stats…</p>;
  }

  if (error || !account || !mmr || !summary) {
    return <p className="px-3 py-3 text-xs text-red-300">{error ?? 'Failed to load player stats.'}</p>;
  }

  return (
    <div className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center">
      <div className="flex shrink-0 items-center gap-2.5 sm:w-48">
        {mmr.iconUrl ? (
          <img src={mmr.iconUrl} alt={mmr.tierName} className="h-9 w-9" />
        ) : (
          <div className="h-9 w-9 rounded-full bg-zinc-800" />
        )}
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-white">
            {account.name}
            <span className="text-zinc-500">#{account.tag}</span>
          </p>
          <p className="truncate text-[11px] text-zinc-500">
            {mmr.tierName} · {account.region.toUpperCase()} · Lvl {account.accountLevel}
          </p>
        </div>
      </div>
      <div className="flex-1">
        <StatTiles summary={summary} />
      </div>
    </div>
  );
}
