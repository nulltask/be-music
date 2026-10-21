import * as ui from '@be-music/player-ui';
import * as react from '@be-music/player-ui-react';
import * as vue from '@be-music/player-ui-vue';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

// Registration is normally repeated by wrappers. Measure the idempotent path without allocating a browser.
const definitions = new Map<string, CustomElementConstructor>();
const registry = {
  get: (name: string) => definitions.get(name),
  define: (name: string, constructor: CustomElementConstructor) => definitions.set(name, constructor),
} as unknown as CustomElementRegistry;
export const playerUIBenchmarkPackage: BenchmarkPackageDefinition = {
  module: ui,
  registerCases(define) {
    define('player-ui.defineBeMusicElements', { run: () => ui.defineBeMusicElements(registry) });
    for (const [name, value] of Object.entries(ui)) {
      if (name === 'defineBeMusicElements' || typeof value !== 'function') continue;
      define(`player-ui.${name}`, {
        interactive: true,
        run: () => {
          ui.defineBeMusicElements();
          const element = new (value as CustomElementConstructor)();
          document.body.append(element);
          element.remove();
        },
      });
    }
  },
};
// React forwardRef components and Vue definitions are objects; the function-export inventory has no callable cases.
export const playerUIReactBenchmarkPackage: BenchmarkPackageDefinition = { module: react, registerCases: () => {} };
export const playerUIVueBenchmarkPackage: BenchmarkPackageDefinition = { module: vue, registerCases: () => {} };
