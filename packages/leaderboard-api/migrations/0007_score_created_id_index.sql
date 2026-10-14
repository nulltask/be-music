DROP INDEX `score_created_idx`;--> statement-breakpoint
CREATE INDEX `score_created_idx` ON `score` (`created_at`,`id`);