---
'@be-music/player-web': minor
---

List beatoraja random courses: `readCourseFile` now reads beatoraja's command-folder file (`folder/*.json`) and returns every course group a file holds (an array, where it returned one group or `undefined`), `resolveCourseFolders` lists a group's random courses as course bars (`createRandomCourseEntry`), and `drawBrowserRandomCourse` draws a random course's stages from the collection, matching each song through `createCourseSongRecord` against the stage filters.
