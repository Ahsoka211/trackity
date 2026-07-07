interface StatTilesProps {
  summary: {
    winRate: number;
    kd: number;
    avgAcs: number;
    hsPercent: number;
  };
}

export function StatTiles({ summary }: StatTilesProps) {
  const tiles = [
    { label: 'Win rate', value: `${summary.winRate}%` },
    { label: 'K/D', value: summary.kd.toFixed(2) },
    { label: 'Avg ACS', value: String(summary.avgAcs) },
    { label: 'HS%', value: `${summary.hsPercent}%` },
  ];

  return (
    <div className="grid grid-cols-4 gap-3">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2 py-2.5 text-center"
        >
          <p className="text-xs text-zinc-500">{tile.label}</p>
          <p className="mt-0.5 text-lg font-semibold text-white">{tile.value}</p>
        </div>
      ))}
    </div>
  );
}
