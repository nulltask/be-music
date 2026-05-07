import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBeatorajaSkinJson, parseBeatorajaSkinJsonHeader, relaxBeatorajaJson } from './beatoraja-skin-json.ts';

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const readFixture = (name: string): string => readFileSync(resolve(fixtureDir, name), 'utf-8');

describe('relaxBeatorajaJson — trailing commas', () => {
  it('drops trailing commas before ] and }', () => {
    expect(relaxBeatorajaJson('[1,2,3,]')).toBe('[1,2,3]');
    expect(relaxBeatorajaJson('{ "a": 1, "b": 2, }')).toBe('{ "a": 1, "b": 2 }');
  });

  it('preserves commas inside strings', () => {
    expect(relaxBeatorajaJson('"a,b"')).toBe('"a,b"');
    expect(relaxBeatorajaJson('"a,]"')).toBe('"a,]"');
  });

  it('handles escaped quotes within strings', () => {
    expect(relaxBeatorajaJson('"a\\",]"')).toBe('"a\\",]"');
  });

  it('keeps formatting whitespace adjacent to closer', () => {
    expect(relaxBeatorajaJson('[1,\n  2,\n]')).toBe('[1,\n  2\n]');
  });
});

describe('relaxBeatorajaJson — doubled-open brace typo', () => {
  it('elides the leading `{` from a `{{...}}` literal (libgdx typo)', () => {
    // Note: only the OPEN is doubled in beatoraja's `play5.json` author typo. The matching close is
    // single — `}}` at the line end closes the value object + the enclosing entry object, not the
    // typo + value. Eliding only the leading open keeps the close braces correctly balanced.
    const before = '[{"if": [920], "value": {{"x":20, "y":140}}]';
    const after = relaxBeatorajaJson(before);
    expect(JSON.parse(after)).toEqual([{ if: [920], value: { x: 20, y: 140 } }]);
  });

  it('reproduces the play5.json line-307 shape exactly', () => {
    const before = '[{"if": [920], "value": {{"x":20, "y":140, "w":300, "h":1, "r":64, "g":192, "b":192}}]';
    const after = relaxBeatorajaJson(before);
    expect(JSON.parse(after)).toEqual([
      { if: [920], value: { x: 20, y: 140, w: 300, h: 1, r: 64, g: 192, b: 192 } },
    ]);
  });

  it('does not touch ordinary nested objects', () => {
    const before = '{"a": {"b": {"c": 1}}}';
    expect(relaxBeatorajaJson(before)).toBe(before);
  });
});

describe('relaxBeatorajaJson — missing commas', () => {
  it('inserts a comma between adjacent objects on separate lines', () => {
    expect(relaxBeatorajaJson('[{"a":1}\n{"b":2}]')).toBe('[{"a":1},\n{"b":2}]');
  });

  it('inserts a comma between adjacent arrays', () => {
    expect(relaxBeatorajaJson('[[1,2]\n[3,4]]')).toBe('[[1,2],\n[3,4]]');
  });

  it('handles the play24.json line-715 shape (`}]}\\n\\t{...}`)', () => {
    const before = '[{"id":15,"dst":[{"x":56,"h":6}\n]}\n\t{"id":"notes"}]';
    const after = relaxBeatorajaJson(before);
    expect(JSON.parse(after)).toEqual([{ id: 15, dst: [{ x: 56, h: 6 }] }, { id: 'notes' }]);
  });

  it('does not insert a comma when the next non-whitespace character is itself a closer', () => {
    expect(relaxBeatorajaJson('{"a":[1,2]}')).toBe('{"a":[1,2]}');
  });

  it('does not touch closers that end the document', () => {
    expect(relaxBeatorajaJson('[1,2]\n  ')).toBe('[1,2]\n  ');
  });
});

describe('parseBeatorajaSkinJson', () => {
  it('parses a minimal JSON skin tree', () => {
    const skin = parseBeatorajaSkinJson(
      JSON.stringify({
        type: 5,
        name: 'demo',
        w: 1280,
        h: 720,
        source: [{ id: 0, path: 'system.png' }],
        image: [{ id: 0, src: 0, x: 0, y: 0, w: 8, h: 8 }],
      }),
    );
    expect(skin.type).toBe(5);
    expect(skin.name).toBe('demo');
    expect(Array.isArray(skin.source)).toBe(true);
    expect(Array.isArray(skin.image)).toBe(true);
  });

  it('survives trailing commas the reference theme actually uses', () => {
    const text = '{"type":1,"name":"x","w":1,"h":2,"property":[{"name":"P","item":[{"name":"A","op":1},]}]}';
    const skin = parseBeatorajaSkinJson(text);
    expect(skin.property?.[0]?.item).toEqual([{ name: 'A', op: 1 }]);
  });

  it('parses the bundled beatoraja default play24.json (uses missing-comma + trailing-comma quirks)', () => {
    const skin = parseBeatorajaSkinJson(readFixture('play24.json'));
    expect(skin.type).toBe(16);
    expect(skin.w).toBe(1280);
    expect(skin.h).toBe(720);
    expect(Array.isArray(skin.image)).toBe(true);
    expect(Array.isArray(skin.destination)).toBe(true);
  });

  it('parses the bundled beatoraja default play5.json (uses the `{{...}}` doubled-brace typo)', () => {
    const skin = parseBeatorajaSkinJson(readFixture('play5.json'));
    expect(skin.type).toBe(1);
    expect(skin.w).toBe(1280);
    expect(skin.h).toBe(720);
    expect(Array.isArray(skin.destination)).toBe(true);
  });

  it('parses the bundled beatoraja default select.json', () => {
    const skin = parseBeatorajaSkinJson(readFixture('select.json'));
    expect(skin.type).toBe(5);
  });

  it('exposes header fields without bringing along element arrays', () => {
    const text = JSON.stringify({
      type: 5,
      name: 'demo',
      w: 1280,
      h: 720,
      source: [{ id: 0, path: 'a.png' }],
      destination: [{ id: 1, dst: [{ time: 0, x: 0, y: 0 }] }],
    });
    const header = parseBeatorajaSkinJsonHeader(text);
    expect(header.type).toBe(5);
    expect(header.name).toBe('demo');
    // `destination` etc. should not be on the header surface.
    expect((header as unknown as Record<string, unknown>).destination).toBeUndefined();
  });
});
