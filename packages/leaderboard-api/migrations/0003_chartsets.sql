CREATE TABLE `chartset` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`event` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `chart` ADD `chartset_id` text REFERENCES chartset(id);--> statement-breakpoint
ALTER TABLE `chart` ADD `pack_type` text;--> statement-breakpoint
ALTER TABLE `chart` ADD `chartset_checked_at` integer;--> statement-breakpoint
CREATE INDEX `chart_chartset_idx` ON `chart` (`chartset_id`);--> statement-breakpoint
CREATE INDEX `chart_chartset_checked_idx` ON `chart` (`chartset_checked_at`);