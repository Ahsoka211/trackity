import type { PlayerDeepScan } from '../lib/api';

export function DeepScanResult({ scan }: { scan: PlayerDeepScan }) {
  return (
    <div>
      <p className="text-[11px] text-zinc-500">
        Checked their teammates across {scan.matchesScanned} recent competitive matches for a
        duo-boosting pattern — not proof, just another statistical signal.
      </p>
      <p className="mt-1 text-[11px] text-zinc-400">{scan.summary}</p>
      {scan.frequentTeammates.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {scan.frequentTeammates.map((t) => (
            <li
              key={t.puuid}
              className={`text-[11px] ${t.possibleBoostingSignal ? 'text-amber-400' : 'text-zinc-500'}`}
            >
              <span className="font-medium">
                {t.name}#{t.tag}
              </span>{' '}
              ({t.teammateTierName}) · {t.gamesTogether} games together · {t.scannedAvgAcs} ACS vs their{' '}
              {t.teammateAvgAcs} ACS
              {t.possibleBoostingSignal && ' — possible boosting pattern'}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
