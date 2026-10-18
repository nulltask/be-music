---
'@be-music/player-web': minor
---

Let the player make their own courses on the select screen, as on LR2. `CourseMaker` (`./collection`) holds the player's courses and the course being made with their constraints (`setConstraints`, `setCourseConstraints`; a new course starts with its kind's defaults), and `resolveCourseMakerFolders` lists them as EXPERT / NONSTOP / GRADE course folders, each ending with a NEW COURSE bar. `createSelectScene` takes it as `courseMaker`: its state shows in the select frame, the session runs the finish, cancel and connection buttons, and the name and delete actions on the player's own course go to the host (`on.courseMaker('name' | 'delete', course)`) for its name field and confirmation. An LR2 skin lights ops 571 / 572 and 580-599, runs timers 17 / 18, shows the course being made on texts 150-154 and 170 (with each stage's subtitle on 160-164) and the default connection on 198, and handles buttons 230, 231, 233, 240-248 and 268.
