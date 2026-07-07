import { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import { getRankHistory, ApiError, type RankHistory, type RankHistoryPoint } from '../lib/api';

interface RankProgressChartProps {
  name: string;
  tag: string;
  region: string;
}

const VALORANT_RED = '#ff4655';
const PROMOTE_GREEN = '#34d399';

export function RankProgressChart({ name, tag, region }: RankProgressChartProps) {
  const [data, setData] = useState<RankHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    getRankHistory(name, tag, region, controller.signal)
      .then(setData)
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load rank history.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [name, tag, region]);

  if (loading) {
    return (
      <div className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-6 text-center text-sm text-zinc-500">
        Loading rank history…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="w-full rounded-md border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
        {error ?? 'Failed to load rank history.'}
      </div>
    );
  }

  if (data.points.length < 2) {
    return (
      <div className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-6 text-center text-sm text-zinc-500">
        Not enough ranked matches yet to chart rank progress.
      </div>
    );
  }

  return (
    <div className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-center justify-between pb-2">
        <h3 className="text-sm font-semibold text-zinc-400">Rank Progress</h3>
        <div className="flex items-center gap-3 text-xs text-zinc-600">
          <span>RR across last {data.points.length} ranked matches</span>
          <span className="flex items-center gap-1">
            <svg width="8" height="8" viewBox="0 0 12 12">
              <polygon points="6,0 12,12 0,12" fill={PROMOTE_GREEN} />
            </svg>
            promotion
            <svg width="8" height="8" viewBox="0 0 12 12">
              <polygon points="6,0 12,12 0,12" fill={VALORANT_RED} transform="rotate(180 6 6)" />
            </svg>
            demotion
          </span>
        </div>
      </div>

      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data.points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="rrFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={VALORANT_RED} stopOpacity={0.35} />
                <stop offset="100%" stopColor={VALORANT_RED} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#27272a" vertical={false} />
            <XAxis
              dataKey="playedAt"
              tickFormatter={(value: string) =>
                new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
              }
              tick={{ fill: '#71717a', fontSize: 10 }}
              axisLine={{ stroke: '#3f3f46' }}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              tick={{ fill: '#71717a', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={42}
              domain={['dataMin - 10', 'dataMax + 10']}
            />
            <Tooltip content={RankTooltip} />
            <Area
              type="monotone"
              dataKey="rr"
              stroke={VALORANT_RED}
              strokeWidth={2}
              fill="url(#rrFill)"
              dot={RankDot}
              activeDot={{ r: 5, fill: VALORANT_RED }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

interface DotRenderProps {
  cx?: number;
  cy?: number;
  payload?: RankHistoryPoint;
}

// Regular points get a small dim dot; a tier change gets a larger
// promotion/demotion triangle instead, so an RR reset reads as a rank
// change rather than a drop.
function RankDot(props: DotRenderProps) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload) return <g />;

  if (payload.rankChange) {
    const promoted = payload.tier > payload.rankChange.fromTier;
    return (
      <g transform={`translate(${cx - 6}, ${cy - 6})`}>
        <polygon
          points="6,0 12,12 0,12"
          fill={promoted ? PROMOTE_GREEN : VALORANT_RED}
          transform={promoted ? undefined : 'rotate(180 6 6)'}
          stroke="#0f1923"
          strokeWidth={1}
        />
      </g>
    );
  }

  return <circle cx={cx} cy={cy} r={2.5} fill={VALORANT_RED} fillOpacity={0.6} />;
}

function RankTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as RankHistoryPoint;

  return (
    <div className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs shadow-lg">
      <p className="font-medium text-zinc-100">
        {p.tierName} · {p.rr} RR
      </p>
      <p className="text-zinc-500">
        {p.map} · {new Date(p.playedAt).toLocaleString()}
      </p>
      <p className={p.eloChange >= 0 ? 'text-emerald-400' : 'text-valorant-red'}>
        {p.eloChange >= 0 ? '+' : ''}
        {p.eloChange} RR
      </p>
      {p.rankChange && (
        <p className={`mt-1 font-semibold ${p.tier > p.rankChange.fromTier ? 'text-emerald-400' : 'text-valorant-red'}`}>
          {p.tier > p.rankChange.fromTier ? 'Promoted' : 'Demoted'}: {p.rankChange.fromTierName} → {p.tierName}
        </p>
      )}
    </div>
  );
}
