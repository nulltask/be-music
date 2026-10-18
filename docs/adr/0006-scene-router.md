[日本語版](./0006-scene-router.ja.md)

# The host routes every scene transition through one scene router

In the web demo one **scene router** owns the current scene. Every transition finalizes a recording in progress, mounts the next scene as the current one exits, so the stage never shows an empty frame, and then disposes the scene that left (the select scene is kept across a decide, play and result), always in that order. Transitions are serialized, and a scene built for a navigation that a newer one replaced is disposed instead of shown, so a late asynchronous step cannot land on a newer scene. Course runs, records and play logs, the library, settings, the Debug Menu and themes are separate services that `main.ts` only wires together. The 5,600-line host disposed a different set of views on each path: a drop or a skin change during a play lost the recording and left a course run active, so the next single play counted as a stage, and F5 dropped AUTO and replay.
