import { useState } from 'react';
import type { MatchSummary } from '../lib/api';
import { MatchRow } from './MatchRow';

interface MatchHistoryListProps {
  matches: MatchSummary[];
  selfName: string;
  selfTag: string;
}

export function MatchHistoryList({ matches, selfName, selfTag }: MatchHistoryListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (matches.length === 0) {
    return (
      <div className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-6 text-center text-sm text-zinc-500">
        No matches found for the current filters.
      </div>
    );
  }

  return (
    <div className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60">
      <h3 className="px-4 pt-4 pb-2 text-sm font-semibold text-zinc-400">Match History</h3>
      {matches.map((match) => (
        <MatchRow
          key={match.matchId}
          match={match}
          selfName={selfName}
          selfTag={selfTag}
          expanded={expandedId === match.matchId}
          onToggle={() => setExpandedId((id) => (id === match.matchId ? null : match.matchId))}
        />
      ))}
    </div>
  );
}
