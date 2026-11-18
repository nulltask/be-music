[日本語版](./0042-nanasi-groove-2-charts.ja.md)

# Read Nanasi Groove 2 `.n2s` charts as PMS

Toy Musical 3 ships its charts only as `.n2s` files for Nanasi Groove 2, the player bundled with it. An `.n2s` file is a "ZEXA" container whose single file is an ordinary PMS chart, compressed with zlib and encrypted with AES-128-CBC under a key and IV fixed in the player. The container layout is in [format-compat §2.20](../format-compat-bms.md#220-nanasi-groove-2-n2s-containers).

`@be-music/chart-parser` opens the container itself (`parseN2SBytes`) and parses the PMS file inside as it parses a `.pms` file. The key and IV therefore live in this public repository. The alternative, asking players to decrypt their packages with a separate tool first, would leave Toy Musical 3 unplayable for most of them; the maintainer chose to read the files directly.

`.n2s` counts as `.pms` wherever the extension is a lane-mode input (`isPMSChartPath`): the play variant, the 9 KEY layout and the fingerprint. An `.n2s` chart and the `.pms` file inside it get one fingerprint.

The five-button charts are PMS files that use only the centre lanes `13`–`15` and `22`–`23`. Nanasi Groove 2 plays them on its nine-button layout too, so Be-Music needs no separate mode for them. The `.n2x` lists and settings beside the charts (course lists, unlock conditions, play-level overrides) are not read, except that a chart list (`bmslist`) is read as a course without its unlock conditions ([course.md](../course.md#nanasi-groove-2-n2x-chart-lists)).
