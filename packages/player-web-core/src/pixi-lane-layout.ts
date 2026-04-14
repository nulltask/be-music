const VISUAL_LANE_ORDER = ['16', '11', '12', '13', '14', '15', '18', '19', '26', '21', '22', '23', '24', '25', '28', '29'] as const;
const DEFAULT_SP_LANES = ['16', '11', '12', '13', '14', '15', '18', '19'] as const;
const DEFAULT_DP_LANES = ['16', '11', '12', '13', '14', '15', '18', '19', '26', '21', '22', '23', '24', '25', '28', '29'] as const;

export type PixiLaneRole = 'scratch' | 'white' | 'black' | 'free';

export interface PixiLaneMetrics {
  channel: string;
  role: PixiLaneRole;
  x: number;
  width: number;
  side: 'left' | 'right';
}

export function resolveVisualLaneChannels(usedChannels: ReadonlyArray<string>): string[] {
  const used = new Set(usedChannels.map(normalizeVisualLaneChannel));
  const ordered = VISUAL_LANE_ORDER.filter((channel) => used.has(channel));
  if (ordered.length > 0) {
    return ordered;
  }
  return [...DEFAULT_SP_LANES];
}

export function createPixiLaneMetrics(
  channels: ReadonlyArray<string>,
  laneAreaX: number,
  laneAreaWidth: number,
  laneGap: number,
  splitGap: number,
): PixiLaneMetrics[] {
  const normalizedChannels = channels.length > 0 ? [...channels] : [...DEFAULT_SP_LANES];
  const isDp = normalizedChannels.some((channel) => channel.startsWith('2'));
  const orderedChannels = normalizedChannels.length > 0 ? normalizedChannels : [...(isDp ? DEFAULT_DP_LANES : DEFAULT_SP_LANES)];
  const weights = orderedChannels.map((channel) => (isScratchLane(channel) ? 1.28 : 1));
  const splitCount = isDp ? 1 : 0;
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const totalGap = Math.max(0, orderedChannels.length - 1) * laneGap + splitCount * splitGap;
  const unitWidth = totalWeight > 0 ? Math.max(18, (laneAreaWidth - totalGap) / totalWeight) : laneAreaWidth;

  const metrics: PixiLaneMetrics[] = [];
  let cursorX = laneAreaX;
  for (let index = 0; index < orderedChannels.length; index += 1) {
    const channel = orderedChannels[index]!;
    if (isDp && index === 8) {
      cursorX += splitGap;
    } else if (index > 0) {
      cursorX += laneGap;
    }
    const width = unitWidth * weights[index]!;
    metrics.push({
      channel,
      role: resolveLaneRole(channel),
      x: cursorX,
      width,
      side: channel.startsWith('2') ? 'right' : 'left',
    });
    cursorX += width;
  }
  return metrics;
}

function isScratchLane(channel: string): boolean {
  return channel === '16' || channel === '26';
}

function normalizeVisualLaneChannel(channel: string): string {
  if (channel === '17') {
    return '16';
  }
  if (channel === '27') {
    return '26';
  }
  return channel;
}

function resolveLaneRole(channel: string): PixiLaneRole {
  if (channel === '16' || channel === '26') {
    return 'scratch';
  }
  if (channel === '17' || channel === '27') {
    return 'free';
  }
  const laneNumber = Number.parseInt(channel[1] ?? '', 10);
  if (!Number.isFinite(laneNumber)) {
    return 'white';
  }
  return laneNumber % 2 === 0 ? 'black' : 'white';
}
