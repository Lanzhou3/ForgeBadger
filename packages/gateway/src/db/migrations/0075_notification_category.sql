-- Split notifications into categories: CLI/session hook events keep the
-- default `session_event` category, while Gateway app actions (apply-provider
-- results, provider model sync results) are persisted as `app_action` rows so
-- the notifications page can filter and render them separately.
ALTER TABLE `notifications` ADD COLUMN `category` text NOT NULL DEFAULT 'session_event';
