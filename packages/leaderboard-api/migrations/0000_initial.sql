CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `best_score` (
	`user_id` text NOT NULL,
	`chart_fingerprint` text NOT NULL,
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
	PRIMARY KEY(`user_id`, `chart_fingerprint`, `ruleset`, `assisted`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chart_fingerprint`) REFERENCES `chart`(`chart_fingerprint`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `best_score_ranking_idx` ON `best_score` (`chart_fingerprint`,`ruleset`,`assisted`,`best_ex`);--> statement-breakpoint
CREATE TABLE `chart` (
	`chart_fingerprint` text PRIMARY KEY NOT NULL,
	`title` text,
	`artist` text,
	`note_count` integer NOT NULL,
	`play_fingerprints` text NOT NULL,
	`document_key` text NOT NULL,
	`status` text DEFAULT 'provisional' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chart_alias` (
	`kind` text NOT NULL,
	`hash` text NOT NULL,
	`chart_fingerprint` text NOT NULL,
	PRIMARY KEY(`kind`, `hash`),
	FOREIGN KEY (`chart_fingerprint`) REFERENCES `chart`(`chart_fingerprint`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `passkey` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`public_key` text NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`counter` integer NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer NOT NULL,
	`transports` text,
	`created_at` integer,
	`aaguid` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `passkey_user_id_idx` ON `passkey` (`user_id`);--> statement-breakpoint
CREATE INDEX `passkey_credential_id_idx` ON `passkey` (`credential_id`);--> statement-breakpoint
CREATE TABLE `profile` (
	`user_id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_handle_unique` ON `profile` (`handle`);--> statement-breakpoint
CREATE TABLE `score` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`user_id` text NOT NULL,
	`chart_fingerprint` text NOT NULL,
	`play_fingerprint` text NOT NULL,
	`played_ruleset` text NOT NULL,
	`gauge` text NOT NULL,
	`assisted` integer NOT NULL,
	`assist_flags` text NOT NULL,
	`verification` text NOT NULL,
	`recorded_by` text,
	`submitted_by` text,
	`server_engine` text NOT NULL,
	`playlog_key` text NOT NULL,
	`replay_visibility` text DEFAULT 'public' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chart_fingerprint`) REFERENCES `chart`(`chart_fingerprint`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `score_submission_id_unique` ON `score` (`submission_id`);--> statement-breakpoint
CREATE INDEX `score_user_chart_idx` ON `score` (`user_id`,`chart_fingerprint`);--> statement-breakpoint
CREATE TABLE `score_result` (
	`score_id` text NOT NULL,
	`ruleset` text NOT NULL,
	`ruleset_revision` text NOT NULL,
	`ex_score` integer NOT NULL,
	`note_count` integer NOT NULL,
	`clear_lamp` integer NOT NULL,
	`miss_count` integer NOT NULL,
	`max_combo` integer NOT NULL,
	`gauge_type` text NOT NULL,
	`judges` text NOT NULL,
	PRIMARY KEY(`score_id`, `ruleset`),
	FOREIGN KEY (`score_id`) REFERENCES `score`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`is_anonymous` integer DEFAULT false,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);