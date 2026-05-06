[Japanese version](./glossary.ja.md)

# Glossary

This document summarizes the terms used in the `be-music` specification and implementation.
The definitions here are based on general BMS/BMSON terminology, but prioritize **how to handle it in this repository**.

## Terms usage rules

- **chart** is the default word that refers to the musical score file and unit of playback, selection, and storage.
- **music/song/song** is a word used in screen names and user-facing descriptions, and is generally distinguished from `chart` when referring to a unit of internal processing.
- **song** is not the default word for this repository, and should only be used when referring to an external specification name or file name (e.g. `song.mid`, `bemuse-song.json`, `songs[]`).
- **Music Select** is the screen name. The unit actually selected and restored on this screen is chart.

## General terms

### Music sheets and resources

- **BMS**: Be-Music Source text score format. It consists of header/object lines like `#TITLE`, `#WAVxx`, and `#mmmcc:...`.
- **bmson**: JSON-based music score format. It has structures such as `info`, `sound_channels`, `bga`, and `lines`.
- **Chart**: One score file or its playback unit. On the song selection screen, 1 entry corresponds to 1 chart.
- **Song/Music**: A unit of work recognized by humans, such as `TITLE` / `ARTIST`. Multiple charts may belong to one music.
- **Metadata**: Additional information other than the music itself, such as song title, artist, genre, comments, `#STAGEFILE`, `#BANNER`, etc.
- **Resource**: External files such as audio, images, videos, etc. that are referenced from the score.
- **song**: This is a word that appears in external specifications and file names rather than an internal term for this repository. It is especially used to refer to upstream names like `song.mid` or `bemuse-song.json`.
- **keysound**: Audio resource used to pronounce notes and BGM. BMS mainly supports `#WAVxx`, and bmson supports `sound_channels`.
- **preview**: A short preview sound played on the song selection screen. Preferably use `#PREVIEW` or bmson's `info.preview_music`.
- **BGA**: Background image/video displayed during gameplay. It has cues such as base, layer, and poor.
- **POOR BGA**: This is a dedicated BGA that is displayed during `POOR` judgment. Used only when defined on the music score side.
- **STAGEFILE**: This is the image displayed on the loading screen after selecting a song. It has a different purpose from BGA during gameplay.
- **BANNER**: A horizontal image displayed in the song introduction block on the song selection screen. BMS uses `#BANNER`, bmson uses `info.banner_image`.

### Playback and judgment

- **Channel**: A unit for identifying musical score data on BMS/BMSON. It refers to values ​​such as `11`, `16`, and `54` in BMS, and source-level identifiers based on `notes.x` in BMSON.
- **LANE**: A unit in which the player actually performs input, drawing, and judgment. Assign source-level channels to lanes according to the performance mode.
- **scratch**: Scratch lane. `16` corresponds to SP, and `16` and `26` correspond to DP.
- **FREE ZONE**: A special note that uses `17` / `27`. For anything other than 9KEY, it is drawn over the scratch lane and excluded from normal score/gauge targets.
- **measure**: A division on the musical score. `mmm` of `#mmmcc` in BMS and `measure` in IR correspond.
- **beat**: The time unit on the musical score that normalizes the bar length. player and `@be-music/chart` calculate the time and display position based on beat.
- **BPM**: Beats per minute. Determines the time progression of the score.
- **STOP**: This is an event that stops the music score time for a certain period of time. It affects both appearance and judgment time.
- **SCROLL**: A coefficient that changes how the notes flow visually. This affects the display position, not the judgment time.
- **SPEED**: A factor that changes the visual distance of notes with interpolation. Used in conjunction with `SCROLL`.
- **Long note (LN)**: A note with a start and end point. The handling of holding, releasing, and reaching the end point depends on `LNMODE`.
- **LNOBJ**: Long note terminal object declared with `#LNOBJ` in BMS.- **LNMODE**: BMS long note judgment rule. `1`, `2`, and `3` change the handling of end point judgment and hold break.
- **Mine**: A note that takes damage when pressed. This repository treats it as equivalent to `BAD`.
- **Judge**: `PERFECT` / `GREAT` / `GOOD` / `BAD` / `POOR` result. Affects score, combo, and gauge.
- **FAST/SLOW**: This is an auxiliary display for fast/slow press of the judgment timing. In the current implementation, only `GREAT` and `GOOD` are aggregated, and `PERFECT` is not incremented.
- **EX-SCORE**: IIDX compatible score. Generally, `PERFECT=2`, `GREAT=1`, otherwise `0` is used for aggregation.
- **SCORE**: Standard score out of 200,000 points. Calculated from the number of judges and notes.
- **groove gauge**: Gauge used for clearing judgment. Currently, only `NORMAL` which is compatible with LR2 is implemented.
- **HIGH-SPEED**: User setting to enlarge or reduce the display of falling notes. The time itself on the music score cannot be changed.
- **MANUAL / AUTO SCRATCH / AUTO**: Player's performance mode. `MANUAL` is manual, `AUTO SCRATCH` is automatic only for scratches, and `AUTO` is fully automatic.
- **Music Select**: Screen name of the music selection screen. Displays the score list, metadata, preview, banner, and operation help. The screen name is music, but the selection unit is chart.
- **control flow**: BMS branch instructions such as `#RANDOM`, `#IF`, `#SWITCH`. The parser maintains it, and the player and audio-renderer evaluate it at runtime.

## Terms used in internal implementation

### Data model

- **IR (__PH_0__)**: Intermediate representation for handling BMS/BMSON as a common representation within this repository. It is not an external exchange format and is for internal processing only.
- **pure IR**: The design policy is that `@be-music/json` does not have music score semantics, but only maintains a normalized data structure and auxiliary information.
- **sourceFormat**: An attribute indicating whether the IR originally came from `bms`, `bmson`, or `json`.
- **round-trip**: Reproduce the original score structure as much as possible by going back and forth from `parse -> IR -> stringify`.
- **preservation**: An auxiliary layer that preserves source-level information for round-trips. Manage it separately from normalized `events` / `measures`.
- **sourceLines**: Preservation information that maintains all lines of BMS in declaration order. header / object / Used to re-output control syntax while maintaining its relative position.
- **objectLines**: Preservation information that preserves only object lines outside the control construct.
- **event**: Music score event after normalization. It has `measure`, `channel`, `position`, and `value`.
- **position**: IR event position. `[numerator, denominator]` represents the relative position within the measure.
- **chart semantics (__PH_0__)**: Musical score semantics on top of IR, such as beat resolution, event order, long note resolution, sample trigger determination, etc.
- **bms.controlFlow**: An array of BMS control syntax maintained by the parser. Branches are not finalized during parsing and are evaluated during playback/rendering.

### Runtime and display

- **candidate note**: When an input event arrives, this is the "unjudged note that is currently being searched for as a judgment target" in that lane. If there is no candidate, the input does nothing.
- **keysound fallback**: This is the fallback sound that is played when there is no note to be judged, but there is an auxiliary sound in the corresponding lane. Even if a key is pressed blankly, no additional judgments or gauge changes will occur.
- **stateSignals/uiSignals**: A group of signals that pass the state from the engine main body to the UI. Notifies judge, combo, frame, lane flash, hold state, etc.
- **UI runtime**: A layer that summarizes the display implementation during gameplay. Serves as a bridge between the player itself and TUI/CLI display.
- **gameplay worker / UI worker**: A worker that separates heavy processing in Node implementation. UI drawing and BGA processing are handled on the UI worker side.
- **ANSI rendering**: A method of displaying images and BGA by converting them into character cells and colored strings on the terminal.
- **Kitty graphics protocol**: A method for directly displaying images as overlays on compatible devices. In this repository, it is enabled by default with `player` and can be disabled with `--no-kitty-graphics`.
- **render throttle**: A mechanism to limit TUI drawing to target fps. Even if a rendering update comes, the final render will be thinned out to a certain interval or less.
- **settle delay**: A short delay that does not start the song selection preview immediately, but waits until the cursor has settled down a bit. Reduces getting caught during continuous movement.- **focus key**: An identifier to save the last selected item in Music Select for each directory. Usually includes a `random` entry as well as a chart.
- **content hash**: This is a hash value to determine whether the original chart body is the same in the song list cache. The current implementation uses `SHA-256` with raw bytes.
- **cache hash**: This is a hash value to detect tampering or corruption of the saved cache entry itself. Recalculate and verify from `content hash` and persisted summary.
- **Sound/Visual status**: The progress status of the audio and graphics sides are displayed separately on the loading screen. Used to determine which part is waiting during parallel loading.
- **structured log**: Execution log output by `player` in NDJSON. It is separated from the TUI drawing of `stdout` / `stderr`, and uses `~/.be-music/logs/player.ndjson` by default.
- **video BGA streaming**: The implementation policy is to reserve only the first frame of the video BGA to allow playback to start, and then decode the remaining frames in stages after the gameplay starts.
- **PlayerSummary**: This is the summary result after playback ends. Including judge counts, `FAST` / `SLOW`, `EX-SCORE`, `SCORE`, `gauge`, etc.

## Related documents

- [Specification top](./README.md)
- [BMS implementation specification](./bms-spec.md)
- [BMSON implementation specification](./bmson-spec.md)
- [Player implementation specification](./player-spec.md)
- [BMS/BMSON intermediate representation (`@be-music/json`) implementation specification](./json-spec.md)