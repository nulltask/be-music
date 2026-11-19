/**
 * The little XML LRX needs. plugout reads its files with irrXML and dispatches on element names only, so a flat list of
 * elements with their attributes is all the chart reader uses: nesting, text, comments, processing instructions and
 * DOCTYPEs are skipped.
 */

export interface LRXElement {
  name: string;
  attributes: Map<string, string>;
}

let utf8Decoder: TextDecoder | undefined;
let utf16LEDecoder: TextDecoder | undefined;
let utf16BEDecoder: TextDecoder | undefined;

/**
 * Decodes an LRX file. plugout writes UTF-16LE with a byte-order mark; irrXML also takes UTF-16BE, and Be-Music reads
 * a file without a mark as UTF-8 (irrXML would widen it byte by byte, which agrees on ASCII).
 */
export function decodeLRXText(bytes: Uint8Array): string {
  const littleEndianBOM = bytes[0] === 0xff && bytes[1] === 0xfe;
  const bigEndianBOM = bytes[0] === 0xfe && bytes[1] === 0xff;
  // A BOM-less UTF-16 file still starts with `<` and a zero byte.
  if (littleEndianBOM || (bytes[0] === 0x3c && bytes[1] === 0x00)) {
    return (utf16LEDecoder ??= new TextDecoder('utf-16le')).decode(littleEndianBOM ? bytes.subarray(2) : bytes);
  }
  if (bigEndianBOM || (bytes[0] === 0x00 && bytes[1] === 0x3c)) {
    return (utf16BEDecoder ??= new TextDecoder('utf-16be')).decode(bigEndianBOM ? bytes.subarray(2) : bytes);
  }
  return (utf8Decoder ??= new TextDecoder()).decode(bytes);
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

/** Start and empty-element tags in document order, optionally restricted to one name. */
export function readLRXElements(text: string, onlyName?: string): LRXElement[] {
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
    if (onlyName !== undefined && !text.startsWith(onlyName, open + 1)) continue;
    const body = text.slice(open + 1, close);
    const name = NAME.exec(body)?.[0];
    if (!name || (onlyName !== undefined && name !== onlyName)) continue;
    const attributes = new Map<string, string>();
    ATTRIBUTE.lastIndex = name.length;
    for (let match = ATTRIBUTE.exec(body); match !== null; match = ATTRIBUTE.exec(body)) {
      attributes.set(match[1]!, decodeEntities(match[2] ?? match[3] ?? ''));
    }
    elements.push({ name, attributes });
  }
  return elements;
}

/** The `>` closing the tag that starts at `from`, skipping `>` inside quoted attribute values. */
function findTagEnd(text: string, from: number): number {
  let quote = 0;
  for (let index = from; index < text.length; index++) {
    const character = text.charCodeAt(index);
    if (quote !== 0) {
      if (character === quote) quote = 0;
    } else if (character === 0x22 || character === 0x27) {
      quote = character;
    } else if (character === 0x3e) {
      return index;
    }
  }
  return -1;
}
