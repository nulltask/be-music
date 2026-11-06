/**
 * Splitting a plain text (a chart's README) into runs of text and the links in it: web addresses (`https://…`,
 * `http://…`, the `ttp://…` that BBS-era notes write to dodge auto-linking, and a bare `www.…`) and mail addresses. The
 * runs are data, so a renderer builds text nodes and anchors from them and never parses the text as HTML.
 */

/** One run of a text: plain text, or a link with the address it opens. */
export type BeMusicTextRun =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly href: string };

/**
 * A web address (scheme or `www.` first) or a mail address. Only ASCII is taken: a README's Japanese text right after
 * an address (`https://example.com/です`) ends it. Trailing punctuation is trimmed afterwards.
 */
const LINK_PATTERN =
  /(?:(?:h?ttps?:\/\/|www\.)[\w\-.~:/?#[\]@!$&'()*+,;=%]+)|(?:[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/giu;

/** Characters that end a sentence rather than an address when they close one. */
const TRAILING_PUNCTUATION = /[.,;:!?'*]+$/u;

/**
 * The end of a matched address without the punctuation that follows it in prose: a full stop, a comma, quotes, and a
 * closing bracket that has no opening one inside the address (`(see https://example.com)`).
 */
function trimAddress(candidate: string): string {
  let address = candidate;
  for (;;) {
    const trimmed = address.replace(TRAILING_PUNCTUATION, '');
    const last = trimmed.at(-1);
    const pairs: Readonly<Record<string, string>> = { ')': '(', ']': '[' };
    const opening = last === undefined ? undefined : pairs[last];
    if (opening !== undefined && count(trimmed, last!) > count(trimmed, opening)) {
      address = trimmed.slice(0, -1);
      continue;
    }
    return trimmed;
  }
}

function count(text: string, char: string): number {
  let total = 0;
  for (const c of text) if (c === char) total += 1;
  return total;
}

/** The address a link opens: `https://` before a bare `www.`, `h` before `ttp://`, `mailto:` before a mail address. */
function hrefOf(address: string): string | undefined {
  const lower = address.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) return address;
  if (lower.startsWith('ttp://') || lower.startsWith('ttps://')) return `h${address}`;
  if (lower.startsWith('www.')) return `https://${address}`;
  if (address.includes('@') && !address.includes('/')) return `mailto:${address}`;
  return undefined;
}

/**
 * Splits `text` into its runs of plain text and links, in order; joined, the runs' texts are `text` again. A scheme
 * with nothing after it (`https://`) stays text.
 */
export function splitLinkedText(text: string): BeMusicTextRun[] {
  const runs: BeMusicTextRun[] = [];
  let plainStart = 0;
  for (const match of text.matchAll(LINK_PATTERN)) {
    const start = match.index;
    const address = trimAddress(match[0]);
    const href = hrefOf(address);
    // A scheme alone, or a `www.` with no name after it.
    if (href === undefined || /^(?:h?ttps?:\/\/|www\.)$/iu.test(address)) continue;
    if (start > plainStart) runs.push({ kind: 'text', text: text.slice(plainStart, start) });
    runs.push({ kind: 'link', text: address, href });
    plainStart = start + address.length;
  }
  if (plainStart < text.length) runs.push({ kind: 'text', text: text.slice(plainStart) });
  return runs;
}
