import { useEffect, useState } from 'react';
import {
  getMatchHistory,
  ApiError,
  type FilterOptions,
  type HistorySummary,
  type MatchFilters,
  type MatchHistoryResponse,
  type MatchStreak,
  type MMR,
} from '../lib/api';
import { MatchHistoryList } from './MatchHistoryList';
import { RankProgressChart } from './RankProgressChart';
import { ShareButton } from './ShareButton';
import { StatTiles } from './StatTiles';

interface OverviewTabProps {
  name: string;
  tag: string;
  region: string;
  mmr: MMR;
}

const DATE_RANGES = [
  { value: 'all', label: 'All time' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

export function OverviewTab({ name, tag, region, mmr }: OverviewTabProps) {
  const [mode, setMode] = useState('');
  const [map, setMap] = useState('');
  const [agent, setAgent] = useState('');
  const [range, setRange] = useState('all');
  const [data, setData] = useState<MatchHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const filters: MatchFilters = {};
    if (mode) filters.mode = mode;
    if (map) filters.map = map;
    if (agent) filters.agent = agent;
    if (range !== 'all') {
      filters.since = new Date(Date.now() - Number(range) * 86_400_000).toISOString();
    }

    getMatchHistory(name, tag, region, filters, 20, controller.signal)
      .then((res) => {
        setData(res);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load matches.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [name, tag, region, mode, map, agent, range]);

  if (!data && loading) {
    return (
      <div className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-6 text-center text-sm text-zinc-500">
        Loading match history… a player's first search can take half a minute.
      </div>
    );
  }

  if (!data) {
    return (
      <div className="w-full rounded-md border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
        {error ?? 'Failed to load matches.'}
      </div>
    );
  }

  return (
    <div className={`w-full space-y-4 transition-opacity ${loading ? 'opacity-60' : ''}`}>
      {error && (
        <div className="rounded-md border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end">
        <ShareButton name={name} tag={tag} region={region} mmr={mmr} summary={data.summary} />
      </div>

      <SummaryRow summary={data.summary} />
      <RankProgressChart name={name} tag={tag} region={region} />
      <FilterBar
        options={data.filters}
        mode={mode}
        map={map}
        agent={agent}
        range={range}
        onMode={setMode}
        onMap={setMap}
        onAgent={setAgent}
        onRange={setRange}
      />
      <MatchHistoryList matches={data.matches} selfName={name} selfTag={tag} />
    </div>
  );
}

function SummaryRow({ summary }: { summary: HistorySummary }) {
  return (
    <div>
      <StatTiles summary={summary} />
      <div className="mt-1.5 flex items-center justify-center gap-2">
        <p className="text-center text-xs text-zinc-600">
          {summary.matches} {summary.matches === 1 ? 'match' : 'matches'} ({summary.wins}W–
          {summary.losses}L) match the filters
        </p>
        {summary.streak && <StreakBadge streak={summary.streak} />}
      </div>
    </div>
  );
}

function StreakBadge({ streak }: { streak: MatchStreak }) {
  const isWin = streak.type === 'W';
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-bold tabular-nums ${
        isWin ? 'bg-emerald-950/60 text-emerald-400' : 'bg-red-950/60 text-valorant-red'
      }`}
    >
      {streak.type}
      {streak.count}
    </span>
  );
}

interface FilterBarProps {
  options: FilterOptions;
  mode: string;
  map: string;
  agent: string;
  range: string;
  onMode: (value: string) => void;
  onMap: (value: string) => void;
  onAgent: (value: string) => void;
  onRange: (value: string) => void;
}

function FilterBar({ options, mode, map, agent, range, onMode, onMap, onAgent, onRange }: FilterBarProps) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <FilterSelect
        label="Mode"
        value={mode}
        onChange={onMode}
        allLabel="All modes"
        options={options.modes.map((m) => ({ value: m.id, label: m.name }))}
      />
      <FilterSelect
        label="Map"
        value={map}
        onChange={onMap}
        allLabel="All maps"
        options={options.maps.map((m) => ({ value: m, label: m }))}
      />
      <FilterSelect
        label="Agent"
        value={agent}
        onChange={onAgent}
        allLabel="All agents"
        options={options.agents.map((a) => ({ value: a, label: a }))}
      />
      <FilterSelect label="Period" value={range} onChange={onRange} options={DATE_RANGES} />
    </div>
  );
}

interface FilterSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  allLabel?: string;
}

function FilterSelect({ label, value, onChange, options, allLabel }: FilterSelectProps) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full cursor-pointer appearance-none rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-200 outline-none focus:border-valorant-red"
    >
      {allLabel !== undefined && <option value="">{allLabel}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
