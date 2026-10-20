CREATE TABLE `handle_history` (
	`handle` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `profile` ADD `avatar_key` text;--> statement-breakpoint
-- Generated handles were `player-` plus eight letters or digits; handles now allow letters, digits and `_` only. Keep
-- the old handle reserved (its URL redirects), then switch the profile to `player_…`.
INSERT INTO `handle_history` (`handle`, `user_id`) SELECT `handle`, `user_id` FROM `profile` WHERE `handle` LIKE 'player-%';--> statement-breakpoint
UPDATE `profile` SET `handle` = replace(`handle`, '-', '_') WHERE `handle` LIKE 'player-%';
