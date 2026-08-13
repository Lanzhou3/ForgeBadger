ALTER TABLE `feishu_card_actions` ADD `card_message_id` text;
--> statement-breakpoint
CREATE INDEX `idx_feishu_card_message`
ON `feishu_card_actions` (`user_id`,`account_id`,`card_message_id`);
