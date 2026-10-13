/**
 * Times on the pages are written by the server in UTC, so a cached page reads the same everywhere and works without
 * script. In the browser, LOCAL_TIME_SCRIPT rewrites them in the viewer's local time. `<time data-local="minute|day"
 * datetime="…">` marks them, and the original UTC text stays in the title next to the local time and the time zone.
 *
 * The script is plain text rather than a function serialized with toString: the bundler may insert helpers into
 * function bodies that the browser would not have. local-time.test.ts runs this exact text against a fake document.
 */
export const LOCAL_TIME_SCRIPT = `(() => {
  const pad = (value) => String(value).padStart(2, '0');
  const format = (date, precision) => {
    const day = date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
    return precision === 'day' ? day : day + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  };
  const run = () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    for (const element of document.querySelectorAll('time[data-local]')) {
      const date = new Date(element.dateTime);
      if (Number.isNaN(date.getTime())) continue;
      const utc = element.title;
      element.textContent = format(date, element.dataset.local === 'day' ? 'day' : 'minute');
      element.title = format(date, 'minute') + ' ' + zone + ' · ' + utc;
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();`;
