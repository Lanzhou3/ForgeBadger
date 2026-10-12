-- Cancel only queued work affected by the default-content revision. Do this
-- before normalizing the settings so the affected users remain identifiable.
UPDATE feishu_notification_deliveries
SET status = 'cancelled', error_code = 'SUBSCRIPTION_CHANGED'
WHERE status = 'pending' AND user_id IN (
  SELECT user_id FROM feishu_notification_settings WHERE content_level = 'status'
);
--> statement-breakpoint
UPDATE feishu_notification_settings
SET content_level = 'summary', revision = revision + 1
WHERE content_level = 'status';
