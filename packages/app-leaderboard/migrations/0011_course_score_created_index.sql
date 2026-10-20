CREATE INDEX `course_score_created_idx` ON `course_score` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `course_score_user_created_idx` ON `course_score` (`user_id`,`created_at`);