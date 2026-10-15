/**
 * Decodes a course file's bytes. A byte-order mark wins, then an XML `encoding` declaration, then strict UTF-8, and
 * Shift_JIS last: LR2's tools wrote `.lr2crs` files in the system code page.
 */
export function decodeCourseText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  const declared = /<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/iu.exec(head)?.[1]?.toLowerCase();
  if (declared !== undefined) {
    try {
      return new TextDecoder(declared).decode(bytes);
    } catch {
      // An encoding the runtime does not know: fall through to detection.
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('shift_jis').decode(bytes);
  }
}

/** A parsed XML element: its name, its child elements and its own text (entities decoded, CDATA kept verbatim). */
export interface CourseXmlElement {
  name: string;
  children: CourseXmlElement[];
  text: string;
}

const ENTITIES: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/giu, (match, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity] ?? match;
  });
}

/**
 * A small, tolerant XML reader for course files: elements, text, entities, CDATA, comments and processing
 * instructions. Attributes are skipped (no course format uses them). Returns the root element, or `undefined` when
 * the text holds none. Unclosed elements are closed at the end of the text.
 */
export function parseCourseXml(text: string): CourseXmlElement | undefined {
  const root: CourseXmlElement = { name: '', children: [], text: '' };
  const stack: CourseXmlElement[] = [root];
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf('<', index);
    const top = stack[stack.length - 1]!;
    if (open < 0) {
      top.text += decodeEntities(text.slice(index));
      break;
    }
    top.text += decodeEntities(text.slice(index, open));
    if (text.startsWith('<!--', open)) {
      const end = text.indexOf('-->', open + 4);
      index = end < 0 ? text.length : end + 3;
    } else if (text.startsWith('<![CDATA[', open)) {
      const end = text.indexOf(']]>', open + 9);
      top.text += text.slice(open + 9, end < 0 ? text.length : end);
      index = end < 0 ? text.length : end + 3;
    } else if (text[open + 1] === '?' || text[open + 1] === '!') {
      const end = text.indexOf('>', open);
      index = end < 0 ? text.length : end + 1;
    } else {
      const end = text.indexOf('>', open);
      if (end < 0) break;
      const tag = text.slice(open + 1, end).trim();
      index = end + 1;
      if (tag.startsWith('/')) {
        const name = tag.slice(1).trim();
        // Close up to the matching element; a stray close tag is ignored.
        let at = stack.length - 1;
        while (at > 0 && stack[at]!.name !== name) at -= 1;
        if (at > 0) stack.length = at;
        continue;
      }
      const selfClosing = tag.endsWith('/');
      const name = /^[^\s/]+/u.exec(tag)?.[0] ?? '';
      const element: CourseXmlElement = { name, children: [], text: '' };
      top.children.push(element);
      if (!selfClosing) stack.push(element);
    }
  }
  return root.children[0];
}
