export interface FeishuTrustedCard {
  config: { wide_screen_mode: true };
  header: {
    title: { tag: "plain_text"; content: string };
    template: "blue" | "orange";
  };
  elements: Array<Record<string, unknown>>;
}

export interface FeishuCardActionAcceptedResponse {
  card: {
    type: "raw";
    data: FeishuTrustedCard;
  };
}

export function renderFeishuMarkdownCard(input: {
  title: string;
  markdown: string;
  openUrl?: string;
}): FeishuTrustedCard {
  const elements: Array<Record<string, unknown>> = [{
    tag: "markdown",
    content: bounded(input.markdown, 20_000, "FEISHU_CARD_CONTENT_TOO_LONG")
  }];
  if (input.openUrl) {
    elements.push({
      tag: "action",
      actions: [{
        tag: "button",
        text: { tag: "plain_text", content: "Open" },
        url: safeHttpsUrl(input.openUrl),
        type: "default"
      }]
    });
  }
  return card(input.title, elements, "blue");
}

export function renderFeishuProjectManagerCard(input: {
  projectName: string;
  status: string;
  summary: string;
  blockers?: string[];
}): FeishuTrustedCard {
  const blockerText = input.blockers?.length
    ? `\n\n**Blockers**\n${input.blockers.map((item) => `- ${item}`).join("\n")}`
    : "";
  return renderFeishuMarkdownCard({
    title: `${bounded(input.projectName, 60, "FEISHU_CARD_TITLE_TOO_LONG")} · ${bounded(input.status, 30, "FEISHU_CARD_TITLE_TOO_LONG")}`,
    markdown: `${bounded(input.summary, 10_000, "FEISHU_CARD_CONTENT_TOO_LONG")}${blockerText}`
  });
}

export function renderFeishuApprovalCard(input: {
  title: string;
  summary: string;
  approveActionId: string;
  rejectActionId: string;
}): FeishuTrustedCard {
  return card(input.title, [
    { tag: "markdown", content: bounded(input.summary, 10_000, "FEISHU_CARD_CONTENT_TOO_LONG") },
    actionRow([
      { label: "批准本次", actionId: input.approveActionId, type: "primary" },
      { label: "拒绝", actionId: input.rejectActionId, type: "danger" }
    ])
  ], "orange");
}

export function renderFeishuCardActionAcceptedResponse(): FeishuCardActionAcceptedResponse {
  // The WS callback updates the clicked card immediately; durable execution continues in the Inbox worker.
  return {
    card: {
      type: "raw",
      data: card("审批请求已收到", [{
        tag: "markdown",
        content: "正在校验并执行本次操作，完成结果会另行回复。本卡片不会重复执行。"
      }], "blue")
    }
  };
}

export function renderFeishuAutomationCard(input: {
  name: string;
  schedule: string;
  status: string;
  actionIds?: string[];
}): FeishuTrustedCard {
  const actionIds = input.actionIds ?? [];
  if (actionIds.length > 3) throw new Error("FEISHU_CARD_TOO_MANY_ACTIONS");
  const elements: Array<Record<string, unknown>> = [{
    tag: "markdown",
    content: `**Schedule:** ${bounded(input.schedule, 200, "FEISHU_CARD_CONTENT_TOO_LONG")}\n**Status:** ${bounded(input.status, 50, "FEISHU_CARD_CONTENT_TOO_LONG")}`
  }];
  if (actionIds.length) {
    elements.push(actionRow(actionIds.map((actionId, index) => ({
      label: ["Pause", "Run now", "Cancel"][index] ?? "Action",
      actionId,
      type: "default"
    }))));
  }
  return card(input.name, elements, "blue");
}

function card(
  title: string,
  elements: Array<Record<string, unknown>>,
  template: "blue" | "orange"
): FeishuTrustedCard {
  if (elements.length > 20) throw new Error("FEISHU_CARD_TOO_MANY_ELEMENTS");
  return {
    // Card JSON 1.0 is accepted by the message API used by the Node SDK and matches Hermes' proven path.
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: bounded(title, 100, "FEISHU_CARD_TITLE_TOO_LONG") },
      template
    },
    elements
  };
}

function actionRow(actions: Array<{ label: string; actionId: string; type: string }>): Record<string, unknown> {
  if (actions.length > 3) throw new Error("FEISHU_CARD_TOO_MANY_ACTIONS");
  return {
    tag: "action",
    actions: actions.map((action) => ({
      tag: "button",
      text: { tag: "plain_text", content: action.label },
      type: action.type,
      value: { version: 1, action_id: opaqueActionId(action.actionId) }
    }))
  };
}

function opaqueActionId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error("FEISHU_CARD_ACTION_ID_INVALID");
  return value;
}

function safeHttpsUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.toString();
  } catch {
    // Fall through to the bounded validation error.
  }
  throw new Error("FEISHU_CARD_URL_UNSAFE");
}

function bounded(value: string, maximum: number, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new Error(errorCode);
  return normalized;
}
