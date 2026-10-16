[日本語版](./0006-scene-router.ja.md)

# The host routes every scene transition through one scene router

In the web demo one **scene router** owns the current scene. Every transition finalizes a recording in progress, detaches and disposes the current scene and mounts the next, always in that order, and transitions are serialized so a late asynchronous step cannot land on a newer scene. Course runs, records and play logs, the library, settings, the Debug Menu and themes are separate services that `main.ts` only wires together. The 5,600-line host disposed a different set of views on each path: a drop or a skin change during a play lost the recording and left a course run active, so the next single play counted as a stage, and F5 dropped AUTO and replay.
