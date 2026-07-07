import { useState } from 'react';
import { SearchBar } from './SearchBar';
import { StatTiles } from './StatTiles';
import {
  getAccount,
  getMMR,
  getMatchHistory,
  ApiError,
  type Account,
  type MMR,
  type HistorySummary,
} from '../lib/api';
import { parseRiotId } from '../lib/parseRiotId';

interface ComparePageProps {
  onBack: () => void;
}

interface SlotState {
  loading: boolean;
  error: string | null;
  account: Account | null;
  mmr: MMR | null;
  summary: HistorySummary | null;
}

const EMPTY_SLOT: SlotState = {
  loading: false,
  error: null,
  account: null,
  mmr: null,
  summary: null,
};

export function ComparePage({ onBack }: ComparePageProps) {
  const [left, setLeft] = useState<SlotState>(EMPTY_SLOT);
  const [right, setRight] = useState<SlotState>(EMPTY_SLOT);

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="text-valorant-red">Compare</span> players
          </h1>
          <p className="mt-1 text-sm text-zinc-500">Look up two Riot IDs to compare their stats side by side.</p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="shrink-0 rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:border-zinc-600 hover:text-white"
        >
          ← Back to search
        </button>
      </div>

      <div className="grid w-full grid-cols-1 gap-6 lg:grid-cols-2">
        <CompareSlot slot={left} onSearch={(riotId) => runSearch(riotId, setLeft)} />
        <CompareSlot slot={right} onSearch={(riotId) => runSearch(riotId, setRight)} />
      </div>
    </div>
  );
}

async function runSearch(riotId: string, setSlot: (updater: (prev: SlotState) => SlotState) => void) {
  const parsed = parseRiotId(riotId);
  if (!parsed) {
    setSlot(() => ({ ...EMPTY_SLOT, error: 'Enter a valid Riot ID, like Name#TAG.' }));
    return;
  }

  setSlot((prev) => ({ ...prev, loading: true, error: null }));

  try {
    const account = await getAccount(parsed.name, parsed.tag);
    const [mmr, history] = await Promise.all([
      getMMR(parsed.name, parsed.tag, account.region),
      getMatchHistory(parsed.name, parsed.tag, account.region),
    ]);
    setSlot(() => ({ loading: false, error: null, account, mmr, summary: history.summary }));
  } catch (err) {
    let message = 'Something went wrong. Please try again.';
    if (err instanceof ApiError) {
      if (err.status === 429) message = 'Rate limited by the Valorant API. Please wait a moment and try again.';
      else if (err.status === 404) message = 'Player not found. Double check the name and tag.';
      else message = err.message;
    }
    setSlot(() => ({ ...EMPTY_SLOT, error: message }));
  }
}

function CompareSlot({ slot, onSearch }: { slot: SlotState; onSearch: (riotId: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <SearchBar onSearch={onSearch} loading={slot.loading} />

      {slot.loading && <p className="text-sm text-zinc-400">Searching…</p>}

      {slot.error && !slot.loading && (
        <div className="w-full max-w-md rounded-md border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {slot.error}
        </div>
      )}

      {slot.account && slot.mmr && slot.summary && !slot.loading && (
        <div className="w-full max-w-md space-y-4">
          <div className="flex items-center gap-3 border-t border-zinc-800 pt-4">
            {slot.mmr.iconUrl ? (
              <img src={slot.mmr.iconUrl} alt={slot.mmr.tierName} className="h-10 w-10" />
            ) : (
              <div className="h-10 w-10 rounded-full bg-zinc-800" />
            )}
            <div className="min-w-0">
              <p className="truncate font-semibold text-white">
                {slot.account.name}
                <span className="text-zinc-500">#{slot.account.tag}</span>
              </p>
              <p className="text-xs text-zinc-500">
                {slot.mmr.tierName} · {slot.account.region.toUpperCase()}
              </p>
            </div>
          </div>

          <StatTiles summary={slot.summary} />
          <p className="text-center text-xs text-zinc-600">
            {slot.summary.matches} {slot.summary.matches === 1 ? 'match' : 'matches'} ({slot.summary.wins}W–
            {slot.summary.losses}L) tracked
          </p>
        </div>
      )}
    </div>
  );
}
