ALTER TABLE `chart` ADD `play_level` text;--> statement-breakpoint
ALTER TABLE `chart` ADD `difficulty` integer;--> statement-breakpoint
ALTER TABLE `score` ADD `lane_option` text;--> statement-breakpoint
CREATE INDEX `score_pending_lane_option_idx` ON `score` (`lane_option`) WHERE "score"."lane_option" is null;