import type { MatchSummary } from '../lib/api';

interface MatchRowProps {
  match: MatchSummary;
  selfName: string;
  selfTag: string;
  expanded: boolean;
  onToggle: () => void;
}

export function MatchRow({ match, selfName, selfTag, expanded, onToggle }: MatchRowProps) {
  const resultLabel = match.won === null ? '—' : match.won ? 'W' : 'L';
  const resultClass =
    match.won === null
      ? 'bg-zinc-800 text-zinc-400'
      : match.won
        ? 'bg-emerald-950/60 text-emerald-400'
        : 'bg-red-950/60 text-valorant-red';

  return (
    <div className="border-b border-zinc-800 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-zinc-800/40"
      >
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded text-xs font-bold ${resultClass}`}>
          {resultLabel}
        </span>

        {match.agentIconUrl ? (
          <img src={match.agentIconUrl} alt={match.agent ?? ''} className="h-8 w-8 shrink-0 rounded" />
        ) : (
          <div className="h-8 w-8 shrink-0 rounded bg-zinc-800" />
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{match.map}</p>
          <p className="truncate text-xs text-zinc-500">{match.agent ?? 'Unknown agent'}</p>
        </div>

        <div className="shrink-0 text-right text-sm text-zinc-300">
          {match.kills}/{match.deaths}/{match.assists}
        </div>

        <div className="w-12 shrink-0 text-right text-sm font-medium text-zinc-300">
          {match.score ? `${match.score.won}-${match.score.lost}` : '—'}
        </div>

        <svg
          className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="bg-black/30 px-4 pb-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-zinc-500">
                <th className="py-2 text-left font-normal">Player</th>
                <th className="py-2 text-right font-normal">K</th>
                <th className="py-2 text-right font-normal">D</th>
                <th className="py-2 text-right font-normal">A</th>
                <th className="py-2 text-right font-normal">ACS</th>
                <th className="py-2 text-right font-normal">HS%</th>
              </tr>
            </thead>
            <tbody>
              {match.players.map((player) => {
                const isSelf =
                  player.name.toLowerCase() === selfName.toLowerCase() &&
                  player.tag.toLowerCase() === selfTag.toLowerCase();
                return (
                  <tr key={player.puuid} className={isSelf ? 'font-semibold text-valorant-red' : 'text-zinc-300'}>
                    <td className="py-1.5">
                      <div className="flex items-center gap-2">
                        {player.agentIconUrl && (
                          <img src={player.agentIconUrl} alt={player.agent} className="h-5 w-5 rounded" />
                        )}
                        <span className="truncate">
                          {player.name}
                          <span className="text-zinc-500">#{player.tag}</span>
                        </span>
                      </div>
                    </td>
                    <td className="py-1.5 text-right">{player.kills}</td>
                    <td className="py-1.5 text-right">{player.deaths}</td>
                    <td className="py-1.5 text-right">{player.assists}</td>
                    <td className="py-1.5 text-right">{player.acs}</td>
                    <td className="py-1.5 text-right">{player.headshotPercent}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
