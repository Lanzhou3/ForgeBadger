# ADR 0001: Decouple model configuration from projects and sessions (cc-switch model)

- Status: accepted (2026-09-01)
- Supersedes: the provider-binding design persisted by migrations 0053-0056

## Context

Model/provider selection used to be coupled to projects and sessions through
`model_provider_bindings`: a binding pinned an adapter + scope
(`global`/`project`) + provider/model/credential + auth mode, claimed the CLI
config file target, projected `{env:VAR}` references into global config files,
and froze a launch snapshot on every bound session. Session creation accepted
`bindingId` (or legacy `modelId`/`apiKeyId`), restart rebuilt the frozen
environment, and `/api/v1/cli-config/*` was claim-gated read-only.

This design contradicted how the underlying CLIs actually work and how
cc-switch operates: model providers are a property of the CLI's user-global
config, not of a project. It also forced dual maintenance (global vs project
scopes), made `/cli-config` read-only, and spread secret injection across the
launch path.

## Decision

- Sessions are model-agnostic. `POST /api/v1/sessions` accepts only
  `projectId` + `aiTool`; every session launches `host_environment`. No
  provider, model, or credential environment is injected at launch, and
  `POST /:id/switch-model` is removed.
- Model/provider setup is per-CLI and user-global. The Model Center
  (`/models`, `model_profiles`/`provider_credentials`) remains the inventory;
  `POST /api/v1/cli-config/:adapter/apply-provider` (plus `/preview` and
  `/rollback`) writes a selected provider/model/credential into the CLI's
  native global config files: Claude `~/.claude/settings.json`, Codex
  `~/.codex/config.toml` (credential as
  `model_providers.<id>.experimental_bearer_token`; the legacy
  `~/.codex/auth.json` `OPENAI_API_KEY` slot is removed and an emptied
  `auth.json` is deleted), OpenCode `opencode.json` (additive provider entry
  with `name`/`models`), Kimi `~/.kimi-code/config.toml`. Applying the Kimi
  For Coding endpoint to Claude also fills in the 256k context-window
  overrides (`CLAUDE_CODE_MAX_CONTEXT_TOKENS` / `CLAUDE_CODE_AUTO_COMPACT_WINDOW`)
  without overwriting explicit user values, and a stale `ANTHROPIC_API_KEY`
  is removed whenever a new `ANTHROPIC_AUTH_TOKEN` is written.
- Model selection is adapter-specific (cc-switch parity, 2026-09-02): Claude
  accepts `modelMapping` (`opus`/`sonnet`/`haiku` plus optional
  `fable`/`subagent`; unset roles fall back to the primary model) and writes
  the official alias pins `ANTHROPIC_DEFAULT_<ROLE>_MODEL` with their
  `*_MODEL_NAME` display names — the deprecated `ANTHROPIC_SMALL_FAST_MODEL`
  is removed, never written. Codex accepts `reasoningEffort`
  (`model_reasoning_effort`). OpenCode apply is additive: every active model
  of the provider joins the provider entry's `models` map, and the user-owned
  top-level `model` key is never touched.
- Credentials are written plaintext into the CLI config file (cc-switch
  parity), via atomic mode-`0600` writes after an AES-256-GCM-encrypted backup
  under the state directory. Plaintext keys still never touch the database,
  logs, events, or API responses; preview responses mask secret values.
- `/api/v1/cli-config/*` is no longer claim-gated: instance-admin authority is
  sufficient, semantic writes (providers/models/default-model) are enabled,
  and raw writes are atomic.
- `model_provider_bindings`, the sessions `launch_*` columns, and migrations
  0053-0056 remain applied for migration continuity and historical provenance,
  but live code does not read or write them. Historical bound sessions restart
  as plain host-environment sessions.
- Copilot is unaffected: it resolves models directly from `model_profiles`
  (default first) and decrypts credentials only in Gateway memory.

## Consequences

- A CLI launched outside ForgeBadger uses the same global config and works
  identically; project switching never implies model switching.
- Secret material now rests in user-owned CLI config files (mode `0600`),
  which is the native behavior of every supported CLI; operators who need
  keys off disk must not run apply-provider and instead manage CLI config
  themselves.
- Historical session provenance columns are inert; deleting them would be a
  separate, destructive migration decision.
