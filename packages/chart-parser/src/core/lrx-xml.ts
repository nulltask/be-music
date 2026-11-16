/**
 * The little XML LRX needs. plugout reads its files with irrXML and dispatches on element names only, so a flat list of
 * elements with their attributes is all the chart reader uses: nesting, text, comments, processing instructions and
 * DOCTYPEs are skipped.
 */

export interface LRXElement {
  name: string;
  attributes: Map<string, string>;
}

/**
 * Decodes an LRX file. plugout writes UTF-16LE with a byte-order mark; irrXML also takes UTF-16BE, and Be-Music reads
 * a file without a mark as UTF-8 (irrXML would widen it byte by byte, which agrees on ASCII).
 */
export function decodeLRXText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  // A BOM-less UTF-16 file still starts with `<` and a zero byte.
  if (bytes[0] === 0x3c && bytes[1] === 0x00) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0x00 && bytes[1] === 0x3c) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes);
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[entity] ?? whole;
  });
}

const ATTRIBUTE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const NAME = /^[^\s/>]+/;

/** Every start or empty-element tag of `text`, in document order. */
export function readLRXElements(text: string): LRXElement[] {
  const elements: LRXElement[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf('<', cursor);
    if (open < 0) break;
    if (text.startsWith('<!--', open)) {
      const end = text.indexOf('-->', open + 4);
      cursor = end < 0 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', open)) {
      const end = text.indexOf(']]>', open + 9);
      cursor = end < 0 ? text.length : end + 3;
      continue;
    }
    const close = findTagEnd(text, open + 1);
    if (close < 0) break;
    cursor = close + 1;
    const first = text[open + 1];
    if (first === '?' || first === '!' || first === '/') continue;
    const body = text.slice(open + 1, close);
    const name = NAME.exec(body)?.[0];
    if (!name) continue;
    const attributes = new Map<string, string>();
    for (const match of body.slice(name.length).matchAll(ATTRIBUTE)) {
      attributes.set(match[1]!, decodeEntities(match[2] ?? match[3] ?? ''));
    }
    elements.push({ name, attributes });
  }
  return elements;
}

/** The `>` closing the tag that starts at `from`, skipping `>` inside quoted attribute values. */
function findTagEnd(text: string, from: number): number {
  let quote: string | undefined;
  for (let index = from; index < text.length; index++) {
    const character = text[index]!;
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return -1;
}
