#!/usr/bin/env node
import { resolveCliPath } from '@be-music/utils';
import {
  addNote,
  createBlankJson,
  deleteNote,
  exportChart,
  importChart,
  listNotes,
  loadJsonFile,
  saveJsonFile,
  setMetadata,
} from './index.ts';

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'init': {
      const [output] = args;
      if (!output) {
        return printUsage(1);
      }
      const outputPath = resolveCliPath(output);
      await saveJsonFile(outputPath, createBlankJson());
      process.stdout.write(`Created JSON: ${outputPath}\n`);
      return;
    }

    case 'import': {
      const [inputChart, outputJson] = args;
      if (!inputChart || !outputJson) {
        return printUsage(1);
      }
      const inputChartPath = resolveCliPath(inputChart);
      const outputJsonPath = resolveCliPath(outputJson);
      const json = await importChart(inputChartPath);
      await saveJsonFile(outputJsonPath, json);
      process.stdout.write(`Imported chart to JSON: ${outputJsonPath}\n`);
      return;
    }

    case 'export': {
      const [inputJson, outputChart] = args;
      if (!inputJson || !outputChart) {
        return printUsage(1);
      }
      const inputJsonPath = resolveCliPath(inputJson);
      const outputChartPath = resolveCliPath(outputChart);
      const json = await loadJsonFile(inputJsonPath);
      await exportChart(outputChartPath, json);
      process.stdout.write(`Exported chart: ${outputChartPath}\n`);
      return;
    }

    case 'set-meta': {
      const [inputJson, key, ...valueTokens] = args;
      if (!inputJson || !key || valueTokens.length === 0) {
        return printUsage(1);
      }
      const value = valueTokens.join(' ');
      const inputJsonPath = resolveCliPath(inputJson);
      const json = await loadJsonFile(inputJsonPath);
      const next = setMetadata(json, key, value);
      await saveJsonFile(inputJsonPath, next);
      process.stdout.write(`Updated metadata ${key}\n`);
      return;
    }

    case 'add-note': {
      const [inputJson, measureText, channel, numeratorText, denominatorText, value] = args;
      if (!inputJson || !measureText || !channel || !numeratorText || !denominatorText || !value) {
        return printUsage(1);
      }
      const inputJsonPath = resolveCliPath(inputJson);
      const json = await loadJsonFile(inputJsonPath);
      const next = addNote(json, {
        measure: Number.parseInt(measureText, 10),
        channel,
        positionNumerator: Number.parseInt(numeratorText, 10),
        positionDenominator: Number.parseInt(denominatorText, 10),
        value,
      });
      await saveJsonFile(inputJsonPath, next);
      process.stdout.write(
        `Added note m${measureText} ch${channel} pos${numeratorText}/${denominatorText} val${value}\n`,
      );
      return;
    }

    case 'delete-note': {
      const [inputJson, measureText, channel, numeratorText, denominatorText, value] = args;
      if (!inputJson || !measureText || !channel || !numeratorText || !denominatorText) {
        return printUsage(1);
      }
      const inputJsonPath = resolveCliPath(inputJson);
      const json = await loadJsonFile(inputJsonPath);
      const next = deleteNote(json, {
        measure: Number.parseInt(measureText, 10),
        channel,
        positionNumerator: Number.parseInt(numeratorText, 10),
        positionDenominator: Number.parseInt(denominatorText, 10),
        value,
      });
      await saveJsonFile(inputJsonPath, next);
      process.stdout.write(`Deleted note(s) at m${measureText} ch${channel} pos${numeratorText}/${denominatorText}\n`);
      return;
    }

    case 'list-notes': {
      const [inputJson, measureText] = args;
      if (!inputJson) {
        return printUsage(1);
      }
      const inputJsonPath = resolveCliPath(inputJson);
      const json = await loadJsonFile(inputJsonPath);
      const measure = measureText ? Number.parseInt(measureText, 10) : undefined;
      const notes = listNotes(json, measure);
      process.stdout.write(`${JSON.stringify(notes, null, 2)}\n`);
      return;
    }

    default:
      printUsage(0);
  }
}

function printUsage(exitCode: number): void {
  process.stdout.write(
    [
      'Usage: bms-editor <command> [args]',
      '',
      'Essential commands:',
      '  init <output.json>',
      '  import <input.(bms|bmson)> <output.json>',
      '  export <input.json> <output.(bms|bmson)>',
      '  list-notes <input.json> [measure]',
      '',
      'Advanced edit commands:',
      '  set-meta <input.json> <key> <value...>',
      '  add-note <input.json> <measure> <channel> <positionNumerator> <positionDenominator> <value>',
      '  delete-note <input.json> <measure> <channel> <positionNumerator> <positionDenominator> [value]',
    ].join('\n') + '\n',
  );
  process.exitCode = exitCode;
}

void main();
