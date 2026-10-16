[Japanese version](./README.ja.md)

# @be-music/scene-model

What every screen of the be-music player shows and how it behaves, whatever skin family draws it. The built-in, LR2
and beatoraja families share these models and only draw them (see
[ADR 0001](../../docs/adr/0001-skin-families-only-draw.md) and [ADR 0002](../../docs/adr/0002-scene-model-package.md));
the terminal player and the skin packages can use them too.

The package is runtime-neutral: no renderer, no DOM, no Node. Time and randomness come in as inputs, so every model
runs the same in the browser, in Node and in tests. It builds on `@be-music/chart`, `@be-music/json` and
`@be-music/player` only.

The models and the rules behind them are described in [Scene models](../../docs/scene-model.md).

## What it holds

- **Library**: the charts, folders and courses a select screen lists (`LibraryChart`, `LibraryFolder`,
  `LibraryCourse`, `LibraryEntry`), their root folders (`groupChartsByFolder`, `libraryRootFolders`), a chart's play
  variant and key mode, and the key that names a bar across rebuilds (`libraryEntryKey`).
- **Browse**: the select screen's folder stack, cursor, search, sort, filters and favourites as one immutable state
  (`BrowseState`), changed by commands (`reduceBrowse`) that report what happened for the screen's sounds and
  animations; the list derived from it (`browseEntries`); and its snapshot (`captureBrowse` / `restoreBrowse`), with
  adapters from the snapshots today's select scenes keep.
- **Play options**: what the player picks before a play (`PlayOptions`), its defaults, each option's choices,
  validation of values set from untyped input (`resolvePlayOptionValue`, `resolvePlayOptions`), cycling
  (`cyclePlayOptionValue`), and the hi-speed range (`snapHiSpeed`, `stepPlayerHiSpeed`, `HiSpeedTransition`).

## Example

```ts
import { browseEntries, captureBrowse, createBrowseState, reduceBrowse, restoreBrowse } from '@be-music/scene-model';

let state = createBrowseState();
const step = reduceBrowse(library, state, { type: 'move', delta: 1 });
state = step.state; // step.event: { kind: 'cursor', from: 0, to: 1, delta: 1 }
state = reduceBrowse(library, state, { type: 'open' }).state;
const bars = browseEntries(library, state);

// Across a play: keep the snapshot, then take it back over the library as it is then.
const snapshot = captureBrowse(library, state);
state = restoreBrowse(library, snapshot).state;
```
