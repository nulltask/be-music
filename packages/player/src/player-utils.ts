import type { BeMusicJson } from '@be-music/json';

export function resolveChartVolWavGain(chart: BeMusicJson): number {
  const volWav = chart.bms.volWav;
  if (typeof volWav !== 'number' || !Number.isFinite(volWav) || volWav < 0) {
    return 1;
  }
  return volWav / 100;
}

export function formatSeconds(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const totalCentiseconds = Math.floor(safe * 100);
  const centiseconds = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const secondsPart = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);

  if (totalMinutes < 60) {
    return `${totalMinutes}:${secondsPart.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
  }

  const minutesPart = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}:${minutesPart.toString().padStart(2, '0')}:${secondsPart.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
}

export function resolveAltModifierLabel(platform: NodeJS.Platform = process.platform): 'Alt' | 'Option' {
  return platform === 'darwin' ? 'Option' : 'Alt';
}
