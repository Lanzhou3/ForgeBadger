# Phase 22 Operator Trial Dry Run

> Scope: v1.5 maintainer/operator dry-run for first-user trial operations.
> This is not completed first-user feedback and does not clear external gates.

## Summary

Phase 22 ran the v1.5 trial path from the maintainer/operator side on the
current host. The dry-run verified dependency collection, source startup health,
provider-smoke behavior without a disposable credential, cleanup, and feedback
packet wording. It also found one source-startup operational issue: package
scripts source the repository root `.env` inside the script, so command-prefix
environment overrides can be replaced by `.env` values.

No external evidence gate moved to `Pass`.

| Gate | State After Dry Run | Reason |
|------|---------------------|--------|
| `LIVE-PROVIDER` | Caveat | Provider smoke ran, but no disposable provider credential was configured; result was `missing_provider_credential`. |
| `WINDOWS-WSL` | Caveat | Current host is Linux `not_wsl`; no physical Windows/WSL terminal run occurred. |
| `FEISHU-CALLBACK` | Blocked | No public HTTPS Gateway route or Feishu developer-console URL verification occurred. |
| `FIRST-USER-FEEDBACK` | Caveat | This report is an operator dry-run, not a real first-user packet. |

## Environment Evidence

| Item | Result |
|------|--------|
| Commit | `80e0af9` |
| Host | `Linux 6.8.0-107-generic x86_64 GNU/Linux` |
| WSL probe | `not_wsl`; `rg -i microsoft /proc/version` returned no match |
| Node | `v24.14.1` |
| pnpm | `10.33.2` |
| tmux | `tmux 3.4` |
| Claude Code | `2.1.152 (Claude Code)` |
| OpenCode | `1.15.4` |
| Codex CLI | `codex-cli 0.134.0`; command printed a non-blocking PATH update warning |
| OpenForge doctor | `tmux`, `claude`, `opencode`, and `codex` all `ok`; terminal mode `native_tmux` |

`node packages/cli/dist/index.js doctor` returned exit code 0 and:

```text
OpenForge state: /root/.openforge
ok tmux tmux 3.4
ok claude 2.1.152 (Claude Code)
ok opencode 1.15.4
ok codex codex-cli 0.134.0
terminal native_tmux - tmux is available for persistent browser terminals.
```

## Source Startup Health

Temporary Gateway and Web dev processes were started for the dry-run:

- Gateway command shape:
  `pnpm --dir packages/gateway dev` with loopback port `48731`.
- Web command shape:
  `pnpm --dir packages/web dev` with loopback port `48732`.

Observed results:

| Check | Result |
|-------|--------|
| Gateway start log | `gateway.start` on `127.0.0.1:48731` |
| Web start log | Next.js 16.2.4 ready on `http://127.0.0.1:48732` |
| `GET /api/v1/health` | HTTP 200, `{"code":0,"data":{"status":"ok"},"message":""}` |
| `HEAD /login` | HTTP 200, `text/html; charset=utf-8` |
| unauthenticated `GET /api/v1/dashboard/health` | HTTP 401; expected protected endpoint behavior |
| cleanup | dry-run Gateway/Web PIDs were stopped; both ports stopped responding afterwards |

## Provider Smoke

Command:

```bash
pnpm smoke:copilot-provider
```

Sandbox note: the first sandboxed attempt failed before product logic because
`tsx` could not open its IPC listener. The command was rerun outside the
sandbox for evidence.

Result:

```json
{
  "ok": true,
  "status": "skipped",
  "reason": "missing_provider_credential"
}
```

Gate impact: `LIVE-PROVIDER` remains `Caveat`. This is useful operator
evidence for the collection path, but it is not a live provider pass.

## Finding

| ID | Severity | Surface | Finding | Disposition | Owner | Follow-up |
|----|----------|---------|---------|-------------|-------|-----------|
| P22-01 | medium | source startup / docs | Prefixing `pnpm --dir packages/gateway dev` with temporary environment values does not isolate state when the script sources repository `.env` afterwards; in this run, no `/tmp/openforge-phase22-dryrun.sqlite` file was created because the root `.env` provided the configured local DB path. | docs or support gap | maintainer/operator | Document that source fallback uses root `.env`, or use a direct command path when an isolated dry-run database is required. |

## Feedback Packet Check

`docs/TRIAL-CHECKLIST.md` was updated so every `pass with caveats` or
`blocked` result asks for the full v1.5 packet shape:

- affected surface;
- severity;
- owner;
- disposition;
- next action or no-action rationale;
- evidence needed to clear the status;
- follow-up route, phase, or issue;
- redaction review.

## Secret Safety

This report records bounded command names, versions, statuses, and redacted
results only. It does not include provider keys, JWTs, attach tokens, private
keys, `.env` contents, local databases, raw terminal transcripts, provider
payloads, Feishu bodies, callback signatures, or browser auth token values.

## Next Work

Collect a real first-user trial packet through `docs/TRIAL-FEEDBACK.md` or the
`OpenForge first-user trial feedback` GitHub issue form. Keep all external
gates caveated or blocked until the required real artifacts in
`docs/EXTERNAL-EVIDENCE-GATES.md` exist.
