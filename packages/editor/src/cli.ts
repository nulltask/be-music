import { resolveCLIPath } from '@be-music/utils/cli-path';
import {
  addNote,
  createBlankJSON,
  deleteNote,
  exportChart,
  importChart,
  listNotes,
  loadJSONFile,
  saveJSONFile,
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
      const outputPath = resolveCLIPath(output);
      await saveJSONFile(outputPath, createBlankJSON());
      process.stdout.write(`Created JSON: ${outputPath}\n`);
      return;
    }

    case 'import': {
      const [inputChart, outputJSON] = args;
      if (!inputChart || !outputJSON) {
        return printUsage(1);
      }
      const inputChartPath = resolveCLIPath(inputChart);
      const outputJSONPath = resolveCLIPath(outputJSON);
      const json = await importChart(inputChartPath);
      await saveJSONFile(outputJSONPath, json);
      process.stdout.write(`Imported chart to JSON: ${outputJSONPath}\n`);
      return;
    }

    case 'export': {
      const [inputJSON, outputChart] = args;
      if (!inputJSON || !outputChart) {
        return printUsage(1);
      }
      const inputJSONPath = resolveCLIPath(inputJSON);
      const outputChartPath = resolveCLIPath(outputChart);
      const json = await loadJSONFile(inputJSONPath);
      await exportChart(outputChartPath, json);
      process.stdout.write(`Exported chart: ${outputChartPath}\n`);
      return;
    }

    case 'set-meta': {
      const [inputJSON, key, ...valueTokens] = args;
      if (!inputJSON || !key || valueTokens.length === 0) {
        return printUsage(1);
      }
      const value = valueTokens.join(' ');
      const inputJSONPath = resolveCLIPath(inputJSON);
      const json = await loadJSONFile(inputJSONPath);
      const next = setMetadata(json, key, value);
      await saveJSONFile(inputJSONPath, next);
      process.stdout.write(`Updated metadata ${key}\n`);
      return;
    }

    case 'add-note': {
      const [inputJSON, measureText, channel, numeratorText, denominatorText, value] = args;
      if (!inputJSON || !measureText || !channel || !numeratorText || !denominatorText || !value) {
        return printUsage(1);
      }
      const inputJSONPath = resolveCLIPath(inputJSON);
      const json = await loadJSONFile(inputJSONPath);
      const next = addNote(json, {
        measure: Number.parseInt(measureText, 10),
        channel,
        positionNumerator: Number.parseInt(numeratorText, 10),
        positionDenominator: Number.parseInt(denominatorText, 10),
        value,
      });
      await saveJSONFile(inputJSONPath, next);
      process.stdout.write(
        `Added note m${measureText} ch${channel} pos${numeratorText}/${denominatorText} val${value}\n`,
      );
      return;
    }

    case 'delete-note': {
      const [inputJSON, measureText, channel, numeratorText, denominatorText, value] = args;
      if (!inputJSON || !measureText || !channel || !numeratorText || !denominatorText) {
        return printUsage(1);
      }
      const inputJSONPath = resolveCLIPath(inputJSON);
      const json = await loadJSONFile(inputJSONPath);
      const next = deleteNote(json, {
        measure: Number.parseInt(measureText, 10),
        channel,
        positionNumerator: Number.parseInt(numeratorText, 10),
        positionDenominator: Number.parseInt(denominatorText, 10),
        value,
      });
      await saveJSONFile(inputJSONPath, next);
      process.stdout.write(`Deleted note(s) at m${measureText} ch${channel} pos${numeratorText}/${denominatorText}\n`);
      return;
    }

    case 'list-notes': {
      const [inputJSON, measureText] = args;
      if (!inputJSON) {
        return printUsage(1);
      }
      const inputJSONPath = resolveCLIPath(inputJSON);
      const json = await loadJSONFile(inputJSONPath);
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
