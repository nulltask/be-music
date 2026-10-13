CREATE TABLE `chartset` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`event` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `chart` ADD `subtitle` text;--> statement-breakpoint
ALTER TABLE `chart` ADD `genre` text;--> statement-breakpoint
ALTER TABLE `chart` ADD `source_format` text;--> statement-breakpoint
ALTER TABLE `chart` ADD `lane_mode` text;--> statement-breakpoint
ALTER TABLE `chart` ADD `total` real;--> statement-breakpoint
ALTER TABLE `chart` ADD `ln_mode` integer;--> statement-breakpoint
ALTER TABLE `chart` ADD `judge_rank` text;--> statement-breakpoint
ALTER TABLE `chart` ADD `chartset_id` text REFERENCES chartset(id);--> statement-breakpoint
ALTER TABLE `chart` ADD `pack_type` text;--> statement-breakpoint
ALTER TABLE `chart` ADD `chartset_checked_at` integer;--> statement-breakpoint
CREATE INDEX `chart_chartset_idx` ON `chart` (`chartset_id`);--> statement-breakpoint
CREATE INDEX `chart_chartset_checked_idx` ON `chart` (`chartset_checked_at`);--> statement-breakpoint
ALTER TABLE `score_result` ADD `gauge_final` real;