# Copilot evaluation evidence — 2026-09-26

These three evidence types answer different questions; never combine their
pass counts into one claim about model quality.

## Fixed discovery probes

```sh
pnpm --dir packages/gateway exec tsx scripts/evaluate-copilot-discovery.ts evaluations/discovery-new.json
```

`fixtures/discovery-v1.json` was fixed before the change. It queries the actual
registered catalog, with six development cases and six preselected holdout
cases. It is a lexical retrieval probe, not an LLM-intent evaluation or a blinded
benchmark. Holdout results were not used for further synonym/description tuning.

| Top-3 or correct no-hit | Before | Candidate |
|---|---:|---:|
| Development | 3/6 | 6/6 |
| Holdout | 2/6 | 5/6 |

Reports: `2026-09-26-discovery-baseline.json`,
`2026-09-26-discovery-candidate.json`; matching fixture hash, catalog hashes
recorded independently. The remaining holdout miss is preserved. No live model
calls or monetary-cost measurements are involved.

## Deterministic harness contracts

```sh
pnpm --dir packages/gateway exec tsx scripts/evaluate-copilot-quality.ts evaluations/quality-new.json
```

The runner executes fixed test groups against real SQLite and actual built-in
file tools. Provider responses are synthetic. It covers tool visibility/receipt
recovery, Chinese memory and upgrades, long history, full memory references,
cache wire contracts, multiple source files, bounded overflow, cancellation,
lease changes, DB reopening, approval and no-progress barriers. Report
`2026-09-26-quality-contracts.json`: 85 passing checks across five groups. This is
correctness evidence; it does not measure coding intelligence or token savings.

## Current bounded live evaluator (v2)

```sh
node scripts/run-with-root-env.mjs pnpm --dir packages/gateway exec tsx scripts/evaluate-copilot.ts evaluations/live-new.json
```

Reads configured model metadata/credentials from the existing DB read-only;
uses isolated temporary source, a separate in-memory database and the real
macOS development sandbox. Only synthetic tasks/source are sent. The three
fixtures cover addition, reversed clamp endpoints, and a two-file CommonJS
sum/mean contract. Assertions are installed only after inference, not available
through project-read tools. Candidate paths must exactly match fixture paths.

Each arm allows at most six model invocations and 90 seconds, requests 1,024
output tokens/call, and stops before another invocation at 40,000 reported tokens
or after unknown usage. Final responses can exceed the token threshold, transport
retries can add HTTP requests, and unknown prices are not dollar guarantees.
Baseline gets sources in its prompt; harness must acquire them through tools.
The fixtures, output contract and call ceiling differ from v1, so these are not
matched before/after efficiency results.

| MiniMax-M3 v2 | Baseline | Harness |
|---|---:|---:|
| First repeat: independently checked successes | 2/3 | 2/3 |
| Second repeat: independently checked successes | 2/3 | 2/3 |
| First repeat: model calls | 3 | 6 |
| Second repeat: model calls | 3 | 5 |

Reports: `2026-09-26-live-v2.json`, `2026-09-26-live-v2-repeat.json`.
Both harness repeats passed the two-file fixture. The second sum harness arm
returned a named `add` export without first reading the original source; the
fixed test expected the original callable export and failed. The baseline
multi-file arms reached the requested output-token limit and failed. The first
sum harness failed before producing a checked candidate; that report recorded
only failed status, not a more specific stop reason. Subsequent reporting
preserves run stop reasons and usage even on failure. No failures were removed
and limits were not raised between repeats.

Unknown-usage failures prevent a complete aggregate token comparison for the
first repeat and second baseline. Known reported portions are not total usage.
The second harness reports 8,892 tokens across its three arms. Monetary cost is
unknown. Two repeats of three small fixtures do not establish a product ranking,
model-wide compatibility, prompt-cache savings or live CLI acceptance.
`firstTextMs` is provider first answer text, not a browser paint measurement.

## Retained historical evaluator (v1)

Two single-file fixtures, four calls per arm and the old single-content output
contract. Reports below remain unchanged and are historical evidence only.

| Retained corrected trial, MiniMax-M3 | Baseline | Harness |
|---|---:|---:|
| Independently checked successes | 2/2 | 1/2 |
| Total calls, including unsuccessful arms | 2 | 7 |
| Provider-reported total tokens | 2,105 | 10,612 |
| Total elapsed milliseconds | 5,117 | 8,864 |

Source: `2026-09-26-live.json`. The clamp harness arm stopped at four model calls
without a final candidate. It remains a failure in the report. Sample size is two,
no stochastic repeats or confidence claims. `firstTextMs` measures the provider's
first answer-text delta, not time to the first painted/redacted browser frame.
Costs are unknown; reported tokens include reasoning/cache totals as returned.

The initial `2026-09-26-compatibility-failure.json` retains four failed arms. It
exposed MiniMax content containing reasoning and absent requested streaming usage.
Private reasoning was removed from the report. The client now requests
`reasoning_split` on official MiniMax hosts and `stream_options.include_usage` for
OpenAI-compatible streams. The corrected trial used unchanged fixtures/limits.

Protocol references: [MiniMax OpenAI-compatible API](https://platform.minimax.cn/docs/api-reference/text-chat-openai),
[OpenAI Chat Completions](https://platform.openai.com/docs/api-reference/chat),
[Anthropic cache usage](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

Separate deterministic tests prove exact-approval repair and independent sandbox
retest; this two-arm evaluation does not claim a live-model repair benchmark,
real CLI workflow validation, monetary savings, or an industry product ranking.
