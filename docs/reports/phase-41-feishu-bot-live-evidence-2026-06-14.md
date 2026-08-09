# Feishu Bot Long-Connection Evidence Report

Generated: 2026-06-14T15:58:13.520Z
Commit: e84f5b9
Source report: docs/reports/phase-41-feishu-bot-live-evidence-2026-06-14.json

## Gate Review Status

- Gate: `FEISHU-BOT-WS`
- Registry status before review: `FEISHU-BOT-WS=Caveat`
- Audit result: ready for maintainer review
- Report gate-clearing marker: true
- Report generator gate-clearing marker: false
- Public callback required: false
- Event subscription: `im.message.receive_v1`

This report summarizes a saved, audited Feishu bot long-connection smoke output.
It does not update `docs/EXTERNAL-EVIDENCE-GATES.md` and does not by itself
move `FEISHU-BOT-WS` to `Pass`; a maintainer must review and link the
artifact before any registry state change.

## Evidence Summary

- Received events: 3
- Accepted bounded commands: 2
- Bounded replies sent: 3
- Terminal input rejections: 1
- Reconnect observations: 1
- Reply failures: 0
- Gateway URL summary: http://127.0.0.1:48731
- Duration ms: 600000
- Max events: 3

## Check Summary

- `connection_connected`: ok state=connected
- `receive_route`: ok route=status
- `bounded_reply_sent`: ok msgType=text receiveIdType=chat_id
- `terminal_input_rejected`: ok rejection=feishu_terminal_input_rejected
- `rejection_reply_sent`: ok msgType=text receiveIdType=chat_id
- `connection_reconnecting`: ok state=reconnecting
- `connection_reconnected`: ok state=reconnected
- `receive_route`: ok route=status
- `bounded_reply_sent`: ok msgType=text receiveIdType=chat_id

## Redaction And Storage Boundary

- This report is not raw Feishu event storage.
- Raw event bodies, WebSocket frames, signatures, nonces, private chat content,
  app secrets, verification tokens, encrypt keys, provider keys, JWTs, and
  attach tokens are not included.
- Chat and user identifiers must remain shortened or redacted in the source
  JSON report before this Markdown is linked.

## Recommended Maintainer Decision

- If the source report is attached, audit output is preserved, and the
  observations match the gate clearing condition, maintainer may consider
  moving `FEISHU-BOT-WS` from `Caveat` to `Pass`.
- If any live prerequisite is missing, keep `FEISHU-BOT-WS` as `Caveat`
  and record the missing external evidence.
