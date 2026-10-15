[日本語版](./course-checklist.ja.md)

# Course browser checklist

A by-hand check of the course features in the web demo, on each skin family, for what unit tests cannot reach: the scenes, the screen transitions and the audio. Run it after a change to the course flow or the scenes it goes through, and record the result at the end of this page. The rules themselves are in [course.md](./course.md); the scenes are in [player-web.md](./player-web.md).

## Setup

1. **Fixtures.** `node scripts/course-checklist/fixtures.ts <dir>` writes a small BMS library to `<dir>/songs` (Fixture A–G, a dense Fixture D that empties the gauge of a no-input run, and a 5-key chart) with `songs/courses/fixture-courses.lr2crs` (FIX GRADE, FIX EXPERT, FIX NONSTOP, FIX GRADE FAIL), and `<dir>/seven-stages.lr2crs` for the five-stage warning.
2. **Skins.** The built-in family needs nothing. For LR2 use the stock LR2 theme and its sound set (`LR2files/Theme/LR2` and `LR2files/Sound`); for beatoraja any skin (the last run used ModernChic). Dropping a theme applies it; the Debug Menu's Skin system switches between the families.
3. **Dev server.** Run the demo on a port of its own (`pnpm --filter @be-music/player-web-demo run dev --port 5199 --strictPort`), so a session already playing on the default port is left alone.
4. **Dropping files.** A person can drag the folders onto the page. Browser automation cannot, so serve them with `node scripts/course-checklist/serve.ts fixtures=<dir>/songs extra=<dir> lr2theme=<LR2files parent> beatoraja=<skin dir>` (port 5299) and dispatch a synthetic drop from the page console:

   ```js
   window.fakeDrop = async (root, prefix = '', keep = () => true) => {
     const list = (await (await fetch(`http://127.0.0.1:5299/__list?root=${root}`)).json()).filter(keep);
     const files = await Promise.all(
       list.map(async (rel) => {
         const url = `http://127.0.0.1:5299/__file?root=${root}&path=${encodeURIComponent(rel)}`;
         const path = prefix ? `${prefix}/${rel}` : rel;
         const file = new File([await (await fetch(url)).arrayBuffer()], path.split('/').pop());
         Object.defineProperty(file, 'webkitRelativePath', { value: path });
         return file;
       }),
     );
     const event = new Event('drop', { cancelable: true });
     Object.defineProperty(event, 'dataTransfer', { value: { items: [], files, types: ['Files'] } });
     window.dispatchEvent(event);
     return files.length;
   };
   // await fakeDrop('fixtures', 'fixtures'); await fakeDrop('lr2theme');
   // await fakeDrop('extra', '', (path) => path === 'seven-stages.lr2crs');
   ```

5. **Keys.** The browser pane's key action does not reach the lanes; dispatch `KeyboardEvent`s with a `code` (e.g. `Escape`, `Enter`) on `window`. A no-input manual run is enough for the failing cases; AUTO covers the rest.

## Checklist

Run each item on the built-in, LR2 and beatoraja families.

| #   | Item                               | What to see                                                                                                                                                                                                                                                                            |
| --- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Course folders and bars            | MY COURSES / MY NONSTOP / MY DAN and the dropped `.lr2crs` folder list the courses; a course bar shows its stages, and its best lamp and trophy after a run. A course with a missing stage says so when started.                                                                       |
| 2   | GRADE course (AUTO and manual)     | Stages advance on the course gauge, which carries over; an AUTO run skips the stage results before the last, as LR2 does; the course result shows with the course jingle. An LR2 grade turns the lane option off and EASY into GROOVE, and the player's settings come back afterwards. |
| 3   | EXPERT course                      | The same flow on the expert gauge.                                                                                                                                                                                                                                                     |
| 4   | NONSTOP course, both placements    | One stitched chart; the normal result with the clear / fail jingle; R stitches and plays it again; the tempo and keep-pitch options are locked during the play. beatoraja falls back to the built-in scene.                                                                            |
| 5   | Gauge emptied mid-stage            | Sound and picture fade out, then the result shows.                                                                                                                                                                                                                                     |
| 6   | ESC during a course stage          | The course ends as a failed run on its course result, on the first stage too, and the stage given up counts its judgments (FIX GRADE FAIL, no input, ESC after a few POORs; and AUTO, ESC in stage 2).                                                                                 |
| 7   | Clicking the canvas during a stage | The stage does not start over.                                                                                                                                                                                                                                                         |
| 8   | Back to the select screen          | The cursor is on the course bar after GRADE, EXPERT and NONSTOP runs.                                                                                                                                                                                                                  |
| 9   | Course maker                       | NONSTOP / EXPERT / GRADE, the five-song cap, the same-key-mode rule, the constraint editor, rename, delete, `.lr2crs` and beatoraja `.json` export; Save and Cancel say what they did.                                                                                                 |
| 10  | Five-stage warning                 | Dropping `seven-stages.lr2crs` says the course is read as its first five stages.                                                                                                                                                                                                       |
| 11  | Console                            | No errors from the course flow (a Leaderboard API that is not running locally answers 502; that is expected).                                                                                                                                                                          |

Known and not be-music's: the stock LR2 course-result skin (`courseresult_normal.csv`) draws its POOR row from number 113 (BAD), so POOR reads 0 there.

## Runs

| Date       | Commit     | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-16 | `e1bdc6bb` | Items 1-5, 7, 9-11 passed. Failed and since fixed: ESC on the first stage of a manual run returned to the select screen with no result and no record, and the stage given up lost its judgments (built-in and LR2: the scene did not interrupt the engine); the LR2 course result played `clear` / `fail` instead of `course_clear` / `course_fail`; the cursor did not come back to the course bar after a NONSTOP run (built-in and LR2) or after any course (beatoraja). |
