export type LocalTimePrecision = 'minute' | 'day' | 'relative';

/** Local display values; the server's original UTC text remains available in the tooltip. */
export function localTimePresentation(input: {
  dateTime: string;
  utc: string;
  precision: LocalTimePrecision;
  locale: string;
  timeZone: string;
  now: number;
}): { text: string; title: string } | undefined {
  const date = new Date(input.dateTime);
  if (!Number.isFinite(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: input.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === name)!.value;
  const day = `${part('year')}-${part('month')}-${part('day')}`;
  const minute = `${day} ${part('hour')}:${part('minute')}`;
  let text = input.precision === 'day' ? day : minute;
  if (input.precision === 'relative') {
    const seconds = Math.max(0, (input.now - date.getTime()) / 1000);
    if (seconds >= 30 * 86400) text = day;
    else {
      const relative = new Intl.RelativeTimeFormat(input.locale || undefined, { numeric: 'auto' });
      text =
        seconds < 60
          ? relative.format(0, 'second')
          : seconds < 3600
            ? relative.format(-Math.floor(seconds / 60), 'minute')
            : seconds < 86400
              ? relative.format(-Math.floor(seconds / 3600), 'hour')
              : relative.format(-Math.floor(seconds / 86400), 'day');
    }
  }
  return { text, title: `${minute} ${input.timeZone} · ${input.utc}` };
}
