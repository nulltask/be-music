---
'@be-music/player': minor
---

Place LR2 NONSTOP course stages: `.lr2crs` NONSTOP courses now carry their connections (`CourseDefinition.connections`, `parseLr2NonstopConnections`), and `planNonstopCourse` places the stages one after another as LR2's chart loader stitches them (last-measure handover, cutting, FIT time-stretch, BLANK gaps), with `createNonstopStageTiming` reading a stage chart. An `lr2` placement follows the LR2 binary exactly, including its third-stage start offset.
