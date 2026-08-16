"use client";

import { useLanguage } from "@/hooks/use-language";
import type { Language } from "@/lib/i18n";

const copy = {
  "zh-CN": {
    title: "Copilot 工作区", pageDescription: "记录需求、审阅受治理的请求与脱敏运行状态。",
    safety: "此工作区不提供终端控制、任务派发或直接输入。", requestInbox: "需求收件箱", requestInboxDescription: "记录受治理的需求；请求不会发送终端输入或派发工作。",
    requirement: "需求", requirementPlaceholder: "描述目标、约束和相关证据。", recordRequest: "记录需求", recording: "记录中…", retry: "重试", retryNote: "重试会复用同一幂等键，直到请求成功。",
    noRequests: "尚未记录需求。", received: "收到", ownerDecision: "需要为 {project} 作出所有者决定。", confirming: "确认中…", confirmAssignment: "确认分配", ownerWaiting: "正在等待已路由且已登记的项目确认。",
    projectContext: "项目上下文", projectAttached: "项目上下文已附加到此请求，将由 Portfolio intake 验证。", requests: "请求", requestHistory: "不可变的请求历史与关联因果事实。",
    loadingTitle: "正在加载 Copilot 投影", loadingDescription: "正在读取最新的脱敏运行状态。", emptyTitle: "暂无 Copilot 记录", emptyDescription: "已登记项目及其受治理记录将显示在此处。", errorTitle: "Copilot 数据不可用", errorDescription: "无法读取投影，未尝试任何工作流变更。", conflictTitle: "Copilot 投影已变化", conflictDescription: "读取期间模型发生变化，请刷新以取得一致版本。", refresh: "刷新投影",
    dossiers: "档案", dossiersDescription: "仅显示明确登记的项目。", noObservedState: "未记录观察状态", activeRisks: "个活跃风险", projectDossier: "项目档案", objective: "目标", intendedOutcome: "预期结果", scope: "范围", observedState: "观察状态", workItems: "工作项", attempts: "任务尝试", evidence: "证据", riskSignals: "风险信号", authorization: "授权", wakeups: "工作流唤醒", heartbeat: "心跳", none: "—", noWorkItems: "此档案没有关联工作项。", noAttempts: "此档案没有关联任务尝试。", noEvidence: "尚未记录证据。", noRisks: "没有活跃风险信号。", noAuthorization: "没有等待审阅的授权记录。", noWakeups: "没有计划中的工作流唤醒。", heartbeatDisabled: "默认禁用心跳。", scheduledObservation: "已计划观察", noRecurringObservation: "无周期观察", notObserved: "未观察",
    statusSummary: "Copilot 状态摘要", clear: "正常", enabled: "已启用", disabled: "已禁用", pending: "待处理", timeline: "请求时间线", recorded: "已记录", unknown: "未知", unknownTime: "未知时间", timeUnavailable: "时间不可用",
    heartbeatDescription: "默认禁用观察。启用它不会派发工作或通知模型。", enableHeartbeat: "启用 Copilot 心跳", cadence: "频率（分钟）", cadenceError: "请选择 5 到 1,440 之间的整数分钟。", lastObserved: "上次观察", never: "从未", saving: "保存中…", saveHeartbeat: "保存心跳",
    companionTitle: "Copilot", companionDescription: "提交需求后，状态只来自持久化的 Portfolio Request。", companionEmpty: "告诉 Copilot 你希望记录的需求。", companionPrompt: "你想完成什么？", companionPlaceholder: "描述目标和约束。", companionNote: "Copilot 不会调用模型、终端或任务派发。", companionSubmit: "发送需求", companionSubmitting: "正在保存…", companionError: "无法保存需求。请使用同一幂等键重试。", companionStatus: "持久请求状态", companionRecorded: "需求已持久化，正在等待受治理的后续状态。", companionOwner: "该需求等待所有者决定。", companionBlocked: "该需求已被标记为阻塞。", companionCompleted: "该需求已完成。", requestId: "请求 ID", projectionVersion: "投影版本", widgetLoading: "正在加载脱敏 Copilot 状态", widgetUnavailable: "Copilot 状态暂不可用", widgetAttention: "Copilot 需要关注", widgetClear: "Copilot 状态正常", widgetOpen: "打开 Copilot 工作区：{status}", claims: "次尝试",
  },
  "zh-TW": {
    title: "Copilot 工作區", pageDescription: "記錄需求、審閱受治理的請求與去識別化運作狀態。", safety: "此工作區不提供終端控制、工作派發或直接輸入。", requestInbox: "需求收件匣", requestInboxDescription: "記錄受治理的需求；請求不會傳送終端輸入或派發工作。", requirement: "需求", requirementPlaceholder: "描述目標、約束與相關證據。", recordRequest: "記錄需求", recording: "記錄中…", retry: "重試", retryNote: "重試會重用相同冪等鍵，直到請求成功。", noRequests: "尚未記錄需求。", received: "收到", ownerDecision: "需要為 {project} 作出擁有者決定。", confirming: "確認中…", confirmAssignment: "確認指派", ownerWaiting: "正在等待已路由且已登記的專案確認。", projectContext: "專案脈絡", projectAttached: "專案脈絡已附加到此請求，將由 Portfolio intake 驗證。", requests: "請求", requestHistory: "不可變的請求歷史與關聯因果事實。", loadingTitle: "正在載入 Copilot 投影", loadingDescription: "正在讀取最新的去識別化運作狀態。", emptyTitle: "暫無 Copilot 記錄", emptyDescription: "已登記專案及其受治理記錄將顯示在此處。", errorTitle: "Copilot 資料不可用", errorDescription: "無法讀取投影，未嘗試任何工作流程變更。", conflictTitle: "Copilot 投影已變更", conflictDescription: "讀取期間模型發生變更，請重新整理以取得一致版本。", refresh: "重新整理投影", dossiers: "檔案", dossiersDescription: "只顯示明確登記的專案。", noObservedState: "未記錄觀察狀態", activeRisks: "個活躍風險", projectDossier: "專案檔案", objective: "目標", intendedOutcome: "預期結果", scope: "範圍", observedState: "觀察狀態", workItems: "工作項", attempts: "工作嘗試", evidence: "證據", riskSignals: "風險訊號", authorization: "授權", wakeups: "工作流程喚醒", heartbeat: "心跳", none: "—", noWorkItems: "此檔案沒有關聯工作項。", noAttempts: "此檔案沒有關聯工作嘗試。", noEvidence: "尚未記錄證據。", noRisks: "沒有活躍風險訊號。", noAuthorization: "沒有等待審閱的授權記錄。", noWakeups: "沒有排定的工作流程喚醒。", heartbeatDisabled: "預設停用心跳。", scheduledObservation: "已排定觀察", noRecurringObservation: "無週期觀察", notObserved: "未觀察", statusSummary: "Copilot 狀態摘要", clear: "正常", enabled: "已啟用", disabled: "已停用", pending: "待處理", timeline: "請求時間線", recorded: "已記錄", unknown: "未知", unknownTime: "未知時間", timeUnavailable: "時間不可用", heartbeatDescription: "預設停用觀察。啟用它不會派發工作或通知模型。", enableHeartbeat: "啟用 Copilot 心跳", cadence: "頻率（分鐘）", cadenceError: "請選擇 5 到 1,440 之間的整數分鐘。", lastObserved: "上次觀察", never: "從未", saving: "儲存中…", saveHeartbeat: "儲存心跳", companionTitle: "Copilot", companionDescription: "提交需求後，狀態只來自持久化的 Portfolio Request。", companionEmpty: "告訴 Copilot 你希望記錄的需求。", companionPrompt: "你想完成什麼？", companionPlaceholder: "描述目標與約束。", companionNote: "Copilot 不會呼叫模型、終端或工作派發。", companionSubmit: "傳送需求", companionSubmitting: "正在儲存…", companionError: "無法儲存需求。請使用相同冪等鍵重試。", companionStatus: "持久請求狀態", companionRecorded: "需求已持久化，正在等待受治理的後續狀態。", companionOwner: "該需求正在等待擁有者決定。", companionBlocked: "該需求已標記為阻塞。", companionCompleted: "該需求已完成。", requestId: "請求 ID", projectionVersion: "投影版本", widgetLoading: "正在載入去識別化 Copilot 狀態", widgetUnavailable: "Copilot 狀態暫時不可用", widgetAttention: "Copilot 需要注意", widgetClear: "Copilot 狀態正常", widgetOpen: "開啟 Copilot 工作區：{status}", claims: "次嘗試",
  },
  en: {
    title: "Copilot workspace", pageDescription: "Record requirements and review governed requests and redacted operational state.", safety: "This workspace provides no terminal control, dispatch, or direct input.", requestInbox: "Request inbox", requestInboxDescription: "Record a governed requirement. Requests never send terminal input or dispatch work.", requirement: "Requirement", requirementPlaceholder: "Describe the outcome, constraints, and relevant evidence.", recordRequest: "Record request", recording: "Recording…", retry: "Retry", retryNote: "Retries reuse the same idempotency key until the request succeeds.", noRequests: "No requests have been recorded.", received: "Received", ownerDecision: "An owner decision is required for {project}.", confirming: "Confirming…", confirmAssignment: "Confirm assignment", ownerWaiting: "Owner confirmation is waiting for a routed, enrolled project.", projectContext: "Project context", projectAttached: "Project context is attached to this request and will be validated by Portfolio intake.", requests: "Requests", requestHistory: "Immutable request history and linked causal facts.", loadingTitle: "Loading Copilot projection", loadingDescription: "Reading the latest redacted operational state.", emptyTitle: "No Copilot records yet", emptyDescription: "Enrolled projects and their governed records will appear here.", errorTitle: "Copilot data is unavailable", errorDescription: "The projection could not be loaded. No workflow change was attempted.", conflictTitle: "Copilot projection changed", conflictDescription: "The read model changed while loading. Refresh for a consistent version.", refresh: "Refresh projection", dossiers: "Dossiers", dossiersDescription: "Explicitly enrolled projects only.", noObservedState: "No observed state recorded", activeRisks: "active risks", projectDossier: "Project dossier", objective: "Objective", intendedOutcome: "Intended outcome", scope: "Scope", observedState: "Observed state", workItems: "Work items", attempts: "Task attempts", evidence: "Evidence", riskSignals: "Risk signals", authorization: "Authorization", wakeups: "Workflow wakeups", heartbeat: "Heartbeat", none: "—", noWorkItems: "No work items are linked to this dossier.", noAttempts: "No task attempts are linked to this dossier.", noEvidence: "No evidence has been recorded.", noRisks: "No risk signals are active.", noAuthorization: "No authorization record is awaiting review.", noWakeups: "No workflow wakeups are scheduled.", heartbeatDisabled: "Heartbeat is disabled by default.", scheduledObservation: "Scheduled observation", noRecurringObservation: "No recurring observation", notObserved: "Not observed", statusSummary: "Copilot status summary", clear: "Clear", enabled: "Enabled", disabled: "Disabled", pending: "pending", timeline: "Request timeline", recorded: "Recorded", unknown: "Unknown", unknownTime: "Unknown time", timeUnavailable: "Time unavailable", heartbeatDescription: "Observation is disabled by default. Enabling it does not dispatch work or notify a model.", enableHeartbeat: "Enable Copilot heartbeat", cadence: "Cadence (minutes)", cadenceError: "Choose a whole number from 5 to 1,440 minutes.", lastObserved: "Last observed", never: "never", saving: "Saving…", saveHeartbeat: "Save heartbeat", companionTitle: "Copilot", companionDescription: "After you submit a requirement, status comes only from the persisted Portfolio Request.", companionEmpty: "Tell Copilot which requirement to record.", companionPrompt: "What would you like to accomplish?", companionPlaceholder: "Describe the outcome and constraints.", companionNote: "Copilot does not call a model, terminal, or work dispatcher.", companionSubmit: "Send request", companionSubmitting: "Saving…", companionError: "The request could not be saved. Retry with the same idempotency key.", companionStatus: "Persisted request status", companionRecorded: "The requirement is persisted and awaiting governed follow-up state.", companionOwner: "This request is awaiting an owner decision.", companionBlocked: "This request is marked blocked.", companionCompleted: "This request is complete.", requestId: "Request ID", projectionVersion: "Projection version", widgetLoading: "Loading redacted Copilot status", widgetUnavailable: "Copilot status is currently unavailable", widgetAttention: "Copilot needs attention", widgetClear: "Copilot status is clear", widgetOpen: "Open Copilot workspace: {status}", claims: "claims",
  },
} as const;

export type PortfolioCopyKey = keyof typeof copy.en;
export type PortfolioCopy = Record<PortfolioCopyKey, string>;

const companionCopy = {
  "zh-CN": {
    welcome: "嗨，我在。可以问项目进展、安排下一步，或直接告诉我想推进什么。",
    context: "我会把需要跟进的内容写入项目工作流，并即时同步状态。",
    placeholder: "发消息…",
    send: "发送",
    sending: "发送中…",
    saved: "收到，已记录为协同请求。",
    errorAuth: "登录状态已失效，请重新登录后再发送。",
    errorUnavailable: "暂时无法连接项目服务。请确认 Gateway 正在运行后重试。",
    errorRejected: "这条消息暂时无法写入项目工作流。请稍后重试。",
    retry: "重试发送",
    openWorkspace: "打开完整工作区",
    status: "项目状态",
  },
  "zh-TW": {
    welcome: "嗨，我在。可以詢問專案進度、安排下一步，或直接告訴我想推進什麼。",
    context: "我會把需要跟進的內容寫入專案工作流程，並即時同步狀態。",
    placeholder: "傳送訊息…",
    send: "傳送",
    sending: "傳送中…",
    saved: "收到，已記錄為協作請求。",
    errorAuth: "登入狀態已失效，請重新登入後再傳送。",
    errorUnavailable: "暫時無法連線專案服務。請確認 Gateway 正在執行後重試。",
    errorRejected: "這則訊息暫時無法寫入專案工作流程。請稍後重試。",
    retry: "重新傳送",
    openWorkspace: "開啟完整工作區",
    status: "專案狀態",
  },
  en: {
    welcome: "Hi, I’m here. Ask about project progress, plan the next step, or tell me what you want to move forward.",
    context: "I’ll record follow-up work in the project workflow and update its status here.",
    placeholder: "Message Copilot…",
    send: "Send",
    sending: "Sending…",
    saved: "Got it — recorded as a collaboration request.",
    errorAuth: "Your sign-in has expired. Sign in again before sending.",
    errorUnavailable: "The project service is unavailable. Confirm that Gateway is running, then retry.",
    errorRejected: "This message cannot be written to the project workflow right now. Please retry.",
    retry: "Retry send",
    openWorkspace: "Open full workspace",
    status: "Project status",
  },
} as const;

export function usePortfolioCopy() {
  const { language } = useLanguage();
  return { copy: copy[language], language };
}

export function usePortfolioCompanionCopy() {
  const { language } = useLanguage();
  return { copy: companionCopy[language], language };
}

export function formatPortfolioTime(value: string, language: Language, fallback: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString(language);
}

/** Maps durable states into a bounded, localized presentation vocabulary. */
export function portfolioStatusLabel(status: string | null | undefined, copyValue: PortfolioCopy): string {
  if (status === "needs_owner_decision") return copyValue.companionOwner;
  if (status === "blocked") return copyValue.companionBlocked;
  if (status === "completed" || status === "done" || status === "accepted") return copyValue.companionCompleted;
  return copyValue.companionRecorded;
}

export function portfolioTimelineLabel(kind: "request" | "intake_decision" | "work_item", copyValue: PortfolioCopy): string {
  if (kind === "intake_decision") return copyValue.authorization;
  if (kind === "work_item") return copyValue.workItems;
  return copyValue.requests;
}

/** Keeps lifecycle checks outside presentational components. */
export function portfolioNeedsOwnerDecision(status: string | null | undefined): boolean {
  return status === "needs_owner_decision";
}

export function portfolioAuthorizationTierLabel(tier: string | null | undefined, copyValue: PortfolioCopy): string {
  if (tier === "preauthorized") return copyValue.enabled;
  if (tier === "owner_confirmation") return copyValue.pending;
  if (tier === "protected") return copyValue.authorization;
  return copyValue.unknown;
}

export function portfolioReasonClassLabel(reasonClass: string | null | undefined, copyValue: PortfolioCopy): string {
  if (reasonClass === "heartbeat") return copyValue.heartbeat;
  if (reasonClass === "retry_scheduled") return copyValue.retry;
  if (reasonClass === "wakeup") return copyValue.wakeups;
  return copyValue.unknown;
}

export function portfolioActionClassLabel(actionClass: string | null | undefined, copyValue: PortfolioCopy): string {
  if (actionClass === "observe_platform" || actionClass === "observe_git_state") return copyValue.observedState;
  return copyValue.unknown;
}
