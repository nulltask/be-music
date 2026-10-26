/** beatoraja 0.8.9 PlayerConfig.JUDGETIMING_MIN/MAX: integer milliseconds of display-clock adjustment. */
export function clampJudgeTimingMs(value: number): number {
  return Number.isFinite(value) ? Math.max(-500, Math.min(500, Math.round(value))) : 0;
}

/** LaneRenderer adds this value to its display clock. Input, audio and judgment clocks remain unchanged. */
export function resolveNoteDisplaySeconds(seconds: number, judgeTimingMs: number): number {
  return seconds + (Number.isFinite(judgeTimingMs) ? Math.trunc(judgeTimingMs) : 0) / 1000;
}
