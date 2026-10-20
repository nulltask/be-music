export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('shift_jis').decode(bytes).replace(/^\ufeff/u, '');
}

export function parseRows(text: string): string[][] {
  return text
    .split(/\r?\n/u)
    .map((line) => parseRow(stripComment(line).trim()))
    .filter((row) => row.length > 0 && row[0]?.startsWith('#'));
}

export function parseRow(line: string): string[] {
  if (!line) {
    return [];
  }
  const delimiter = line.includes('\t') ? '\t' : ',';
  return line.split(delimiter).map((value) => value.trim().replace(/^["']|["']$/gu, ''));
}

export function stripComment(line: string): string {
  const index = line.indexOf('//');
  return index >= 0 ? line.slice(0, index) : line;
}
