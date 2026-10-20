CREATE TABLE profile (
 user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
 handle TEXT NOT NULL UNIQUE,
 display_name TEXT NOT NULL,
 avatar_key TEXT,
 created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
 updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
--> statement-breakpoint
CREATE TABLE handle_history (
 handle TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
--> statement-breakpoint
CREATE INDEX handle_history_user_idx ON handle_history(user_id);
--> statement-breakpoint
CREATE TABLE profile_sync (user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE, revision TEXT NOT NULL);
