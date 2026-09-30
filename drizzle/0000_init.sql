CREATE TABLE `duplicate_dismissals` (
	`group_key` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `file_ops` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`from_path` text,
	`to_path` text,
	`detail` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `library_files` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`rel_path` text NOT NULL,
	`size` integer NOT NULL,
	`mtime_ms` integer NOT NULL,
	`format` text,
	`codec` text,
	`lossless` integer,
	`bitrate` integer,
	`sample_rate` integer,
	`bits_per_sample` integer,
	`channels` integer,
	`duration_ms` integer,
	`title` text,
	`artist` text,
	`album` text,
	`album_artist` text,
	`track_number` integer,
	`track_total` integer,
	`disc_number` integer,
	`year` integer,
	`genre` text,
	`isrc` text,
	`has_artwork` integer DEFAULT false NOT NULL,
	`has_lyrics` integer DEFAULT false NOT NULL,
	`mb_recording_id` text,
	`mb_release_id` text,
	`acoustid_id` text,
	`audio_hash` text,
	`fingerprint` text,
	`fingerprint_duration` integer,
	`match_key` text,
	`loudness` real,
	`peaks` text,
	`track_id` text,
	`scanned_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`added_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_path` ON `library_files` (`path`);--> statement-breakpoint
CREATE INDEX `library_match_key` ON `library_files` (`match_key`);--> statement-breakpoint
CREATE INDEX `library_audio_hash` ON `library_files` (`audio_hash`);--> statement-breakpoint
CREATE INDEX `library_artist_album` ON `library_files` (`album_artist`,`album`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_items` (
	`source_id` text NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`artist` text NOT NULL,
	`album` text,
	`duration_ms` integer,
	`artwork_url` text,
	`position` integer DEFAULT 0 NOT NULL,
	`present` integer DEFAULT true NOT NULL,
	`ignored` integer DEFAULT false NOT NULL,
	`first_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`source_id`, `external_id`),
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`kind` text NOT NULL,
	`external_id` text NOT NULL,
	`url` text NOT NULL,
	`name` text NOT NULL,
	`owner` text,
	`artwork_url` text,
	`enabled` integer DEFAULT true NOT NULL,
	`auto_queue` integer DEFAULT true NOT NULL,
	`interval_minutes` integer DEFAULT 60 NOT NULL,
	`format_preset` text,
	`last_checked_at` integer,
	`next_check_at` integer,
	`last_error` text,
	`item_count` integer DEFAULT 0 NOT NULL,
	`truncated` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_provider_external` ON `sources` (`provider`,`kind`,`external_id`);--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`position` real NOT NULL,
	`requested_url` text,
	`source_id` text,
	`provider` text NOT NULL,
	`spotify_id` text,
	`youtube_id` text,
	`title` text,
	`artist` text,
	`artists` text,
	`album` text,
	`album_artist` text,
	`track_number` integer,
	`disc_number` integer,
	`year` integer,
	`genre` text,
	`duration_ms` integer,
	`artwork_url` text,
	`match_url` text,
	`match_title` text,
	`match_score` real,
	`format_preset` text NOT NULL,
	`has_lyrics` integer DEFAULT false NOT NULL,
	`has_synced_lyrics` integer DEFAULT false NOT NULL,
	`has_artwork` integer DEFAULT false NOT NULL,
	`file_path` text,
	`file_size` integer,
	`bitrate` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`retry_at` integer,
	`force` integer DEFAULT false NOT NULL,
	`error` text,
	`skip_reason` text,
	`log` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tracks_status_order` ON `tracks` (`status`,`priority`,`position`);--> statement-breakpoint
CREATE INDEX `tracks_spotify` ON `tracks` (`spotify_id`);--> statement-breakpoint
CREATE INDEX `tracks_youtube` ON `tracks` (`youtube_id`);--> statement-breakpoint
CREATE INDEX `tracks_source` ON `tracks` (`source_id`);--> statement-breakpoint
CREATE INDEX `tracks_finished` ON `tracks` (`finished_at`);