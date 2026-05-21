# Research Summary: v1.2 Project Manager Web Workflow

**Date:** 2026-05-21
**Mode:** Inline brownfield research
**Milestone:** v1.2 Project Manager Web Workflow

## Stack Additions

No new runtime stack is required. The milestone should reuse the existing Next.js App Router, TanStack Query, shadcn/ui, Tailwind, lucide-react, and the Gateway REST API client in `packages/web/src/lib/api.ts`.

## Existing Assets

- Gateway project-manager REST routes already exist under `/api/v1/projects/:projectId/project-manager`.
- `docs/API.md` defines the tenant-scoped project-manager contract, allowed statuses, transition rules, evidence-reference fields, ledger event types, and sensitive-data exclusions.
- `ProjectManagerRepository` already persists goals, work items, evidence references, ledger events, and redacted audit rows.
- Copilot read tools already expose bounded project-manager state without write authority.
- The Web project detail page already has the right product context and tabbed structure for adding a project-manager surface.

## Feature Table Stakes

- Project detail page exposes the project goal, work item list, status counts, and recent ledger markers.
- Users can update the goal summary, constraints, acceptance criteria, and status.
- Users can create work items with title, description, priority, acceptance criteria, and optional initial references.
- Users can filter work items by bounded status and inspect item details.
- Users can change status through allowed transitions, with `done` requiring evidence references or a manual completion reason.
- Users can attach structured evidence references without uploading or pasting raw terminal, Feishu, provider, or secret-bearing content.
- Users can review the ledger timeline as safe event markers with counts and timestamps only.

## Architecture Notes

- Keep Gateway/Web ownership split: do not add Next.js API routes.
- Add typed Web client functions around the existing Gateway endpoints instead of duplicating route logic in components.
- Prefer a project-detail tab or route that keeps project context visible and avoids a separate global project-manager area in v1.2.
- Reuse existing shadcn UI primitives and dense operational layout patterns already used by project/session/settings pages.
- Preserve the existing approval boundary: Feishu text and Copilot model output do not mutate project-manager state directly.

## Watch Outs

- Do not make evidence references raw evidence storage. They are bounded pointers only.
- Do not let UI imply Feishu, terminal, or Copilot has write authority over the ledger.
- Do not hide transition errors. Invalid transitions and missing evidence for `done` are part of the user workflow.
- Do not overbuild project management. v1.2 is a lightweight local-first control-plane workflow, not Jira/Linear replacement.
- Keep E2E mocks strict enough to fail on unknown project-manager endpoints.
