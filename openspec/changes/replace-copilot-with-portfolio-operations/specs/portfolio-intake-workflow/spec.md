## ADDED Requirements

### Requirement: Portfolio intake is unavailable
The product MUST NOT expose Portfolio request intake, dossiers, work items, timelines, or owner-decision operations. Existing Project Manager behavior remains independent.

#### Scenario: User manages project work
- **WHEN** a user opens the existing Project Manager workflow
- **THEN** it uses Project Manager APIs and records only
- **THEN** it does not import, dual-write, or project Portfolio state
