# Claude Code Best Practice Template

This directory contains a public, reusable Claude Code project template copied
from the local ForgeBadger development `.claude` scaffold.

The files are stored under `files/dot-claude/` instead of a repository-root
`.claude/` directory so they do not collide with ForgeBadger's own local
development configuration.

When materialized into a user project, map:

```text
templates/claude-code-best-practice/files/dot-claude/* -> .claude/*
```

The template includes:

- project memory scaffold
- role-based agent definitions
- security, API, backend, frontend, and testing rules
- plan, review, verify, and commit workflow notes
- hook and prompt examples

Do not put personal Claude Code settings, credentials, machine-local paths, or
API keys in this template.
