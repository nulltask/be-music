ALTER TABLE `score` ADD `file_sha256` text;--> statement-breakpoint
ALTER TABLE `score` ADD `file_md5` text;--> statement-breakpoint
ALTER TABLE `score` ADD `duration_ms` integer;--> statement-breakpoint
CREATE INDEX `score_chart_file_idx` ON `score` (`chart_fingerprint`,`file_sha256`);--> statement-breakpoint
CREATE INDEX `score_created_idx` ON `score` (`created_at`);--> statement-breakpoint
CREATE INDEX `score_user_created_idx` ON `score` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `score_pending_backfill_idx` ON `score` (`duration_ms`) WHERE "score"."duration_ms" is null;--> statement-breakpoint
CREATE INDEX `chart_alias_chart_idx` ON `chart_alias` (`chart_fingerprint`);--> statement-breakpoint
CREATE INDEX `handle_history_user_idx` ON `handle_history` (`user_id`);