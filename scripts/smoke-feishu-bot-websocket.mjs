import { pathToFileURL } from "node:url";

const DEFAULT_GATEWAY_URL = "http://127.0.0.1:48731";
const EVENT_SUBSCRIPTION = "im.message.receive_v1";

export function resolveFeishuBotWebSocketSmokeConfig(env = process.env, argv = process.argv.slice(2)) {
  env = normalizeEnvironment(env);
  const args = parseArgs(argv);
  const gatewayUrl = nonEmpty(args["gateway-url"]) ?? nonEmpty(env.FORGEBADGER_GATEWAY_URL) ?? DEFAULT_GATEWAY_URL;
  const token = nonEmpty(args.token) ?? nonEmpty(env.FORGEBADGER_TOKEN);
  if (!token) return { ok: false, reason: "FORGEBADGER_TOKEN or --token is required" };

  return {
    ok: true,
    config: {
      gatewayUrl,
      token,
      chatId: nonEmpty(args["chat-id"]) ?? nonEmpty(env.FORGEBADGER_FEISHU_SMOKE_CHAT_ID) ?? "oc_forgebadger_smoke",
      feishuUserId: nonEmpty(args["feishu-user-id"]) ?? nonEmpty(env.FORGEBADGER_FEISHU_SMOKE_USER_ID) ?? "ou_forgebadger_smoke",
      command: nonEmpty(args.command) ?? "/forgebadger status",
      connectionId: nonEmpty(args["connection-id"]) ?? `of-feishu-ws-smoke-${Date.now()}`
    }
  };
}

function normalizeEnvironment(env) {
  const normalized = { ...env };
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("OPENFORGE_") || value === undefined) continue;
    normalized[`FORGEBADGER_${name.slice("OPENFORGE_".length)}`] ??= value;
  }
  return normalized;
}

export function buildFeishuBotWebSocketFixtureEvent(input) {
  return {
    schema: "2.0",
    header: {
      event_id: input.eventId,
      event_type: EVENT_SUBSCRIPTION
    },
    event: {
      sender: {
        sender_id: {
          open_id: input.feishuUserId
        }
      },
      message: {
        message_id: input.messageId,
        chat_id: input.chatId,
        message_type: "text",
        content: JSON.stringify({ text: input.text })
      }
    }
  };
}

export async function runFeishuBotWebSocketSmoke(input) {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return buildFeishuBotWebSocketSmokeReport({
      gatewayUrl: input.gatewayUrl,
      checks: [{
        name: "fetch_available",
        httpStatus: 0,
        ok: false,
        errorCode: "fetch_unavailable",
        replyPreview: "Global fetch is unavailable in this Node runtime."
      }]
    });
  }

  const connectionId = input.connectionId ?? `of-feishu-ws-smoke-${Date.now()}`;
  const baseEvent = {
    chatId: input.chatId,
    feishuUserId: input.feishuUserId
  };
  const checks = [];

  checks.push(await postConnectionEvent(input, fetchImpl, {
    state: "connected",
    connectionId,
    attempt: 0,
    eventSubscription: EVENT_SUBSCRIPTION
  }));
  checks.push(await postBotEvent(input, fetchImpl, {
    name: "receive_route",
    event: buildFeishuBotWebSocketFixtureEvent({
      ...baseEvent,
      text: input.command ?? "/forgebadger status",
      eventId: `${connectionId}-receive`,
      messageId: `${connectionId}-receive`
    })
  }));
  checks.push(await postBotEvent(input, fetchImpl, {
    name: "terminal_input_rejected",
    event: buildFeishuBotWebSocketFixtureEvent({
      ...baseEvent,
      text: "/forgebadger terminal session-1 continue",
      eventId: `${connectionId}-terminal`,
      messageId: `${connectionId}-terminal`
    })
  }));
  checks.push(await postConnectionEvent(input, fetchImpl, {
    state: "reconnecting",
    connectionId,
    attempt: 1,
    eventSubscription: EVENT_SUBSCRIPTION,
    reason: "fixture reconnect smoke"
  }));
  checks.push(await postConnectionEvent(input, fetchImpl, {
    state: "reconnected",
    connectionId: `${connectionId}-reconnected`,
    attempt: 2,
    eventSubscription: EVENT_SUBSCRIPTION
  }));

  return buildFeishuBotWebSocketSmokeReport({
    gatewayUrl: input.gatewayUrl,
    checks
  });
}

export function buildFeishuBotWebSocketSmokeReport(input) {
  const checks = input.checks.map((check) => sanitizeCheck(check));
  return {
    ok: checks.every((check) => check.ok),
    mode: "authenticated_gateway_fixture",
    gateClearingEvidence: false,
    publicCallbackRequired: false,
    gatewayUrl: redactSmokeText(input.gatewayUrl),
    eventSubscription: EVENT_SUBSCRIPTION,
    checks,
    caveat: "This authenticated Gateway fixture smoke does not clear FEISHU-BOT-WS; a real Feishu bot persistent-connection run is still required."
  };
}

async function postConnectionEvent(input, fetchImpl, event) {
  const result = await postJson(fetchImpl, endpoint(input.gatewayUrl, "/api/v1/integrations/feishu/bot-websocket/connection-events"), input.token, event);
  const connection = isRecord(result.body?.data) && isRecord(result.body.data.connection)
    ? result.body.data.connection
    : {};
  return {
    name: `connection_${event.state}`,
    httpStatus: result.httpStatus,
    ok: result.httpStatus >= 200 && result.httpStatus < 300 && result.body?.code === 0,
    state: typeof connection.state === "string" ? connection.state : event.state,
    errorCode: readErrorCode(result.body)
  };
}

async function postBotEvent(input, fetchImpl, check) {
  const result = await postJson(fetchImpl, endpoint(input.gatewayUrl, "/api/v1/integrations/feishu/bot-websocket/events"), input.token, {
    event: check.event
  });
  const data = isRecord(result.body?.data) ? result.body.data : {};
  const details = isRecord(result.body?.details) ? result.body.details : {};
  const replyPlan = isRecord(data.replyPlan) ? data.replyPlan : undefined;
  const route = typeof data.route === "string" ? data.route : undefined;
  const rejectionCode = typeof details.code === "string" ? details.code : undefined;
  const expectedTerminalReject = check.name === "terminal_input_rejected" && rejectionCode === "feishu_terminal_input_rejected";
  return {
    name: check.name,
    httpStatus: result.httpStatus,
    ok: expectedTerminalReject || (result.httpStatus >= 200 && result.httpStatus < 300 && result.body?.code === 0),
    ...(route ? { route } : {}),
    ...(rejectionCode ? { rejectionCode } : {}),
    ...(replyPlan && typeof replyPlan.text === "string" ? { replyPreview: replyPlan.text } : {}),
    errorCode: readErrorCode(result.body)
  };
}

async function postJson(fetchImpl, url, token, body) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: bearerToken(token),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  let parsedBody;
  try {
    parsedBody = await response.json();
  } catch {
    parsedBody = undefined;
  }
  return {
    httpStatus: response.status,
    body: parsedBody
  };
}

function sanitizeCheck(check) {
  return Object.fromEntries(
    Object.entries(check)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => [key, typeof value === "string" ? redactSmokeText(value) : value])
  );
}

function readErrorCode(body) {
  return isRecord(body?.details) && typeof body.details.code === "string"
    ? body.details.code
    : undefined;
}

function redactSmokeText(text) {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9._-]+/giu, "[REDACTED]")
    .replace(/\btoken\s+[A-Za-z0-9._~+/=-]+/giu, "token [REDACTED]")
    .replace(/\bapp[_-]?secret(\s*[:=]\s*)[^\s,;]+/giu, "app_secret$1[REDACTED]")
    .replace(/\bo[cu]_[A-Za-z0-9._-]+/gu, (match) => `${match.slice(0, 4)}...[REDACTED]`);
}

function endpoint(gatewayUrl, path) {
  return `${gatewayUrl.replace(/\/+$/u, "")}${path}`;
}

function bearerToken(token) {
  return token.trim().toLowerCase().startsWith("bearer ") ? token.trim() : `Bearer ${token.trim()}`;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item?.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = "true";
    }
  }
  return result;
}

function nonEmpty(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

async function main() {
  const resolved = resolveFeishuBotWebSocketSmokeConfig();
  if (!resolved.ok) {
    console.error(JSON.stringify({ ok: false, reason: resolved.reason, gateClearingEvidence: false }, null, 2));
    process.exitCode = 1;
    return;
  }

  const report = await runFeishuBotWebSocketSmoke(resolved.config);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (isMainModule()) {
  await main();
}
