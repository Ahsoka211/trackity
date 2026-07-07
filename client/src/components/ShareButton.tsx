import { useState } from 'react';
import { generateShareImage } from '../lib/shareImage';
import type { HistorySummary, MMR } from '../lib/api';

interface ShareButtonProps {
  name: string;
  tag: string;
  region: string;
  mmr: MMR;
  summary: HistorySummary;
}

export function ShareButton({ name, tag, region, mmr, summary }: ShareButtonProps) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleShare() {
    setGenerating(true);
    setError(null);
    try {
      const blob = await generateShareImage({ name, tag, region, mmr, summary });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${name}-${tag}-trackity.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Could not generate the image. Please try again.');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-400">{error}</span>}
      <button
        type="button"
        onClick={handleShare}
        disabled={generating}
        className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-300 transition hover:border-zinc-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L7 9m5-5l5 5M5 20h14" />
        </svg>
        {generating ? 'Generating…' : 'Share'}
      </button>
    </div>
  );
}
