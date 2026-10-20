CREATE TABLE `course` (
	`course_fingerprint` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`constraints` text NOT NULL,
	`stage_chart_fingerprints` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `course_best_score` (
	`user_id` text NOT NULL,
	`course_fingerprint` text NOT NULL,
	`ruleset` text NOT NULL,
	`assisted` integer NOT NULL,
	`best_ex` integer NOT NULL,
	`best_ex_score_id` text NOT NULL,
	`best_ex_at` integer NOT NULL,
	`best_lamp` integer NOT NULL,
	`best_lamp_score_id` text NOT NULL,
	`min_miss` integer NOT NULL,
	`min_miss_score_id` text NOT NULL,
	`play_count` integer NOT NULL,
	`played_here` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `course_fingerprint`, `ruleset`, `assisted`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`course_fingerprint`) REFERENCES `course`(`course_fingerprint`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `course_best_score_ranking_idx` ON `course_best_score` (`course_fingerprint`,`ruleset`,`assisted`,`best_ex`);--> statement-breakpoint
CREATE TABLE `course_score` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`user_id` text NOT NULL,
	`course_fingerprint` text NOT NULL,
	`played_ruleset` text NOT NULL,
	`gauge` text NOT NULL,
	`assisted` integer NOT NULL,
	`assist_flags` text NOT NULL,
	`verification` text NOT NULL,
	`stages_played` integer NOT NULL,
	`recorded_by` text,
	`submitted_by` text,
	`server_engine` text NOT NULL,
	`playlog_key` text NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`course_fingerprint`) REFERENCES `course`(`course_fingerprint`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `course_score_submission_id_unique` ON `course_score` (`submission_id`);--> statement-breakpoint
CREATE INDEX `course_score_user_course_idx` ON `course_score` (`user_id`,`course_fingerprint`);--> statement-breakpoint
CREATE INDEX `course_score_course_created_idx` ON `course_score` (`course_fingerprint`,`created_at`);--> statement-breakpoint
CREATE TABLE `course_score_result` (
	`course_score_id` text NOT NULL,
	`ruleset` text NOT NULL,
	`ruleset_revision` text NOT NULL,
	`ex_score` integer NOT NULL,
	`note_count` integer NOT NULL,
	`clear_lamp` integer NOT NULL,
	`miss_count` integer NOT NULL,
	`max_combo` integer NOT NULL,
	`stages_played` integer NOT NULL,
	`trophy` text,
	`gauge_type` text NOT NULL,
	`gauge_final` real NOT NULL,
	`judges` text NOT NULL,
	PRIMARY KEY(`course_score_id`, `ruleset`),
	FOREIGN KEY (`course_score_id`) REFERENCES `course_score`(`id`) ON UPDATE no action ON DELETE cascade
);
