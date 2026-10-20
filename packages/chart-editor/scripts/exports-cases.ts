import * as editorAPI from '@be-music/chart-editor';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

export function registerEditorExportsCases(define: DefineBenchmarkCase): void {
  define('chart-editor.importChart', {
    ioBound: true,
    run: async (fixtures) => {
      await editorAPI.importChart(fixtures.paths.bmsPath);
    },
  });
  define('chart-editor.loadJSONFile', {
    ioBound: true,
    run: async (fixtures) => {
      await editorAPI.loadJSONFile(fixtures.paths.jsonPath);
    },
  });
  define('chart-editor.saveJSONFile', {
    ioBound: true,
    run: async (fixtures) => {
      await editorAPI.saveJSONFile(fixtures.paths.editorSavePath, fixtures.sampleBmsJSON);
    },
  });
  define('chart-editor.exportChart', {
    ioBound: true,
    run: async (fixtures) => {
      await editorAPI.exportChart(fixtures.paths.editorExportBMSPath, fixtures.sampleBmsJSON);
    },
  });
  define('chart-editor.setMetadata', {
    run: (fixtures) => {
      editorAPI.setMetadata(fixtures.sampleBmsJSON, 'title', 'Updated by benchmark');
    },
  });
  define('chart-editor.addNote', {
    run: (fixtures) => {
      editorAPI.addNote(fixtures.sampleBmsJSON, {
        measure: 3,
        channel: '11',
        positionNumerator: 1,
        positionDenominator: 4,
        value: '01',
      });
    },
  });
  define('chart-editor.deleteNote', {
    run: (fixtures) => {
      editorAPI.deleteNote(fixtures.sampleBmsJSON, {
        measure: 1,
        channel: '11',
        positionNumerator: 0,
        positionDenominator: 2,
      });
    },
  });
  define('chart-editor.listNotes', {
    run: (fixtures) => {
      editorAPI.listNotes(fixtures.sampleBmsJSON, 1);
    },
  });
  define('chart-editor.createBlankJSON', {
    run: () => {
      editorAPI.createBlankJSON();
    },
  });
}
