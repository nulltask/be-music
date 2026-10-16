---
'@be-music/player-web': minor
---

`createSelectScene` takes an LR2 kit (`{ family: 'lr2', skin }`, the theme's select skin) as well as a be-music one. The LR2 family's select view draws the skin's frame, bar list, buttons, panels, sliders, numbers, texts and mouse cursor from the select session's frames, through `resolveLr2SelectState`, and starts LR2's timers from what the frames report: timer 0 at the screen's entry, timers 10-13 as the cursor moves (the bars slide by the move), the panel timers as option panels open and close, and timers 17 / 18 as a course starts and stops being made. Its buttons, its search box and a click on a bar come back as intents. The LR2 ids stay in the view.

The select scene takes the course maker (`courseMaker`): its state shows in `SelectFrame.courseMaker`, and the session runs its finish, cancel and connection buttons, the connections and the delete only on the player's own course under the cursor (`on.courseMaker('delete' | 'name', course)` for the host's confirmation and name field). `SelectIntent`'s `course-maker` action is now a `SelectCourseMakerAction` (`name`, `delete`, `finish`, `cancel`, `connection` with its slot and step, `default-connection` with its step).
