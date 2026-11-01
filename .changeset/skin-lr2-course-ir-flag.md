---
'@be-music/skin-lr2': minor
---

Add LR2's course IR flag to the select state: text 183 reads the selected course's flag (`ON` / `OFF`, `OFF` on any other bar) and button 253 draws cell 1 once the course is flagged. New `LR2_BUTTON.COURSE_IR`, `LR2_TEXT.COURSE_IR`, `resolveLR2CourseIRText` and `resolveLR2CourseIRButtonState`, and `resolveLR2CourseMakerAction` maps button 253 to `{ kind: 'ir' }`.
