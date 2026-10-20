/**
 * Times on the pages are written by the server in UTC, so a cached page reads the same everywhere and works without
 * script. In the browser, LOCAL_TIME_SCRIPT rewrites them in the viewer's local time. `<time data-local="minute|day"
 * datetime="…">` marks them, and the original UTC text stays in the title next to the local time and the time zone.
 *
 * The script is plain text rather than a function serialized with toString: the bundler may insert helpers into
 * function bodies that the browser would not have. local-time.test.ts runs this exact text against a fake document.
 *
 * `data-local="relative"` writes how long ago the moment was, in the page's language (`<html lang>`): "now", then
 * minutes, hours and days ago, and the local date once it is 30 days old, where a count of months would be vague.
 */
export const LOCAL_TIME_SCRIPT = `(() => {
  const pad = (value) => String(value).padStart(2, '0');
  const format = (date, precision) => {
    const day = date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
    return precision === 'day' ? day : day + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  };
  const ago = (date, now, lang) => {
    const seconds = Math.max(0, (now - date.getTime()) / 1000);
    if (seconds >= 30 * 86400) return format(date, 'day');
    const relative = new Intl.RelativeTimeFormat(lang || undefined, { numeric: 'auto' });
    if (seconds < 60) return relative.format(0, 'second');
    if (seconds < 3600) return relative.format(-Math.floor(seconds / 60), 'minute');
    if (seconds < 86400) return relative.format(-Math.floor(seconds / 3600), 'hour');
    return relative.format(-Math.floor(seconds / 86400), 'day');
  };
  const run = () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = Date.now();
    const lang = document.documentElement && document.documentElement.lang;
    for (const element of document.querySelectorAll('time[data-local]')) {
      const date = new Date(element.dateTime);
      if (Number.isNaN(date.getTime())) continue;
      const utc = element.title;
      const precision = element.dataset.local;
      element.textContent =
        precision === 'relative' ? ago(date, now, lang) : format(date, precision === 'day' ? 'day' : 'minute');
      element.title = format(date, 'minute') + ' ' + zone + ' · ' + utc;
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();`;
