import { useState } from 'react';
import type { DeathTimeStats, RoundPhase } from '../lib/api';

interface DeathTimingChartProps {
  deathTimes: DeathTimeStats;
}

const PHASES: { key: RoundPhase; label: string; range: string }[] = [
  { key: 'opening', label: 'Opening', range: '0–15s' },
  { key: 'mid', label: 'Mid', range: '15–35s' },
  { key: 'late', label: 'Late', range: '35s+' },
  { key: 'postPlant', label: 'Post-plant', range: 'after plant' },
];

// Chart geometry (viewBox units; the SVG scales to its container).
const W = 440;
const H = 210;
const PAD_L = 34;
const PAD_R = 8;
const PAD_T = 18;
const PAD_B = 38;
const BAR_W = 24;

export function DeathTimingChart({ deathTimes }: DeathTimingChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  const counts = PHASES.map((p) => deathTimes.byPhase[p.key]);
  const total = deathTimes.totalDeaths;
  const max = Math.max(...counts, 1);
  const tickStep = max > 40 ? 20 : max > 20 ? 10 : 5;
  const yMax = Math.ceil(max / tickStep) * tickStep;

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const band = plotW / PHASES.length;
  const y = (v: number) => PAD_T + plotH * (1 - v / yMax);
  const baseline = PAD_T + plotH;

  const ticks: number[] = [];
  for (let t = 0; t <= yMax; t += tickStep) ticks.push(t);

  // Column with a 4px rounded data-end and a square baseline.
  const barPath = (i: number, count: number): string => {
    const x = PAD_L + band * i + (band - BAR_W) / 2;
    const top = y(count);
    const r = Math.min(4, Math.max(0, baseline - top));
    return [
      `M ${x} ${baseline}`,
      `L ${x} ${top + r}`,
      `Q ${x} ${top} ${x + r} ${top}`,
      `L ${x + BAR_W - r} ${top}`,
      `Q ${x + BAR_W} ${top} ${x + BAR_W} ${top + r}`,
      `L ${x + BAR_W} ${baseline}`,
      'Z',
    ].join(' ');
  };

  const share = (count: number) => (total > 0 ? Math.round((count / total) * 1000) / 10 : 0);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Deaths by round phase: ${PHASES.map((p, i) => `${p.label} ${counts[i]}`).join(', ')}.`}
      >
        {/* gridlines + ticks */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={y(t)}
              y2={y(t)}
              stroke={t === 0 ? '#3f3f46' : '#27272a'}
              strokeWidth="1"
            />
            <text
              x={PAD_L - 6}
              y={y(t) + 3}
              textAnchor="end"
              fontSize="10"
              fill="#71717a"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {t}
            </text>
          </g>
        ))}

        {/* columns */}
        {PHASES.map((p, i) => (
          <path
            key={p.key}
            d={barPath(i, counts[i])}
            fill="#ff4655"
            fillOpacity={hovered === null || hovered === i ? 1 : 0.45}
          />
        ))}

        {/* value on each cap */}
        {PHASES.map((p, i) => (
          <text
            key={p.key}
            x={PAD_L + band * i + band / 2}
            y={y(counts[i]) - 6}
            textAnchor="middle"
            fontSize="11"
            fontWeight="600"
            fill="#e4e4e7"
          >
            {counts[i]}
          </text>
        ))}

        {/* phase labels */}
        {PHASES.map((p, i) => (
          <g key={p.key}>
            <text
              x={PAD_L + band * i + band / 2}
              y={baseline + 15}
              textAnchor="middle"
              fontSize="11"
              fill="#a1a1aa"
            >
              {p.label}
            </text>
            <text
              x={PAD_L + band * i + band / 2}
              y={baseline + 29}
              textAnchor="middle"
              fontSize="10"
              fill="#52525b"
            >
              {p.range}
            </text>
          </g>
        ))}

        {/* hover hit targets (full band, larger than the mark) */}
        {PHASES.map((p, i) => (
          <rect
            key={p.key}
            x={PAD_L + band * i}
            y={PAD_T}
            width={band}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          />
        ))}
      </svg>

      {hovered !== null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs shadow-lg"
          style={{
            left: `${((PAD_L + band * (hovered + 0.5)) / W) * 100}%`,
            top: `${((y(counts[hovered]) - 10) / H) * 100}%`,
          }}
        >
          <span className="font-medium text-zinc-100">{PHASES[hovered].label}</span>{' '}
          <span className="text-zinc-400">
            · {counts[hovered]} deaths ({share(counts[hovered])}%)
          </span>
        </div>
      )}
    </div>
  );
}
