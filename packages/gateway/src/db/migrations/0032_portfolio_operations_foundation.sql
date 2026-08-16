-- Portfolio Operations owns a new canonical record set.  It deliberately has
-- no foreign keys to legacy Copilot or Project Manager execution tables.
-- Composite tenant keys prevent a child row from attaching a same-looking ID
-- owned by another tenant. SQLite requires a unique parent key for each such FK.
CREATE UNIQUE INDEX `idx_projects_user_id` ON `projects` (`user_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sessions_user_project_id` ON `sessions` (`user_id`,`project_id`,`id`);
--> statement-breakpoint
CREATE TABLE `portfolio_projects` (
  `project_id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `owner_user_id` text NOT NULL,
  `enrollment_status` text NOT NULL DEFAULT 'pending_evidence',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`,`project_id`) REFERENCES `projects`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_portfolio_projects_user_status` ON `portfolio_projects` (`user_id`,`enrollment_status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_projects_user_project` ON `portfolio_projects` (`user_id`,`project_id`);
--> statement-breakpoint
CREATE TABLE `portfolio_operation_records` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `operation` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `payload_digest` text NOT NULL,
  `result_json` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_operations_user_operation_key` ON `portfolio_operation_records` (`user_id`,`operation`,`idempotency_key`);
--> statement-breakpoint
CREATE TABLE `portfolio_project_dossiers` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `project_id` text NOT NULL,
  `objective` text NOT NULL,
  `intended_outcome` text NOT NULL,
  `scope_json` text NOT NULL DEFAULT '{}',
  `observed_state_json` text NOT NULL DEFAULT '{}',
  `projection_version` integer NOT NULL DEFAULT 1,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`) REFERENCES `portfolio_projects`(`user_id`,`project_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_dossiers_user_project` ON `portfolio_project_dossiers` (`user_id`,`project_id`);
--> statement-breakpoint
CREATE TABLE `portfolio_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `project_id` text,
  `requester_id` text,
  `source` text NOT NULL,
  `source_event_id` text,
  `request_text` text NOT NULL,
  `source_metadata_json` text NOT NULL DEFAULT '{}',
  `state` text NOT NULL DEFAULT 'received',
  `projection_version` integer NOT NULL DEFAULT 1,
  `correlation_id` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `input_digest` text NOT NULL,
  `received_at` integer NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`) REFERENCES `portfolio_projects`(`user_id`,`project_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_requests_user_idempotency` ON `portfolio_requests` (`user_id`,`idempotency_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_requests_source_event` ON `portfolio_requests` (`user_id`,`source`,`source_event_id`) WHERE `source_event_id` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_portfolio_requests_user_project_created` ON `portfolio_requests` (`user_id`,`project_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_requests_user_id` ON `portfolio_requests` (`user_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_requests_user_project_id` ON `portfolio_requests` (`user_id`,`project_id`,`id`);
--> statement-breakpoint
-- Intake may route a Request and transition its state, but must never rewrite its received payload.
CREATE TRIGGER `portfolio_requests_immutable_payload_update`
BEFORE UPDATE ON `portfolio_requests`
WHEN NEW.`id` IS NOT OLD.`id`
  OR NEW.`user_id` IS NOT OLD.`user_id`
  OR NEW.`request_text` IS NOT OLD.`request_text`
  OR NEW.`requester_id` IS NOT OLD.`requester_id`
  OR NEW.`source` IS NOT OLD.`source`
  OR NEW.`source_event_id` IS NOT OLD.`source_event_id`
  OR NEW.`source_metadata_json` IS NOT OLD.`source_metadata_json`
  OR NEW.`correlation_id` IS NOT OLD.`correlation_id`
  OR NEW.`idempotency_key` IS NOT OLD.`idempotency_key`
  OR NEW.`input_digest` IS NOT OLD.`input_digest`
  OR NEW.`received_at` IS NOT OLD.`received_at`
  OR NEW.`created_at` IS NOT OLD.`created_at`
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_REQUEST_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TABLE `portfolio_intake_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `request_id` text NOT NULL,
  `selected_project_id` text,
  `candidate_project_ids_json` text NOT NULL DEFAULT '[]',
  `scope_assessment` text NOT NULL,
  `producer` text NOT NULL,
  `evidence_ids_json` text NOT NULL DEFAULT '[]',
  `state` text NOT NULL DEFAULT 'awaiting_owner',
  `projection_version` integer NOT NULL DEFAULT 1,
  `idempotency_key` text NOT NULL,
  `input_digest` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`request_id`) REFERENCES `portfolio_requests`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`selected_project_id`) REFERENCES `portfolio_projects`(`user_id`,`project_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_intake_user_idempotency` ON `portfolio_intake_decisions` (`user_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `idx_portfolio_intake_request_created` ON `portfolio_intake_decisions` (`user_id`,`request_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `portfolio_work_items` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `project_id` text NOT NULL,
  `request_id` text NOT NULL,
  `owner_user_id` text NOT NULL,
  `title` text NOT NULL,
  `description` text,
  `acceptance_criteria_json` text NOT NULL DEFAULT '[]',
  `verification_requirements_json` text NOT NULL DEFAULT '[]',
  `state` text NOT NULL DEFAULT 'todo',
  `projection_version` integer NOT NULL DEFAULT 1,
  `idempotency_key` text NOT NULL,
  `input_digest` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`) REFERENCES `portfolio_projects`(`user_id`,`project_id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`request_id`) REFERENCES `portfolio_requests`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_work_items_user_idempotency` ON `portfolio_work_items` (`user_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `idx_portfolio_work_items_user_project_state` ON `portfolio_work_items` (`user_id`,`project_id`,`state`);
--> statement-breakpoint
CREATE INDEX `idx_portfolio_work_items_request` ON `portfolio_work_items` (`user_id`,`request_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_work_items_user_id` ON `portfolio_work_items` (`user_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_work_items_user_project_id` ON `portfolio_work_items` (`user_id`,`project_id`,`id`);
--> statement-breakpoint
CREATE TABLE `portfolio_task_packets` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `project_id` text NOT NULL,
  `work_item_id` text NOT NULL,
  `packet_version` integer NOT NULL,
  `packet_digest` text NOT NULL,
  `skill_version` text NOT NULL,
  `source_work_item_version` integer NOT NULL,
  `dossier_version` integer NOT NULL,
  `created_by` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`) REFERENCES `portfolio_projects`(`user_id`,`project_id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`) REFERENCES `portfolio_work_items`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_packets_work_item_version` ON `portfolio_task_packets` (`user_id`,`work_item_id`,`packet_version`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_packets_work_item_digest` ON `portfolio_task_packets` (`user_id`,`work_item_id`,`packet_digest`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_packets_user_id` ON `portfolio_task_packets` (`user_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_packets_user_project_work_item_id` ON `portfolio_task_packets` (`user_id`,`project_id`,`work_item_id`,`id`);
--> statement-breakpoint
CREATE TABLE `portfolio_task_attempts` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `project_id` text NOT NULL,
  `work_item_id` text NOT NULL,
  `request_id` text,
  `packet_id` text,
  `attempt_number` integer NOT NULL,
  `source_work_item_version` integer NOT NULL,
  `packet_version` integer NOT NULL,
  `packet_digest` text NOT NULL,
  `adapter` text NOT NULL,
  `created_by` text NOT NULL,
  `state` text NOT NULL DEFAULT 'prepared',
  `projection_version` integer NOT NULL DEFAULT 1,
  `idempotency_key` text NOT NULL,
  `input_digest` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `completed_at` integer,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`) REFERENCES `portfolio_projects`(`user_id`,`project_id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`) REFERENCES `portfolio_work_items`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`request_id`) REFERENCES `portfolio_requests`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`,`packet_id`) REFERENCES `portfolio_task_packets`(`user_id`,`project_id`,`work_item_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_attempts_work_item_number` ON `portfolio_task_attempts` (`user_id`,`work_item_id`,`attempt_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_attempts_user_idempotency` ON `portfolio_task_attempts` (`user_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `idx_portfolio_attempts_work_item_state` ON `portfolio_task_attempts` (`user_id`,`work_item_id`,`state`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_attempts_user_id` ON `portfolio_task_attempts` (`user_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_attempts_user_project_work_item_id` ON `portfolio_task_attempts` (`user_id`,`project_id`,`work_item_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_attempts_user_project_id` ON `portfolio_task_attempts` (`user_id`,`project_id`,`id`);
--> statement-breakpoint
CREATE TABLE `portfolio_session_assignments` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `project_id` text NOT NULL,
  `work_item_id` text NOT NULL,
  `attempt_id` text NOT NULL,
  `session_id` text NOT NULL,
  `adapter` text NOT NULL,
  `lease_token_digest` text NOT NULL,
  `lease_expires_at` integer NOT NULL,
  `active_attempt_slot` text,
  `active_session_slot` text,
  `released_reason` text,
  `projection_version` integer NOT NULL DEFAULT 1,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `released_at` integer,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`) REFERENCES `portfolio_projects`(`user_id`,`project_id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`) REFERENCES `portfolio_work_items`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`,`attempt_id`) REFERENCES `portfolio_task_attempts`(`user_id`,`project_id`,`work_item_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`session_id`) REFERENCES `sessions`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_assignment_attempt_active` ON `portfolio_session_assignments` (`user_id`,`attempt_id`,`active_attempt_slot`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_assignment_session_active` ON `portfolio_session_assignments` (`user_id`,`session_id`,`active_session_slot`);
--> statement-breakpoint
CREATE INDEX `idx_portfolio_assignment_lease` ON `portfolio_session_assignments` (`user_id`,`lease_expires_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_assignments_user_id` ON `portfolio_session_assignments` (`user_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_assignments_user_project_work_item_attempt_id` ON `portfolio_session_assignments` (`user_id`,`project_id`,`work_item_id`,`attempt_id`,`id`);
--> statement-breakpoint
CREATE TABLE `portfolio_action_intents` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `project_id` text NOT NULL,
  `work_item_id` text,
  `attempt_id` text,
  `session_id` text,
  `action_class` text NOT NULL,
  `resource_scope_json` text NOT NULL DEFAULT '{}',
  `payload_digest` text NOT NULL,
  `assignment_lease_token_digest` text,
  `policy_rule` text,
  `issued_at` integer NOT NULL,
  `expires_at` integer NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`) REFERENCES `portfolio_projects`(`user_id`,`project_id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`) REFERENCES `portfolio_work_items`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`,`attempt_id`) REFERENCES `portfolio_task_attempts`(`user_id`,`project_id`,`work_item_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`session_id`) REFERENCES `sessions`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_portfolio_action_intents_scope` ON `portfolio_action_intents` (`user_id`,`project_id`,`work_item_id`,`attempt_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_action_intents_user_id` ON `portfolio_action_intents` (`user_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_action_intents_user_project_work_item_attempt_id` ON `portfolio_action_intents` (`user_id`,`project_id`,`work_item_id`,`attempt_id`,`id`);
--> statement-breakpoint
CREATE TABLE `portfolio_execution_authorizations` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `project_id` text NOT NULL,
  `work_item_id` text,
  `attempt_id` text,
  `action_intent_id` text NOT NULL,
  `authorization_tier` text NOT NULL,
  `action_digest` text NOT NULL,
  `policy_rule` text,
  `state` text NOT NULL DEFAULT 'proposed',
  `projection_version` integer NOT NULL DEFAULT 1,
  `expires_at` integer NOT NULL,
  `consumed_at` integer,
  `idempotency_key` text NOT NULL,
  `input_digest` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`) REFERENCES `portfolio_projects`(`user_id`,`project_id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`) REFERENCES `portfolio_work_items`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`,`attempt_id`) REFERENCES `portfolio_task_attempts`(`user_id`,`project_id`,`work_item_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`,`attempt_id`,`action_intent_id`) REFERENCES `portfolio_action_intents`(`user_id`,`project_id`,`work_item_id`,`attempt_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_authorization_user_idempotency` ON `portfolio_execution_authorizations` (`user_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `idx_portfolio_authorization_action_state` ON `portfolio_execution_authorizations` (`user_id`,`action_intent_id`,`state`,`expires_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_authorizations_user_id` ON `portfolio_execution_authorizations` (`user_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_authorizations_user_project_work_item_attempt_id` ON `portfolio_execution_authorizations` (`user_id`,`project_id`,`work_item_id`,`attempt_id`,`id`);
--> statement-breakpoint
CREATE TABLE `portfolio_commands` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `project_id` text NOT NULL,
  `work_item_id` text NOT NULL,
  `attempt_id` text NOT NULL,
  `assignment_id` text,
  `authorization_id` text,
  `action_intent_id` text NOT NULL,
  `command_type` text NOT NULL,
  `payload_digest` text NOT NULL,
  `state` text NOT NULL DEFAULT 'pending',
  `dispatch_receipt_digest` text,
  `observed_at` integer,
  `projection_version` integer NOT NULL DEFAULT 1,
  `idempotency_key` text NOT NULL,
  `input_digest` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `completed_at` integer,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`) REFERENCES `portfolio_projects`(`user_id`,`project_id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`) REFERENCES `portfolio_work_items`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`,`attempt_id`) REFERENCES `portfolio_task_attempts`(`user_id`,`project_id`,`work_item_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`,`attempt_id`,`assignment_id`) REFERENCES `portfolio_session_assignments`(`user_id`,`project_id`,`work_item_id`,`attempt_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`,`attempt_id`,`authorization_id`) REFERENCES `portfolio_execution_authorizations`(`user_id`,`project_id`,`work_item_id`,`attempt_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`,`attempt_id`,`action_intent_id`) REFERENCES `portfolio_action_intents`(`user_id`,`project_id`,`work_item_id`,`attempt_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_commands_user_idempotency` ON `portfolio_commands` (`user_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `idx_portfolio_commands_attempt_state` ON `portfolio_commands` (`user_id`,`attempt_id`,`state`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_commands_user_project_work_item_attempt_id` ON `portfolio_commands` (`user_id`,`project_id`,`work_item_id`,`attempt_id`,`id`);
--> statement-breakpoint
CREATE TABLE `portfolio_observation_profiles` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `project_id` text NOT NULL,
  `status` text NOT NULL DEFAULT 'active',
  `projection_version` integer NOT NULL DEFAULT 1,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`) REFERENCES `portfolio_projects`(`user_id`,`project_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_observation_profile_project` ON `portfolio_observation_profiles` (`user_id`,`project_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_observation_profiles_user_id` ON `portfolio_observation_profiles` (`user_id`,`id`);
--> statement-breakpoint
CREATE TABLE `portfolio_observation_probes` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `profile_id` text NOT NULL,
  `source_category` text NOT NULL,
  `operation` text NOT NULL,
  `root_ref` text,
  `arguments_json` text NOT NULL DEFAULT '{}',
  `timeout_ms` integer NOT NULL,
  `max_output_bytes` integer NOT NULL,
  `redaction_policy` text NOT NULL,
  `freshness_ms` integer NOT NULL,
  `enabled` integer NOT NULL DEFAULT 1,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`profile_id`) REFERENCES `portfolio_observation_profiles`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_probe_profile_operation` ON `portfolio_observation_probes` (`user_id`,`profile_id`,`operation`);
--> statement-breakpoint
CREATE TABLE `portfolio_evidence` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `project_id` text NOT NULL,
  `request_id` text,
  `work_item_id` text,
  `attempt_id` text,
  `producer` text NOT NULL,
  `source_category` text NOT NULL,
  `observed_at` integer NOT NULL,
  `collected_at` integer NOT NULL,
  `digest` text NOT NULL,
  `redacted_summary` text NOT NULL,
  `confidence` text NOT NULL,
  `freshness` text NOT NULL,
  `is_blocker` integer NOT NULL DEFAULT 0,
  `verification_key` text,
  `idempotency_key` text NOT NULL,
  `input_digest` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`) REFERENCES `portfolio_projects`(`user_id`,`project_id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`request_id`) REFERENCES `portfolio_requests`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`) REFERENCES `portfolio_work_items`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`attempt_id`) REFERENCES `portfolio_task_attempts`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`,`attempt_id`) REFERENCES `portfolio_task_attempts`(`user_id`,`project_id`,`work_item_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_evidence_user_idempotency` ON `portfolio_evidence` (`user_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `idx_portfolio_evidence_work_item` ON `portfolio_evidence` (`user_id`,`work_item_id`,`is_blocker`,`verification_key`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_evidence_user_id` ON `portfolio_evidence` (`user_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_evidence_user_project_id` ON `portfolio_evidence` (`user_id`,`project_id`,`id`);
--> statement-breakpoint
-- Intake evidence may name a candidate project before a request is routed. Once
-- routed, both write directions keep request and evidence project scopes equal.
CREATE TRIGGER `portfolio_evidence_request_project_scope_insert`
BEFORE INSERT ON `portfolio_evidence`
WHEN NEW.`request_id` IS NOT NULL AND EXISTS (
  SELECT 1 FROM `portfolio_requests`
  WHERE `user_id` = NEW.`user_id` AND `id` = NEW.`request_id`
    AND `project_id` IS NOT NULL AND `project_id` <> NEW.`project_id`
)
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_EVIDENCE_REQUEST_PROJECT_MISMATCH');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_evidence_request_project_scope_update`
BEFORE UPDATE OF `user_id`, `project_id`, `request_id` ON `portfolio_evidence`
WHEN NEW.`request_id` IS NOT NULL AND EXISTS (
  SELECT 1 FROM `portfolio_requests`
  WHERE `user_id` = NEW.`user_id` AND `id` = NEW.`request_id`
    AND `project_id` IS NOT NULL AND `project_id` <> NEW.`project_id`
)
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_EVIDENCE_REQUEST_PROJECT_MISMATCH');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_requests_project_evidence_scope_update`
BEFORE UPDATE OF `project_id` ON `portfolio_requests`
WHEN NEW.`project_id` IS NOT NULL AND EXISTS (
  SELECT 1 FROM `portfolio_evidence`
  WHERE `user_id` = NEW.`user_id` AND `request_id` = NEW.`id`
    AND `project_id` <> NEW.`project_id`
)
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_EVIDENCE_REQUEST_PROJECT_MISMATCH');
END;
--> statement-breakpoint
CREATE TABLE `portfolio_completion_candidates` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `project_id` text NOT NULL,
  `request_id` text NOT NULL,
  `work_item_id` text NOT NULL,
  `attempt_id` text NOT NULL,
  `summary` text NOT NULL,
  `evidence_ids_json` text NOT NULL DEFAULT '[]',
  `state` text NOT NULL DEFAULT 'candidate',
  `verified_at` integer,
  `projection_version` integer NOT NULL DEFAULT 1,
  `idempotency_key` text NOT NULL,
  `input_digest` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`) REFERENCES `portfolio_projects`(`user_id`,`project_id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`request_id`) REFERENCES `portfolio_requests`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`) REFERENCES `portfolio_work_items`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`attempt_id`) REFERENCES `portfolio_task_attempts`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`,`attempt_id`) REFERENCES `portfolio_task_attempts`(`user_id`,`project_id`,`work_item_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_candidates_user_idempotency` ON `portfolio_completion_candidates` (`user_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `idx_portfolio_candidates_work_item` ON `portfolio_completion_candidates` (`user_id`,`work_item_id`,`state`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_candidates_user_id` ON `portfolio_completion_candidates` (`user_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_candidates_user_project_work_item_id` ON `portfolio_completion_candidates` (`user_id`,`project_id`,`work_item_id`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_candidates_user_project_work_item_attempt_id` ON `portfolio_completion_candidates` (`user_id`,`project_id`,`work_item_id`,`attempt_id`,`id`);
--> statement-breakpoint
CREATE TABLE `portfolio_acceptance_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `project_id` text NOT NULL,
  `request_id` text NOT NULL,
  `work_item_id` text NOT NULL,
  `attempt_id` text NOT NULL,
  `candidate_id` text NOT NULL,
  `decision` text NOT NULL,
  `policy_rule` text,
  `evidence_ids_json` text NOT NULL DEFAULT '[]',
  `state` text NOT NULL DEFAULT 'candidate',
  `projection_version` integer NOT NULL DEFAULT 1,
  `idempotency_key` text NOT NULL,
  `input_digest` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`) REFERENCES `portfolio_projects`(`user_id`,`project_id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`request_id`) REFERENCES `portfolio_requests`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`) REFERENCES `portfolio_work_items`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`attempt_id`) REFERENCES `portfolio_task_attempts`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`,`attempt_id`) REFERENCES `portfolio_task_attempts`(`user_id`,`project_id`,`work_item_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`,`candidate_id`) REFERENCES `portfolio_completion_candidates`(`user_id`,`project_id`,`work_item_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`,`attempt_id`,`candidate_id`) REFERENCES `portfolio_completion_candidates`(`user_id`,`project_id`,`work_item_id`,`attempt_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_acceptance_user_idempotency` ON `portfolio_acceptance_decisions` (`user_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `idx_portfolio_acceptance_work_item` ON `portfolio_acceptance_decisions` (`user_id`,`work_item_id`,`state`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_acceptance_user_id` ON `portfolio_acceptance_decisions` (`user_id`,`id`);
--> statement-breakpoint
CREATE TABLE `portfolio_risk_signals` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `project_id` text NOT NULL,
  `work_item_id` text,
  `attempt_id` text,
  `evidence_id` text,
  `severity` text NOT NULL,
  `rationale` text NOT NULL,
  `state` text NOT NULL DEFAULT 'open',
  `projection_version` integer NOT NULL DEFAULT 1,
  `idempotency_key` text NOT NULL,
  `input_digest` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`) REFERENCES `portfolio_projects`(`user_id`,`project_id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`) REFERENCES `portfolio_work_items`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`attempt_id`) REFERENCES `portfolio_task_attempts`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`,`attempt_id`) REFERENCES `portfolio_task_attempts`(`user_id`,`project_id`,`work_item_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`evidence_id`) REFERENCES `portfolio_evidence`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_risks_user_idempotency` ON `portfolio_risk_signals` (`user_id`,`idempotency_key`);
--> statement-breakpoint
CREATE TABLE `portfolio_workflow_wakeups` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `project_id` text NOT NULL,
  `work_item_id` text NOT NULL,
  `attempt_id` text NOT NULL,
  `reason_class` text NOT NULL,
  `state` text NOT NULL DEFAULT 'scheduled',
  `projection_version` integer NOT NULL DEFAULT 1,
  `due_at` integer NOT NULL,
  `coalescing_key` text NOT NULL,
  `active_slot` text,
  `claim_token` text,
  `claim_expires_at` integer,
  `attempt_count` integer NOT NULL DEFAULT 0,
  `max_attempts` integer NOT NULL,
  `last_error_code` text,
  `idempotency_key` text NOT NULL,
  `input_digest` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `completed_at` integer,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`) REFERENCES `portfolio_projects`(`user_id`,`project_id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`) REFERENCES `portfolio_work_items`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`,`attempt_id`) REFERENCES `portfolio_task_attempts`(`user_id`,`project_id`,`work_item_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_wakeups_user_idempotency` ON `portfolio_workflow_wakeups` (`user_id`,`idempotency_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_wakeups_active_coalescing` ON `portfolio_workflow_wakeups` (`user_id`,`attempt_id`,`coalescing_key`,`active_slot`);
--> statement-breakpoint
CREATE INDEX `idx_portfolio_wakeups_due` ON `portfolio_workflow_wakeups` (`user_id`,`state`,`due_at`);
--> statement-breakpoint
CREATE TABLE `portfolio_heartbeat_settings` (
  `user_id` text PRIMARY KEY NOT NULL,
  `enabled` integer NOT NULL DEFAULT 0,
  `cadence_minutes` integer,
  `projection_version` integer NOT NULL DEFAULT 1,
  `last_reconciled_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `portfolio_channel_bindings` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `provider` text NOT NULL,
  `external_identity` text NOT NULL,
  `conversation_id` text NOT NULL,
  `project_id` text,
  `is_owner` integer NOT NULL DEFAULT 0,
  `status` text NOT NULL DEFAULT 'active',
  `projection_version` integer NOT NULL DEFAULT 1,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`) REFERENCES `portfolio_projects`(`user_id`,`project_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_channel_binding_identity` ON `portfolio_channel_bindings` (`user_id`,`provider`,`external_identity`,`conversation_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_channel_bindings_user_id` ON `portfolio_channel_bindings` (`user_id`,`id`);
--> statement-breakpoint
CREATE TABLE `portfolio_channel_actions` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `binding_id` text NOT NULL,
  `record_type` text NOT NULL,
  `record_id` text NOT NULL,
  `action_type` text NOT NULL,
  `payload_digest` text NOT NULL,
  `state` text NOT NULL DEFAULT 'pending',
  `projection_version` integer NOT NULL DEFAULT 1,
  `expires_at` integer NOT NULL,
  `consumed_at` integer,
  `idempotency_key` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`binding_id`) REFERENCES `portfolio_channel_bindings`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_channel_actions_user_idempotency` ON `portfolio_channel_actions` (`user_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `idx_portfolio_channel_actions_pending` ON `portfolio_channel_actions` (`user_id`,`binding_id`,`state`,`expires_at`);
--> statement-breakpoint
CREATE TABLE `portfolio_delivery_records` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `binding_id` text NOT NULL,
  `fact_id` text,
  `event_type` text NOT NULL,
  `event_version` integer NOT NULL,
  `summary_json` text NOT NULL,
  `state` text NOT NULL DEFAULT 'pending',
  `projection_version` integer NOT NULL DEFAULT 1,
  `attempt_count` integer NOT NULL DEFAULT 0,
  `next_attempt_at` integer NOT NULL,
  `claim_token` text,
  `claim_expires_at` integer,
  `provider_result_json` text,
  `idempotency_key` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `completed_at` integer,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`binding_id`) REFERENCES `portfolio_channel_bindings`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_delivery_user_idempotency` ON `portfolio_delivery_records` (`user_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `idx_portfolio_delivery_due` ON `portfolio_delivery_records` (`user_id`,`state`,`next_attempt_at`);
--> statement-breakpoint
CREATE TABLE `portfolio_facts` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `project_id` text,
  `request_id` text,
  `work_item_id` text,
  `attempt_id` text,
  `record_type` text NOT NULL,
  `record_id` text NOT NULL,
  `fact_type` text NOT NULL,
  `correlation_id` text,
  `idempotency_key` text,
  `payload_json` text NOT NULL,
  `payload_digest` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  -- An immutable ledger must never be removed implicitly by deleting its project.
  FOREIGN KEY (`user_id`,`project_id`) REFERENCES `portfolio_projects`(`user_id`,`project_id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`user_id`,`request_id`) REFERENCES `portfolio_requests`(`user_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`request_id`) REFERENCES `portfolio_requests`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`) REFERENCES `portfolio_work_items`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`attempt_id`) REFERENCES `portfolio_task_attempts`(`user_id`,`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`,`project_id`,`work_item_id`,`attempt_id`) REFERENCES `portfolio_task_attempts`(`user_id`,`project_id`,`work_item_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_portfolio_facts_user_idempotency` ON `portfolio_facts` (`user_id`,`idempotency_key`) WHERE `idempotency_key` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_portfolio_facts_timeline` ON `portfolio_facts` (`user_id`,`project_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `idx_portfolio_facts_record` ON `portfolio_facts` (`user_id`,`record_type`,`record_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `portfolio_facts_immutable_update`
BEFORE UPDATE ON `portfolio_facts`
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_FACT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `portfolio_facts_immutable_delete`
BEFORE DELETE ON `portfolio_facts`
BEGIN
  SELECT RAISE(ABORT, 'PORTFOLIO_FACT_IMMUTABLE');
END;
