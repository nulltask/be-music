---
'@be-music/player-browser': minor
---

Let the player flag a course they made for IR, as LR2's button 253 does: `CourseMaker.releaseCourse` sets the course's `release` (one-way), and `CourseMaker.isReadOnly` tells a flagged course, whose connections and constraints `stepConnection` and `setCourseConstraints` then refuse so its ranking key stays fixed (renaming and deleting still work, as in LR2). The select session runs the new `ir` course-maker action on the player's own course under the cursor and plays the option-change cue, and a flagged RANDOM MIX is kept by the next draw.
