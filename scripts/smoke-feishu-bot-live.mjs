import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_GATEWAY_URL = "http://127.0.0.1:48731";
const DEFAULT_DURATION_MS = 120_000;
const DEFAULT_MAX_EVENTS = 2;
const EVENT_SUBSCRIPTION = "im.message.receive_v1";

export function resolveFeishuBotLiveConfig(env = process.env, argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const token = nonEmpty(args.token) ?? nonEmpty(env.OPENFORGE_TOKEN);
  const appId = nonEmpty(args["app-id"]) ?? nonEmpty(env.FEISHU_APP_ID) ?? nonEmpty(env.LARK_APP_ID);
  const appSecret = nonEmpty(args["app-secret"]) ?? nonEmpty(env.FEISHU_APP_SECRET) ?? nonEmpty(env.LARK_APP_SECRET);
  const missing = [];
  if (!token) missing.push("OPENFORGE_TOKEN or --token");
  if (!appId) missing.push("FEISHU_APP_ID/LARK_APP_ID or --app-id");
  if (!appSecret) missing.push("FEISHU_APP_SECRET/LARK_APP_SECRET or --app-secret");
  if (missing.length > 0) {
    return { ok: false, reason: `${missing.join(", ")} is required` };
  }

  const requireGateEvidence = readBoolean(args["require-gate-evidence"], env.OPENFORGE_FEISHU_REQUIRE_GATE_EVIDENCE);
  return {
    ok: true,
    config: {
      gatewayUrl: nonEmpty(args["gateway-url"]) ?? nonEmpty(env.OPENFORGE_GATEWAY_URL) ?? DEFAULT_GATEWAY_URL,
      token,
      appId,
      appSecret,
      domain: nonEmpty(args.domain) ?? nonEmpty(env.OPENFORGE_FEISHU_DOMAIN) ?? "feishu",
      durationMs: readPositiveInteger(args["duration-ms"], env.OPENFORGE_FEISHU_LIVE_DURATION_MS, DEFAULT_DURATION_MS),
      maxEvents: readPositiveInteger(args["max-events"], env.OPENFORGE_FEISHU_LIVE_MAX_EVENTS, DEFAULT_MAX_EVENTS),
      outputPath: nonEmpty(args.output) ?? nonEmpty(env.OPENFORGE_FEISHU_LIVE_REPORT_PATH),
      sendReplies: !hasFlag(args, "no-send-replies") && readBoolean(args["send-replies"], env.OPENFORGE_FEISHU_SEND_REPLIES, true),
      requireReconnect: readBoolean(args["require-reconnect"], env.OPENFORGE_FEISHU_REQUIRE_RECONNECT, requireGateEvidence),
      wsPingTimeout: readPositiveInteger(args["ws-ping-timeout"], env.OPENFORGE_FEISHU_WS_PING_TIMEOUT, 0) || undefined,
      requireGateEvidence
    }
  };
}

export async function runFeishuBotLiveSmoke(input) {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return buildFeishuBotLiveSmokeReport(input, {
      checks: [failedCheck("fetch_available", "fetch_unavailable", "Global fetch is unavailable in this Node runtime.")],
      counts: emptyCounts()
    });
  }

  let sdk;
  try {
    sdk = input.sdk ?? await loadLarkSdk();
  } catch (error) {
    return buildFeishuBotLiveSmokeReport(input, {
      checks: [failedCheck("lark_sdk_available", "lark_sdk_unavailable", error instanceof Error ? error.message : String(error))],
      counts: emptyCounts()
    });
  }

  const counts = emptyCounts();
  const checks = [];
  const pending = [];
  let completeRun = () => {};
  const completion = new Promise((resolve) => {
    completeRun = resolve;
  });
  const timer = setTimeout(completeRun, input.durationMs ?? DEFAULT_DURATION_MS);

  const enqueue = (promise) => {
    pending.push(Promise.resolve(promise).then((check) => {
      if (check) checks.push(check);
    }).catch((error) => {
      checks.push(failedCheck("connection_event_record", "connection_event_failed", errorMessage(error)));
    }));
  };

  const client = new sdk.Client({
    appId: input.appId,
    appSecret: input.appSecret,
    domain: resolveLarkDomain(sdk, input.domain),
    loggerLevel: sdk.LoggerLevel?.info,
    source: "openforge-feishu-live-smoke"
  });

  const wsClient = new sdk.WSClient({
    appId: input.appId,
    appSecret: input.appSecret,
    domain: resolveLarkDomain(sdk, input.domain),
    loggerLevel: sdk.LoggerLevel?.info,
    source: "openforge-feishu-live-smoke",
    handshakeTimeoutMs: Math.min(input.durationMs ?? DEFAULT_DURATION_MS, 30_000),
    ...(input.wsPingTimeout ? { wsConfig: { pingTimeout: input.wsPingTimeout } } : {}),
    onReady: () => {
      counts.connected += 1;
      enqueue(postConnectionEvent(input, fetchImpl, {
        state: "connected",
        connectionId: `of-feishu-live-${Date.now()}`,
        attempt: 0,
        eventSubscription: EVENT_SUBSCRIPTION
      }));
    },
    onReconnecting: () => {
      counts.reconnecting += 1;
      enqueue(postConnectionEvent(input, fetchImpl, {
        state: "reconnecting",
        connectionId: `of-feishu-live-${Date.now()}`,
        attempt: counts.reconnecting,
        eventSubscription: EVENT_SUBSCRIPTION,
        reason: "official SDK reconnect callback"
      }));
    },
    onReconnected: () => {
      counts.reconnected += 1;
      enqueue(postConnectionEvent(input, fetchImpl, {
        state: "reconnected",
        connectionId: `of-feishu-live-${Date.now()}`,
        attempt: counts.reconnected,
        eventSubscription: EVENT_SUBSCRIPTION
      }));
    },
    onError: (error) => {
      checks.push(failedCheck("ws_client", "lark_ws_client_error", errorMessage(error)));
      completeRun();
    }
  });

  const eventDispatcher = new sdk.EventDispatcher({}).register({
    [EVENT_SUBSCRIPTION]: async (data) => {
      await handleLiveFeishuEvent({
        data,
        client,
        input,
        fetchImpl,
        checks,
        counts
      });
      if (counts.receivedEvents >= (input.maxEvents ?? DEFAULT_MAX_EVENTS)) {
        completeRun();
      }
    }
  });

  process.on("SIGUSR1", () => {
    try {
      const wsInstance = wsClient.wsConfig?.getWSInstance?.();
      if (wsInstance) {
        wsInstance.terminate();
      } else {
        wsClient.close?.({ force: true });
      }
    } catch (error) {
      checks.push(failedCheck("reconnect_signal", "reconnect_signal_failed", errorMessage(error)));
    }
  });

  const startPromise = Promise.resolve(wsClient.start({ eventDispatcher })).catch((error) => {
    checks.push(failedCheck("ws_client_start", "lark_ws_client_start_failed", errorMessage(error)));
    completeRun();
  });

  await completion;
  await Promise.race([startPromise, sleep(0)]);
  clearTimeout(timer);

  try {
    wsClient.close?.({ force: true });
  } catch (error) {
    checks.push(failedCheck("ws_client_close", "lark_ws_client_close_failed", errorMessage(error)));
  }

  await Promise.allSettled(pending);
  return buildFeishuBotLiveSmokeReport(input, { checks, counts });
}

async function handleLiveFeishuEvent({ data, client, input, fetchImpl, checks, counts }) {
  counts.receivedEvents += 1;
  const event = buildGatewayEventEnvelope(data);
  const result = await postBotEvent(input, fetchImpl, event);
  checks.push(result.check);

  if (result.check.route) counts.acceptedEvents += 1;
  if (result.check.rejectionCode === "feishu_terminal_input_rejected") counts.terminalInputRejections += 1;
  if (!result.replyPlan || input.sendReplies === false) return;

  try {
    await sendFeishuReply(client, result.replyPlan);
    counts.replySent += 1;
    checks.push({
      name: result.check.rejectionCode ? "rejection_reply_sent" : "bounded_reply_sent",
      ok: true,
      msgType: result.replyPlan.msgType,
      receiveIdType: result.replyPlan.receiveIdType
    });
  } catch (error) {
    counts.replyFailures += 1;
    checks.push(failedCheck("bounded_reply_sent", "feishu_reply_send_failed", errorMessage(error)));
  }
}

export function buildGatewayEventEnvelope(data) {
  if (isRecord(data) && isRecord(data.header) && isRecord(data.event)) return data;
  const event = isRecord(data) && isRecord(data.event) ? data.event : data;
  const message = isRecord(event) && isRecord(event.message) ? event.message : {};
  const messageId = typeof message.message_id === "string" ? message.message_id : `live-${Date.now()}`;
  return {
    schema: "2.0",
    header: {
      event_id: messageId,
      event_type: EVENT_SUBSCRIPTION
    },
    event
  };
}

function buildFeishuBotLiveSmokeReport(input, state) {
  const checks = state.checks.map((check) => sanitizeCheck(check));
  const counts = { ...state.counts };
  const gateClearingEvidence = isGateClearingEvidence(counts, checks);
  const missing = gateClearingEvidence ? [] : missingGateEvidence(counts);
  const ok = checks.every((check) => check.ok)
    && counts.receivedEvents >= (input.maxEvents ?? DEFAULT_MAX_EVENTS)
    && counts.replyFailures === 0
    && (!input.requireReconnect || counts.reconnected > 0);

  return {
    ok,
    mode: "real_feishu_bot_long_connection",
    gateClearingEvidence,
    publicCallbackRequired: false,
    gatewayUrl: redactFeishuLiveText(input.gatewayUrl ?? DEFAULT_GATEWAY_URL),
    eventSubscription: EVENT_SUBSCRIPTION,
    durationMs: input.durationMs ?? DEFAULT_DURATION_MS,
    maxEvents: input.maxEvents ?? DEFAULT_MAX_EVENTS,
    sendReplies: input.sendReplies !== false,
    requireReconnect: input.requireReconnect === true,
    counts,
    checks,
    caveat: gateClearingEvidence
      ? "This report contains real receive, bounded reply, reconnect, and terminal-rejection evidence; review redaction before moving FEISHU-BOT-WS."
      : `This run is not sufficient to clear FEISHU-BOT-WS; missing ${missing.join(", ")} evidence.`
  };
}

function isGateClearingEvidence(counts, checks) {
  return counts.receivedEvents > 0
    && counts.acceptedEvents > 0
    && counts.replySent > 0
    && counts.reconnected > 0
    && counts.terminalInputRejections > 0
    && checks.every((check) => check.ok);
}

function missingGateEvidence(counts) {
  const missing = [];
  if (counts.receivedEvents === 0) missing.push("real im.message.receive_v1 receive");
  if (counts.acceptedEvents === 0) missing.push("accepted bounded command");
  if (counts.replySent === 0) missing.push("bounded reply");
  if (counts.reconnected === 0) missing.push("reconnect");
  if (counts.terminalInputRejections === 0) missing.push("terminal rejection boundary");
  return missing.length > 0 ? missing : ["clean run"];
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

async function postBotEvent(input, fetchImpl, event) {
  const result = await postJson(fetchImpl, endpoint(input.gatewayUrl, "/api/v1/integrations/feishu/bot-websocket/events"), input.token, { event });
  const data = isRecord(result.body?.data) ? result.body.data : {};
  const details = isRecord(result.body?.details) ? result.body.details : {};
  const replyPlan = isRecord(data.replyPlan) ? data.replyPlan : undefined;
  const rejectionCode = typeof details.code === "string" ? details.code : undefined;
  const expectedTerminalReject = rejectionCode === "feishu_terminal_input_rejected";
  return {
    check: {
      name: expectedTerminalReject ? "terminal_input_rejected" : "receive_route",
      httpStatus: result.httpStatus,
      ok: expectedTerminalReject || (result.httpStatus >= 200 && result.httpStatus < 300 && result.body?.code === 0),
      route: typeof data.route === "string" ? data.route : undefined,
      rejectionCode,
      replyPreview: replyPlan && typeof replyPlan.text === "string" ? replyPlan.text : undefined,
      errorCode: readErrorCode(result.body)
    },
    replyPlan: normalizeReplyPlan(replyPlan)
  };
}

function normalizeReplyPlan(replyPlan) {
  if (!isRecord(replyPlan)) return undefined;
  if (
    typeof replyPlan.receiveId !== "string"
    || replyPlan.receiveIdType !== "chat_id"
    || replyPlan.msgType !== "text"
    || typeof replyPlan.text !== "string"
  ) {
    return undefined;
  }
  return {
    receiveId: replyPlan.receiveId,
    receiveIdType: replyPlan.receiveIdType,
    msgType: replyPlan.msgType,
    text: replyPlan.text
  };
}

async function sendFeishuReply(client, replyPlan) {
  const target = getMessageCreateTarget(client);
  if (!target) throw new Error("Feishu SDK message create method is unavailable");
  await target.create.call(target.owner, {
    params: {
      receive_id_type: replyPlan.receiveIdType
    },
    data: {
      receive_id: replyPlan.receiveId,
      content: JSON.stringify({ text: replyPlan.text }),
      msg_type: replyPlan.msgType
    }
  });
}

function getMessageCreateTarget(client) {
  const v1Message = client?.im?.v1?.message;
  if (typeof v1Message?.create === "function") return { owner: v1Message, create: v1Message.create };
  const message = client?.im?.message;
  if (typeof message?.create === "function") return { owner: message, create: message.create };
  return undefined;
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
      .map(([key, value]) => [key, typeof value === "string" ? redactFeishuLiveText(value) : value])
  );
}

function failedCheck(name, errorCode, error) {
  return {
    name,
    ok: false,
    errorCode,
    error: redactFeishuLiveText(error)
  };
}

function readErrorCode(body) {
  return isRecord(body?.details) && typeof body.details.code === "string"
    ? body.details.code
    : undefined;
}

function redactFeishuLiveText(text) {
  return String(text)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9._-]+/giu, "[REDACTED]")
    .replace(/\btoken\s+[A-Za-z0-9._~+/=-]+/giu, "token [REDACTED]")
    .replace(/\bapp[_-]?secret(\s*[:=]\s*)[^\s,;]+/giu, "app_secret$1[REDACTED]")
    .replace(/\b(?:o[cu]|om|cli)_[A-Za-z0-9._-]+/gu, (match) => `${match.slice(0, 4)}...[REDACTED]`);
}

function resolveLarkDomain(sdk, domain) {
  const normalized = String(domain ?? "feishu").trim().toLowerCase();
  if (normalized === "feishu" || normalized === "cn") return sdk.Domain?.Feishu ?? "https://open.feishu.cn";
  if (normalized === "lark" || normalized === "global") return sdk.Domain?.Lark ?? "https://open.larksuite.com";
  return domain;
}

async function loadLarkSdk() {
  try {
    return await import("@larksuiteoapi/node-sdk");
  } catch (error) {
    throw new Error(
      `@larksuiteoapi/node-sdk is required for real Feishu long-connection smoke: ${errorMessage(error)}`
    );
  }
}

function emptyCounts() {
  return {
    connected: 0,
    reconnecting: 0,
    reconnected: 0,
    receivedEvents: 0,
    acceptedEvents: 0,
    terminalInputRejections: 0,
    replySent: 0,
    replyFailures: 0
  };
}

function endpoint(gatewayUrl, path) {
  return `${String(gatewayUrl ?? DEFAULT_GATEWAY_URL).replace(/\/+$/u, "")}${path}`;
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

function hasFlag(args, key) {
  return Object.prototype.hasOwnProperty.call(args, key);
}

function readBoolean(...values) {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    const text = nonEmpty(value);
    if (!text) continue;
    if (/^(1|true|yes|on)$/iu.test(text)) return true;
    if (/^(0|false|no|off)$/iu.test(text)) return false;
  }
  return false;
}

function readPositiveInteger(argValue, envValue, fallback) {
  const value = Number.parseInt(nonEmpty(argValue) ?? nonEmpty(envValue) ?? String(fallback), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonEmpty(value) {
  const trimmed = typeof value === "string" ? value.trim() : undefined;
  return trimmed ? trimmed : undefined;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function writeFeishuBotLiveSmokeReport(report, outputPath) {
  const target = nonEmpty(outputPath);
  if (!target) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

async function main() {
  const resolved = resolveFeishuBotLiveConfig();
  if (!resolved.ok) {
    console.error(JSON.stringify({ ok: false, reason: resolved.reason, gateClearingEvidence: false }, null, 2));
    process.exitCode = 1;
    return;
  }

  const report = await runFeishuBotLiveSmoke(resolved.config);
  writeFeishuBotLiveSmokeReport(report, resolved.config.outputPath);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok || (resolved.config.requireGateEvidence && !report.gateClearingEvidence)) {
    process.exitCode = 1;
  }
}

if (isMainModule()) {
  await main();
}
