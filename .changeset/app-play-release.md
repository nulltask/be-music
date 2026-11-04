---
'@be-music/app-play': minor
---

Improve player setup, keyboard controls, and offline use.

- Load ZIP files dropped directly onto the player or selected with Open files. Keep ZIPs nested inside dropped folders unopened unless they are dropped separately.
- Make Be-Music Play installable with an offline app shell and an Install button. Cache the FFmpeg core and UI fonts during service-worker installation on a best-effort basis, retry missing assets on use, and request persistent storage for installed players. Keep authentication, APIs, URL-loaded archives, and the embed page outside the offline cache.
- Replace the Debug Menu with a localized Options dialog, grouped tabs, contextual help, and lane, START / SELECT, and screen-operation key configuration. Keep settings that apply live available during play; previously saved Debug Menu settings are not migrated.
- Show each screen's configured keys in Help's Keyboard tab. Simplify the other Help tabs and place the language switch in the dialog header.
- Add LR2 and beatoraja screen shortcuts, including fullscreen, screenshots, frame rate display, ranking links, saved replays, chart hash copying, folder AUTO play, and confirmation before leaving the select screen. Use Pause or Tab to pause gameplay; Space remains the pause shortcut for an embedded AUTO preview.
- Reload dropped folders on the select screen to pick up added, changed, or removed charts. Retain chart difficulty and level edits and gameplay skin position and scale adjustments across plays.
- Fix Options dialog horizontal overflow, restore gameplay focus after closing dialogs, align the inline search field with the skin, and persist compressor tuning resets.
- Refresh the start screen, header controls, tooltips, and installed-window title bar. Render state-driven UI with Lit and reuse shared service authentication and header templates.
