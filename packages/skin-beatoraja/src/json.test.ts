import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vite-plus/test';
import { parseBeatorajaSkinJSON, parseBeatorajaSkinJSONHeader, relaxBeatorajaJSON } from './json.ts';

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const readFixture = (name: string): string => readFileSync(resolve(fixtureDir, name), 'utf-8');

describe('relaxBeatorajaJSON — trailing commas', () => {
  it('drops trailing commas before ] and }', () => {
    expect(relaxBeatorajaJSON('[1,2,3,]')).toBe('[1,2,3]');
    expect(relaxBeatorajaJSON('{ "a": 1, "b": 2, }')).toBe('{ "a": 1, "b": 2 }');
  });

  it('preserves commas inside strings', () => {
    expect(relaxBeatorajaJSON('"a,b"')).toBe('"a,b"');
    expect(relaxBeatorajaJSON('"a,]"')).toBe('"a,]"');
  });

  it('handles escaped quotes within strings', () => {
    expect(relaxBeatorajaJSON('"a\\",]"')).toBe('"a\\",]"');
  });

  it('keeps formatting whitespace adjacent to closer', () => {
    expect(relaxBeatorajaJSON('[1,\n  2,\n]')).toBe('[1,\n  2\n]');
  });
});

describe('relaxBeatorajaJSON — doubled-open brace typo', () => {
  it('elides the leading `{` from a `{{...}}` literal (libgdx typo)', () => {
    // Note: only the OPEN is doubled in beatoraja's `play5.json` author typo. The matching close is
    // single — `}}` at the line end closes the value object + the enclosing entry object, not the
    // typo + value. Eliding only the leading open keeps the close braces correctly balanced.
    const before = '[{"if": [920], "value": {{"x":20, "y":140}}]';
    const after = relaxBeatorajaJSON(before);
    expect(JSON.parse(after)).toEqual([{ if: [920], value: { x: 20, y: 140 } }]);
  });

  it('reproduces the play5.json line-307 shape exactly', () => {
    const before = '[{"if": [920], "value": {{"x":20, "y":140, "w":300, "h":1, "r":64, "g":192, "b":192}}]';
    const after = relaxBeatorajaJSON(before);
    expect(JSON.parse(after)).toEqual([{ if: [920], value: { x: 20, y: 140, w: 300, h: 1, r: 64, g: 192, b: 192 } }]);
  });

  it('does not touch ordinary nested objects', () => {
    const before = '{"a": {"b": {"c": 1}}}';
    expect(relaxBeatorajaJSON(before)).toBe(before);
  });
});

describe('relaxBeatorajaJSON — missing commas', () => {
  it('inserts a comma between adjacent objects on separate lines', () => {
    expect(relaxBeatorajaJSON('[{"a":1}\n{"b":2}]')).toBe('[{"a":1},\n{"b":2}]');
  });

  it('inserts a comma between adjacent arrays', () => {
    expect(relaxBeatorajaJSON('[[1,2]\n[3,4]]')).toBe('[[1,2],\n[3,4]]');
  });

  it('handles the play24.json line-715 shape (`}]}\\n\\t{...}`)', () => {
    const before = '[{"id":15,"dst":[{"x":56,"h":6}\n]}\n\t{"id":"notes"}]';
    const after = relaxBeatorajaJSON(before);
    expect(JSON.parse(after)).toEqual([{ id: 15, dst: [{ x: 56, h: 6 }] }, { id: 'notes' }]);
  });

  it('does not insert a comma when the next non-whitespace character is itself a closer', () => {
    expect(relaxBeatorajaJSON('{"a":[1,2]}')).toBe('{"a":[1,2]}');
  });

  it('does not touch closers that end the document', () => {
    expect(relaxBeatorajaJSON('[1,2]\n  ')).toBe('[1,2]\n  ');
  });
});

describe('parseBeatorajaSkinJSON', () => {
  it('parses a minimal JSON skin tree', () => {
    const skin = parseBeatorajaSkinJSON(
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
    const skin = parseBeatorajaSkinJSON(text);
    expect(skin.property?.[0]?.item).toEqual([{ name: 'A', op: 1 }]);
  });

  it('parses the bundled beatoraja default play24.json (uses missing-comma + trailing-comma quirks)', () => {
    const skin = parseBeatorajaSkinJSON(readFixture('play24.json'));
    expect(skin.type).toBe(16);
    expect(skin.w).toBe(1280);
    expect(skin.h).toBe(720);
    expect(Array.isArray(skin.image)).toBe(true);
    expect(Array.isArray(skin.destination)).toBe(true);
  });

  it('parses the bundled beatoraja default play5.json (uses the `{{...}}` doubled-brace typo)', () => {
    const skin = parseBeatorajaSkinJSON(readFixture('play5.json'));
    expect(skin.type).toBe(1);
    expect(skin.w).toBe(1280);
    expect(skin.h).toBe(720);
    expect(Array.isArray(skin.destination)).toBe(true);
  });

  it('parses the bundled beatoraja default select.json', () => {
    const skin = parseBeatorajaSkinJSON(readFixture('select.json'));
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
    const header = parseBeatorajaSkinJSONHeader(text);
    expect(header.type).toBe(5);
    expect(header.name).toBe('demo');
    // `destination` etc. should not be on the header surface.
    expect((header as unknown as Record<string, unknown>).destination).toBeUndefined();
  });
});

describe('relaxBeatorajaJSON — run copying', () => {
  // The character-by-character relaxer the run-copying one replaced, kept as the reference.
  const reference = (source: string): string => {
    const peek = (from: number): number => {
      for (let i = from; i < source.length; i += 1) if (!' \t\n\r'.includes(source[i]!)) return i;
      return -1;
    };
    let result = '';
    let inString = false;
    let escape = false;
    for (let i = 0; i < source.length; i += 1) {
      const ch = source[i]!;
      if (inString) {
        result += ch;
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      const next = peek(i + 1);
      const after = next === -1 ? '' : source[next]!;
      if (ch === ',' && (after === ']' || after === '}')) continue;
      if (ch === '{' && after === '{') continue;
      result += ch;
      if ((ch === '}' || ch === ']') && /^[{["0-9+\-a-zA-Z]$/u.test(after)) result += ',';
    }
    return result;
  };

  it('matches the character-by-character relaxer', () => {
    const pieces = ['{', '}', '[', ']', ',', ' ', '\n', '"a', '\\"', '"', '1', '-2', 'true', ':', '{{', ',]', '}\n{'];
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    for (let round = 0; round < 2000; round += 1) {
      let text = '';
      const count = 1 + Math.floor(random() * 30);
      for (let index = 0; index < count; index += 1) text += pieces[Math.floor(random() * pieces.length)];
      expect(relaxBeatorajaJSON(text)).toBe(reference(text));
    }
  });

  it('returns well-formed JSON unchanged', () => {
    const text = '{"a": [1, 2, {"b": "c,]"}], "d": "\\"}"}';
    expect(relaxBeatorajaJSON(text)).toBe(text);
  });
});
