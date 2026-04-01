import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createEmptyJson } from '../packages/json/src/index.ts';

function createDemoJson() {
  const json = createEmptyJson('json');
  json.metadata.title = 'Demo Chart';
  json.metadata.artist = 'unknown';
  json.resources.wav['01'] = 'kick.wav';
  json.events = [
    { measure: 0, channel: '11', position: [0, 1], value: '01' },
    { measure: 0, channel: '11', position: [1, 2], value: '01' },
    { measure: 1, channel: '11', position: [0, 1], value: '01' },
    { measure: 1, channel: '11', position: [1, 2], value: '01' },
  ];
  return json;
}

async function main(): Promise<void> {
  const outputPathArg = process.argv[2];
  const content = `${JSON.stringify(createDemoJson(), null, 2)}\n`;
  if (!outputPathArg) {
    process.stdout.write(content);
    return;
  }
  const outputPath = resolve(outputPathArg);
  await writeFile(outputPath, content, 'utf8');
  process.stdout.write(`${outputPath}\n`);
}

void main();
