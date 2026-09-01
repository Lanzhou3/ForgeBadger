## ADDED Requirements

### Requirement: Feishu has no Portfolio handler
The Feishu integration MUST NOT route messages, actions, deliveries, identities, or conversations through Portfolio repositories or services.

#### Scenario: Feishu runtime starts
- **WHEN** the Gateway composes enabled Feishu accounts
- **THEN** no Portfolio handler, selector, binding repository, card action, or delivery worker is created
- **THEN** no Portfolio table is read or written
