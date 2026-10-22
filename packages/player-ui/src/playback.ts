/** A playback position as a video player shows it: `m:ss`, or `h:mm:ss` from an hour. Negative times read as 0. */
export function formatPlaybackTime(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** Where a seek by `deltaSeconds` from `currentSeconds` lands, kept inside the chart (`0..durationSeconds`). */
export function resolveSeekTarget(currentSeconds: number, deltaSeconds: number, durationSeconds: number): number {
  const end = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
  return Math.max(0, Math.min(end, currentSeconds + deltaSeconds));
}
