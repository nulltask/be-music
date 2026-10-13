ALTER TABLE `score` ADD `file_sha256` text;--> statement-breakpoint
ALTER TABLE `score` ADD `file_md5` text;--> statement-breakpoint
ALTER TABLE `score` ADD `duration_ms` integer;--> statement-breakpoint
CREATE INDEX `score_chart_file_idx` ON `score` (`chart_fingerprint`,`file_sha256`);