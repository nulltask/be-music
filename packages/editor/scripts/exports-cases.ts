import * as editorApi from '@be-music/editor';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

export function registerEditorExportsCases(define: DefineBenchmarkCase): void {
  define('editor.importChart', {
    run: async (fixtures) => {
      await editorApi.importChart(fixtures.paths.bmsPath);
    },
  });
  define('editor.loadJsonFile', {
    run: async (fixtures) => {
      await editorApi.loadJsonFile(fixtures.paths.jsonPath);
    },
  });
  define('editor.saveJsonFile', {
    run: async (fixtures) => {
      await editorApi.saveJsonFile(fixtures.paths.editorSavePath, fixtures.sampleBmsJson);
    },
  });
  define('editor.exportChart', {
    run: async (fixtures) => {
      await editorApi.exportChart(fixtures.paths.editorExportBmsPath, fixtures.sampleBmsJson);
    },
  });
  define('editor.setMetadata', {
    run: (fixtures) => {
      editorApi.setMetadata(fixtures.sampleBmsJson, 'title', 'Updated by benchmark');
    },
  });
  define('editor.addNote', {
    run: (fixtures) => {
      editorApi.addNote(fixtures.sampleBmsJson, {
        measure: 3,
        channel: '11',
        positionNumerator: 1,
        positionDenominator: 4,
        value: '01',
      });
    },
  });
  define('editor.deleteNote', {
    run: (fixtures) => {
      editorApi.deleteNote(fixtures.sampleBmsJson, {
        measure: 1,
        channel: '11',
        positionNumerator: 0,
        positionDenominator: 2,
      });
    },
  });
  define('editor.listNotes', {
    run: (fixtures) => {
      editorApi.listNotes(fixtures.sampleBmsJson, 1);
    },
  });
  define('editor.createBlankJson', {
    run: () => {
      editorApi.createBlankJson();
    },
  });
}
