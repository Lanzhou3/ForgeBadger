# ADR 0002: trusted-host personal and team delivery

Status: Implemented in the personal/team workflow change, pending release acceptance.

## Decision

Keep private projects, AI terminals and host credentials private. Add a dedicated
collaboration facade whose actor-scoped authority check produces an owner-scoped
repository context. Never impersonate the owner by rewriting the request principal.
An owner chooses project execution policy and adds registered local users with explicit
capabilities. This is a trusted-host product boundary, not multi-tenant OS isolation.

Use durable run identities and separate Git worktrees. Every run records source/task,
executor, membership epoch, actor-owned backing project/session, base and branch before
provisioning. Path guards cover legacy create/import, process launch and terminal input;
managed execution cannot acquire untracked aliases or additional terminals.

Verify clean exact commits with explicit bounded commands. Persist immutable receipts
bound to task digest and policy revision, and separate independent review records.
Use a session mutex plus persistent operation fence; before merge, revalidate the full
authorization/evidence fingerprint and freeze mutable inputs. Perform only explicit
fast-forward integration, preserving dirty files and source branch identity.

A verification supervisor owns process-group cleanup and a private authenticated control
endpoint. Gateway restart may recover a confirmed exit, but cannot infer exit from a
stale PID. Unknown supervision remains fenced. Git intent and lease state are durable;
reconcile actual HEAD after interrupted integration without replaying it.

## Consequences

SQLite tenant isolation alone is insufficient: canonical filesystem overlap, membership
epochs, legacy platform commands and Session Server operations must share guards.
Completed work remains attributable to its actual actor. Physical deletion with delivery
history is restricted; archive is the normal lifecycle operation. Backup includes SQLite
and required instance keys, while repositories/worktrees require separate backup.

No new app-server protocol, Web prompt submission, agent autonomy, hosted deployment,
SSO/billing, remote PR mutation or realtime co-editing is introduced. Host configuration
continues to be global per CLI. Native Windows command verification remains unsupported
until process-tree containment has physical acceptance evidence.
