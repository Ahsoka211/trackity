import { useState } from 'react';
import { deepScanCurrentPlayer, ApiError, type PlayerDeepScan } from '../lib/api';
import { DeepScanResult } from './DeepScanResult';

interface PlayerDeepScanCardProps {
  name: string;
  tag: string;
  region: string;
}

// Runs the same duo-boosting deep scan used for flagged match players, but
// against whichever player's page is currently being viewed — no match_id
// or prior "Check for suspicious players" pass required. Strictly
// click-triggered, same as every other suspicion-scanner entry point.
export function PlayerDeepScanCard({ name, tag, region }: PlayerDeepScanCardProps) {
  const [scan, setScan] = useState<PlayerDeepScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleScan() {
    setScanning(true);
    setError(null);
    try {
      setScan(await deepScanCurrentPlayer(name, tag, region));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Deep scan failed. Please try again.');
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-400">Boosting signals</h3>
          <p className="mt-0.5 text-xs text-zinc-600">
            Checks this player's recent teammates for a duo-boosting pattern — a statistical
            signal, not proof of boosting.
          </p>
        </div>
        {!scan && (
          <button
            type="button"
            onClick={handleScan}
            disabled={scanning}
            className="shrink-0 rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-zinc-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {scanning ? 'Scanning recent matches… this can take a minute or two' : 'Check for boosting signals'}
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      {scan && (
        <div className="mt-3 border-t border-zinc-800/70 pt-3">
          <DeepScanResult scan={scan} />
        </div>
      )}
    </div>
  );
}
