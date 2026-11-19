import * as parser from '@be-music/chart-parser';
import * as parserCore from '@be-music/chart-parser/core';
import { expect, test } from 'vite-plus/test';

test('the core entry exposes the text and byte parsers without the Node file adapter', () => {
  const { parseChartFile, ...core } = parser;
  expect({ ...parserCore }).toEqual(core);
  expect(parseChartFile).toBeTypeOf('function');
});
