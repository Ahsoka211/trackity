import type { HistorySummary, MMR } from './api';

export interface ShareImageData {
  name: string;
  tag: string;
  region: string;
  mmr: MMR;
  summary: HistorySummary;
}

// Logical layout size; actual canvas is rendered at SCALE for crisper text.
const WIDTH = 1200;
const HEIGHT = 630;
const SCALE = 2;
const PAD = 56;

// Hardcoded hex equivalents of the Tailwind utility colors used on the live
// page (zinc/emerald/valorant-red). Canvas can't resolve Tailwind's oklch()
// output, so the palette is duplicated here rather than read from the DOM.
const COLORS = {
  bg: '#0f1923',
  panel: 'rgba(24, 24, 27, 0.55)',
  border: '#27272a',
  textPrimary: '#ffffff',
  textSecondary: '#a1a1aa',
  textMuted: '#71717a',
  red: '#ff4655',
  green: '#34d399',
  greenBg: 'rgba(6, 78, 59, 0.6)',
  redBg: 'rgba(69, 10, 10, 0.6)',
};

const FONT = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export async function generateShareImage(data: ShareImageData): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * SCALE;
  canvas.height = HEIGHT * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not supported in this browser.');
  ctx.scale(SCALE, SCALE);

  const iconImg = data.mmr.iconUrl ? await loadImage(data.mmr.iconUrl) : null;

  // Background + a soft accent glow, matching the site's dark theme.
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const glow = ctx.createRadialGradient(WIDTH - 80, 40, 0, WIDTH - 80, 40, 520);
  glow.addColorStop(0, 'rgba(255, 70, 85, 0.16)');
  glow.addColorStop(1, 'rgba(255, 70, 85, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Wordmark
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 28px ${FONT}`;
  ctx.fillStyle = COLORS.red;
  ctx.fillText('Track', PAD, PAD + 8);
  const trackWidth = ctx.measureText('Track').width;
  ctx.fillStyle = COLORS.textPrimary;
  ctx.fillText('ity', PAD + trackWidth, PAD + 8);

  // Rank icon
  const iconSize = 108;
  const iconX = PAD;
  const iconY = 130;
  if (iconImg) {
    ctx.drawImage(iconImg, iconX, iconY, iconSize, iconSize);
  } else {
    ctx.fillStyle = COLORS.border;
    ctx.beginPath();
    ctx.arc(iconX + iconSize / 2, iconY + iconSize / 2, iconSize / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Name, tag, region, tier
  const textX = iconX + iconSize + 30;
  ctx.font = `700 42px ${FONT}`;
  ctx.fillStyle = COLORS.textPrimary;
  ctx.fillText(data.name, textX, iconY + 46);
  const nameWidth = ctx.measureText(data.name).width;
  ctx.fillStyle = COLORS.textMuted;
  ctx.fillText(`#${data.tag}`, textX + nameWidth + 6, iconY + 46);

  ctx.font = `400 22px ${FONT}`;
  ctx.fillStyle = COLORS.textSecondary;
  ctx.fillText(`${data.region.toUpperCase()} · ${data.mmr.tierName}`, textX, iconY + 82);

  // Streak badge, top-right of the header
  if (data.summary.streak) {
    const isWin = data.summary.streak.type === 'W';
    const label = `${data.summary.streak.type}${data.summary.streak.count}`;
    ctx.font = `700 24px ${FONT}`;
    const labelWidth = ctx.measureText(label).width;
    const badgeW = labelWidth + 32;
    const badgeH = 44;
    const badgeX = WIDTH - PAD - badgeW;
    const badgeY = iconY + 4;
    roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 10);
    ctx.fillStyle = isWin ? COLORS.greenBg : COLORS.redBg;
    ctx.fill();
    ctx.fillStyle = isWin ? COLORS.green : COLORS.red;
    ctx.textAlign = 'center';
    ctx.fillText(label, badgeX + badgeW / 2, badgeY + badgeH / 2 + 8);
    ctx.textAlign = 'left';
  }

  // Divider
  const dividerY = iconY + iconSize + 44;
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, dividerY);
  ctx.lineTo(WIDTH - PAD, dividerY);
  ctx.stroke();

  // Stat tiles: Win rate / K-D / Avg ACS / HS%, matching the site's StatTiles.
  const tiles = [
    { label: 'WIN RATE', value: `${data.summary.winRate}%` },
    { label: 'K/D', value: data.summary.kd.toFixed(2) },
    { label: 'AVG ACS', value: String(data.summary.avgAcs) },
    { label: 'HS%', value: `${data.summary.hsPercent}%` },
  ];
  const tileGap = 20;
  const tileY = dividerY + 44;
  const tileH = 150;
  const tileW = (WIDTH - PAD * 2 - tileGap * (tiles.length - 1)) / tiles.length;

  ctx.textAlign = 'center';
  tiles.forEach((tile, i) => {
    const x = PAD + i * (tileW + tileGap);
    roundRect(ctx, x, tileY, tileW, tileH, 14);
    ctx.fillStyle = COLORS.panel;
    ctx.fill();
    ctx.strokeStyle = COLORS.border;
    ctx.stroke();

    const cx = x + tileW / 2;
    ctx.font = `600 18px ${FONT}`;
    ctx.fillStyle = COLORS.textMuted;
    ctx.fillText(tile.label, cx, tileY + 46);

    ctx.font = `700 46px ${FONT}`;
    ctx.fillStyle = COLORS.textPrimary;
    ctx.fillText(tile.value, cx, tileY + 108);
  });
  ctx.textAlign = 'left';

  // Footer
  ctx.font = `400 18px ${FONT}`;
  ctx.fillStyle = COLORS.textMuted;
  ctx.fillText('trackity', PAD, HEIGHT - 34);
  const footerRight = `${data.summary.matches} ${data.summary.matches === 1 ? 'match' : 'matches'} tracked (${data.summary.wins}W–${data.summary.losses}L)`;
  ctx.textAlign = 'right';
  ctx.fillText(footerRight, WIDTH - PAD, HEIGHT - 34);
  ctx.textAlign = 'left';

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to generate the share image.'));
    }, 'image/png');
  });
}
