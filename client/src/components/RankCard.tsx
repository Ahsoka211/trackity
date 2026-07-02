import type { Account, MMR } from '../lib/api';

interface RankCardProps {
  account: Account;
  mmr: MMR;
}

export function RankCard({ account, mmr }: RankCardProps) {
  return (
    <div className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-900/60 p-6">
      <div className="flex items-center gap-4">
        {mmr.iconUrl ? (
          <img src={mmr.iconUrl} alt={mmr.tierName} className="h-16 w-16" />
        ) : (
          <div className="h-16 w-16 rounded-full bg-zinc-800" />
        )}
        <div>
          <h2 className="text-lg font-semibold text-white">
            {account.name}
            <span className="text-zinc-500">#{account.tag}</span>
          </h2>
          <p className="text-sm text-zinc-400">
            {account.region.toUpperCase()} &middot; Level {account.accountLevel}
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-2 border-t border-zinc-800 pt-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-400">Current Rank</span>
          <span className="font-medium text-white">{mmr.tierName}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-400">RR</span>
          <span className="font-medium text-white">{mmr.rr} / 100</span>
        </div>
        {mmr.peak && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-400">Peak Rank</span>
            <span className="font-medium text-white">{mmr.peak.tierName}</span>
          </div>
        )}
      </div>
    </div>
  );
}
