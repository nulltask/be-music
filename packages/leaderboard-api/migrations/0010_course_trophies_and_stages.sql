ALTER TABLE `course_best_score` ADD `best_trophy` text;--> statement-breakpoint
ALTER TABLE `course_best_score` ADD `best_trophy_rank` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `course_best_score` ADD `best_trophy_score_id` text;--> statement-breakpoint
ALTER TABLE `course_score_result` ADD `trophy_rank` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `course_score_result` ADD `stages` text;