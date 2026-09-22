# Personal and small-team workflows

ForgeBadger supports a trusted local or private-host team. Team members share task
requirements, assignments, comments, committed diffs, verification and review evidence.
Each developer works in a separate managed Git worktree with their own private terminal.
All commands run as the host operating-system account. Project roles are application
permissions, not an OS sandbox; do not use this mode for mutually untrusted users.

## Development tasks

Use **Projects → Project details → Development tasks** for task planning, assignments,
comments and completion. Personal projects use their existing CLI session actions.
Run project tests in the CLI and record results in the task. Manual completion is not
an automatically verified receipt. Member and project permissions live under
**Member management**.

The separate verification settings, command-policy API and automatic verification
executor have been retired. New projects do not need executable/argument/timeout
configuration. Existing delivery attempts and immutable receipts remain readable;
the sections below describe historical managed-delivery recovery and evidence gates.
Previously disabled managed execution cannot be enabled through a replacement setting.
Team-enrolled projects retain their access restrictions; this removal does not grant
members access to another person's private CLI.

## Roles and sharing

| Action | Owner | Developer | Reviewer | Viewer |
|---|---|---|---|---|
| Read tasks, committed diffs and handoff | Yes | Yes | Yes | Yes |
| Comment | Yes | Yes | Yes | No |
| Create/edit tasks; prepare own execution | Yes | Yes | No | No |
| Review a delivery | Yes | No | Yes | No |
| Manage members, archive, integrate | Yes | No | No | No |
| Open a private execution terminal | Only its executor | Only its executor | No | No |

Add members using the email of an existing active local account. This does not send
invitations or email. Reassigning tasks and changing roles are explicit operations.
An active execution must be revoked before changing its developer's role. Revocation
immediately denies further access, then stops the associated process; pending stops
remain visibly pending and retry in the background. Rejoining creates a new membership
epoch and cannot revive old executions. Source and managed paths cannot be re-imported
by another user to bypass membership. Historical workspaces cannot acquire extra
sessions through legacy endpoints.

Preview links and manually attached PR links remain operator supplied. The separate
**Create draft PR** action creates or finds a GitHub draft for an already-pushed branch:
This historical action requires an existing passing receipt for the exact current commit.
It cannot generate a new receipt; use your Git client for new pull requests.
Enter the public GitHub `owner/repository`, existing head/base branches, title/body and
a short-lived repository-scoped token with permission to create pull requests. The
head must equal the verified commit and the remote base must equal the recorded base.
ForgeBadger does not push branches, merge the PR or store the token. The password field
is cleared after submission. Use the private SSH transport below when remote.

A disconnected GitHub response is **unknown**, not failure proof: retry only looks up
the exact repository/head/base/commit and never repeats the POST. If no request can be
found, keep the pending record and inspect GitHub before taking another action. There
is no automatic force-retry. Remote branch heads and PR URLs can change later; the
recorded SHA and verification receipt remain the evidence. Handoff exports requirements,
commits, verification and review records, without terminal history or credentials.

## Evidence and concurrency

Receipts bind the exact clean commit, task content/assignments and verification policy
revision. Editing acceptance criteria through any task API makes old receipts
stale. A green historical receipt does not authorize delivery after changes. Review
records and completed verification receipts are append-only.

Review, draft PR creation and integration use durable operation fences and the same session
lifecycle mutex as terminal launch. Legacy APIs cannot start a competing process during
those operations. Integration persists its intent before writing Git; task, role, policy
and account edits cannot change its authorization mid-write. Restart reconciliation
checks actual Git results and never blindly repeats a merge.

## Recovery and cleanup

**Recover** creates a new worktree from the run's recorded base commit. It preserves
the old workspace, including uncommitted files. Committed work remains on the old
`codex/task-*` branch; explicitly inspect/cherry-pick it into the new workspace if needed.
This is checkpoint recovery, not a replay of an AI conversation. Missing worktrees still
show durable task/evidence records and can be recovered when a base was recorded.

**Reconcile latest base** stops the old private execution and creates a new worktree
from the current source branch HEAD, merging only the explicitly selected old commit.
Old uncommitted files and the old branch remain intact; they are not implicitly copied.
A true merge conflict produces a ready private workspace with a conflict-file list.
Open its terminal to resolve and commit the merge, and test/review through your CLI
and Git workflow. Prior receipts are not inherited; the retired executor cannot issue
fresh evidence for the managed integration action. Git failures, missing commits
and authorization changes fail closed. Source files are never checked out or reset.

**Close** stops execution and removes only a clean worktree. Dirty or ignored files are
retained and reported. Branches are retained. **Archive** disables execution and waits
for pending stops before hiding the source project. Physical deletion of projects,
sessions or tasks with delivery history is rejected to protect evidence. Session/project deletion also fails while a durable runtime stop confirmation is pending, including error-status sessions. Account or project cascades cannot erase that proof; retry after the original runtime confirms its stop.

No new verification supervisor is launched. For a supervisor started by an older
version, the recovery client can authenticate and request cancellation, and requires
persisted exit confirmation. Restart never treats an unknown result as passed.
If both Gateway and supervisor die, or identity files are missing/corrupt, the workspace
stays fenced until an operator establishes that no old process can write there. Never
clear a fence merely because a PID or time interval looks old. A host restart followed
by explicit inspection/repair of the retained evidence is the conservative recovery
path for such unresolved states; this version does not offer a force-unlock button.

Git locks record owner and child state. Locks whose owner and recorded child are known
exited can be reclaimed; live or ambiguous spawn states remain blocked for operator
inspection. Never delete `.git/forgebadger-collaboration.lock` while a writer may live.

Legacy verification recovery retains unknown-state and authenticated-cancellation checks.
This does not clear the existing Windows/ConPTY or external provider/trial evidence gates.

## Backups and rollout

Use `forgebadger backup --output <new-directory>` and
`forgebadger restore --from <backup-directory> --to <fresh-state-directory>`.
See the root README's **Backup and restore** section for exact scope. Keep backups private:
they contain the master key needed to decrypt stored credentials. Restore invalidates
login sessions. Backup does not include repositories, managed worktree files, CLI login
state, running terminals or every external config backup. Back up source/workspace trees
separately before host changes. Never restore over a running instance.

Migration `0087_personal_team_delivery` adds collaboration data without converting private
projects into shared projects. Sharing and execution remain explicit owner choices.

## Team administration

Use **Member management → Members and invitations** to manage organizations and explicitly enroll existing personal projects,
and invite people by email. An invite grants team membership; project grants separately
control reading, development and review. Team owners and admins can manage tasks,
policies and members, but administrative status alone does not grant private terminal
access or developer/reviewer execution capabilities. UI controls use server-returned
capabilities. System-wide account administrators use **Member management → Accounts**; that role remains separate.

The invitation link is shown once and is shared by the administrator; no email is sent.
Links are single-use, expire and are bound to the exact invited email. Existing active
accounts can accept after login. New account registration respects the host registration
policy: `off` blocks new accounts even with a team invitation. Initial host/bootstrap
registration still uses the local recovery-key mechanism. Revoked, expired and stale
issuer invitations cannot be accepted.

For departures, preview affected projects, assigned/reviewer tasks and private executions;
choose each required handoff, create the expiring plan, then explicitly confirm it.
Access is revoked immediately; process cleanup may remain pending. Resume a pending
plan after correcting an unavailable runtime or ambiguous Git/verification process.
If a replacement member becomes ineligible, use **Revise handoff** to review fresh impact,
confirm new targets and then resume. The departing member remains denied throughout;
concurrent revisions cannot finalize an older handoff.
Completion requires confirmed cleanup and applies the recorded handoffs. Transfer team
ownership before the owner leaves. Keep at least one owner; admins cannot remove another
admin or the owner. Project stewardship can transfer without rewriting historical tenant
keys, and disabling the original storage owner does not disable the successor's project.
Removed members cannot regain old terminals or review authority simply by joining again.

System administrators can create account invitation codes, disable/re-enable accounts
and reset passwords in **Members**. A password reset invalidates old access tokens,
browser sessions and authenticated WebSockets; it does not terminate CLI processes.
Use disable/offboarding for process revocation. Owner obligations must be handed off
before disabling accounts that still own teams/projects.

## Encrypted access from another computer

The supported private-host topology keeps Gateway and Web on loopback and forwards
both over each member's authenticated SSH connection. Do not bind the Gateway to a
public interface or enable broad Origins just to reach it. On the host use
`FORGEBADGER_HOST=127.0.0.1`, `FORGEBADGER_PORT=48731`,
`FORGEBADGER_WEB_HOST=127.0.0.1`, `FORGEBADGER_WEB_PORT=48732`, and build Web with
`NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:48731`. Each member runs:

```sh
ssh -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:48731:127.0.0.1:48731 \
  -L 127.0.0.1:48732:127.0.0.1:48732 teammate@your-private-host
```

Open `http://127.0.0.1:48732` locally and use an individual ForgeBadger account. Verify
the host key through your normal trusted channel; use distinct SSH keys. Restrict the
SSH account to the permitted forwarding destinations when shell access is unnecessary.
The same local ports on different members' computers do not collide. If those ports
are occupied locally, stop the conflicting local service or choose a coordinated host
configuration and rebuild Web; forwarding only the Web port leaves API/WS unreachable.
Keep the SSH connection open; reconnect it before reconnecting the browser.

Team invite links generated from this address work after the member starts the tunnel.
Keep token-bearing invitations private. Normal tokens travel inside SSH even though
the browser talks HTTP to its own loopback. This release does not claim arbitrary HTTPS
reverse-proxy Origin support, enterprise SSO, host-account sandboxing or a multi-host
terminal cluster. A two-device SSH/host-key onboarding exercise remains an operator
acceptance check; loopback browser tests cannot prove a real remote network path.

## Historical backup compatibility

Backup and restore reconstruct the exact known migration prefix and compare all business
schema tables, indexes, triggers and views. A known historical SQL hash difference is
accepted only when that structure matches; original ledger hashes are never rewritten.
Unknown/future/duplicate/reordered migrations and structural drift are rejected. This
proves structural compatibility, not the historical semantics of every data migration.
SQLite integrity, foreign keys, encrypted cells, file hashes and manifest checks remain
mandatory. Restore invalidates browser login sessions. Keep repository/worktree backups
alongside the private instance backup, and rehearse restoration into a fresh directory.

## Session Server capability during upgrade

Managed team execution requires the negotiated `confirmed_stop_v1` capability. Older
Session Servers may acknowledge a stop before the process actually exits, so absence
from their session list is not sufficient evidence to complete an offboarding handoff.
When the running daemon lacks this capability, Development tasks explicitly disables prepare,
recover and reconciliation while preserving existing ordinary terminal access. Team and
account administration remain available.

Keep existing CLI work running until its owner finishes it normally. Upgrade the Session
Server only in a maintenance window after all existing terminal work has ended; restarting
the daemon terminates its remaining CLI processes. Updating/restarting Gateway or Web
alone intentionally keeps that old daemon alive and therefore does not activate the new
managed-execution capability. Do not remove its socket, token or PID file as a shortcut.

A capable POSIX daemon binds stop confirmation to the original launch identity and checks
both the PTY leader and its process group. Unknown exit, IPC loss or a surviving group
keeps the handoff pending; neither a missing registry entry nor a stale PID establishes
success. If the leader is gone but its group survives, inspect and finish that retained
work before resuming. Deliberately detached processes outside the managed group are not
an OS-isolation guarantee. Native Windows confirmation remains unavailable until its
containment and physical evidence requirements are met.


## One task interface

Development tasks in project details is the single task-management entry point. Existing
boards, stages, priorities, dependencies and work-item IDs are retained. Task details
include execution attempts, committed changes, verification/review, comments and selected
Copilot artifact summaries. **Member management → Project access** holds project grants. The verification configuration dialog and its backend executor are removed. Organization
and account operations share the Member management entry; their permission scopes
remain distinct. The former mixed Members and execution settings project tab is removed.
Legacy `/teams` links redirect into Member management.
Legacy `/workspaces` URLs redirect to Projects; project-specific URLs redirect to the
same project's Development tasks tab and preserve a selected task where provided.

Project access context is loaded before private modules. Shared readers do not receive
private session IDs, filesystem paths, raw CLI configuration or terminal attach tokens.
Developer/reviewer/viewer capabilities are enforced server-side, including old task
routes; system account administration does not grant access to private projects.

Every shared task mutation carries an expected revision. Stale edits fail with a refresh
requirement; a stale item in a batch rejects the entire batch. A separate monotonic
semantic revision tracks actual task requirements and assignments. Editing A to B and
back to A does not revive old verification or human approval. Routine progress, priority
and display-stage updates do not invalidate an otherwise matching receipt.

A manual task completion records the reason, actor and time. It does not create a passed
verification, accepted review or merged commit. Technical delivery evidence remains bound
to its exact execution and commit. Existing manual tasks need not create an AI execution.

## Copilot artifact references

A task can explicitly reference an existing Copilot artifact owned by the current actor
in that same project. Sharing requires a deliberate summary-sharing action and current
task-edit authority. Other authorized task readers receive only the artifact ID, digest,
status at association time and file/check counts. Private goals, paths, patches and
stdout/stderr are not shared by this operation. Opening the original artifact still
requires its original private-project authority.

The reference's `current` flag means its task-content binding and artifact digest still
match; it is not a claim that the current source tree passes tests. The displayed status
is the association-time snapshot, not a live Copilot state. A stale reference remains in
history; relinking the same output against changed requirements is rejected. Generate a
new matching artifact to attach a new reference. Referenced artifacts are retained by a
foreign-key restriction; deleting the owning work item removes its reference rows.
Association never accepts the artifact, completes the task, writes source files or merges
code. Copilot's existing explicit approval and sandbox boundaries remain in force.
