import { describe, expect, test } from 'vite-plus/test';
import { decodeLRXText, readLRXElements } from './lrx-xml.ts';

function utf16(text: string, littleEndian = true, bom = true): Uint8Array {
  const bytes = new Uint8Array((bom ? 2 : 0) + text.length * 2);
  const view = new DataView(bytes.buffer);
  if (bom) view.setUint16(0, 0xfeff, littleEndian);
  for (let index = 0; index < text.length; index++)
    view.setUint16((bom ? 2 : 0) + index * 2, text.charCodeAt(index), littleEndian);
  return bytes;
}

describe('decodeLRXText', () => {
  test('reads UTF-16 with either byte order mark, BOM-less UTF-16, and UTF-8', () => {
    expect(decodeLRXText(utf16('<LRS>曲</LRS>'))).toBe('<LRS>曲</LRS>');
    expect(decodeLRXText(utf16('<LRS/>', false))).toBe('<LRS/>');
    expect(decodeLRXText(utf16('<LRS/>', true, false))).toBe('<LRS/>');
    expect(decodeLRXText(new TextEncoder().encode('<LRS title="曲"/>'))).toBe('<LRS title="曲"/>');
  });
});

describe('readLRXElements', () => {
  test('lists start and empty tags with their attributes, flat and in order', () => {
    const elements = readLRXElements(
      '<?xml version="1.0"?>\r\n<!-- note --><LRS>\r\n\t<information rank="2" total=\'128\' />\r\n\t<n c="1" s="0"/></LRS>',
    );
    expect(elements.map((element) => element.name)).toEqual(['LRS', 'information', 'n']);
    expect(Object.fromEntries(elements[1]!.attributes)).toEqual({ rank: '2', total: '128' });
    expect(Object.fromEntries(elements[2]!.attributes)).toEqual({ c: '1', s: '0' });
  });

  test('decodes entities and keeps a ">" inside a quoted value', () => {
    const [element] = readLRXElements('<information title="A &amp; B &#x3042;&#12354; &lt;&gt;" genre="a>b"/>');
    expect(element!.attributes.get('title')).toBe('A & B ああ <>');
    expect(element!.attributes.get('genre')).toBe('a>b');
  });

  test('skips comments, CDATA, declarations and closing tags', () => {
    const names = readLRXElements('<!DOCTYPE x><a><![CDATA[<b/>]]><!-- <c/> --></a><d/>').map(
      (element) => element.name,
    );
    expect(names).toEqual(['a', 'd']);
  });
});
