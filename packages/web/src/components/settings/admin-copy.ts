import { useLanguage } from "@/hooks/use-language";

const zh = {
  securityBaselineGuaranteed: "设计保证",
  securityBaselineGuaranteedHint:
    "JWT 认证与租户隔离为架构层保证，非运行时检测值；密钥加密与终端持久化为实际配置。",
  auditViewAll: "查看全部",
  auditActions: {
    apply_provider: "应用提供商配置",
    model_sync: "同步模型列表",
    "feishu.account.update": "更新飞书账号",
    "feishu.config.update": "更新飞书配置",
    "feishu.user_mappings.replace": "替换飞书用户映射",
    "feishu.channel.emergency_stop": "飞书渠道紧急停用",
    "telegram.account.update": "更新 Telegram 账号",
    "telegram.config.update": "更新 Telegram 配置",
    "telegram.channel.emergency_stop": "Telegram 渠道紧急停用",
    "runtime_settings.update": "更新实例运行时设置",
    "project.delete": "删除项目记录",
    "template.extract": "从项目提取模板",
    "project.config_sync": "同步项目配置",
    "session_hooks.session_notification": "更新 CLI 通知钩子",
    "gateway.start": "Gateway 启动",
    "gateway.recover_sessions_failed": "会话恢复失败",
  } as Record<string, string>,
  revokeOthersConfirmTitle: "退出其他设备？",
  revokeOthersConfirmDescription:
    "将立即吊销除当前设备外的所有登录会话，这些设备上的用户需要重新登录。",
  revokeInviteConfirmTitle: "撤销邀请？",
  revokeInviteConfirmDescription: "邀请码「{code}」将立即失效，未完成的注册无法继续使用。",
  resetPasswordAck: (email: string) => `我确认要为此成员（${email}）重置密码`,
  deviceIdPrefix: "会话",
  copyInviteCode: "复制邀请码",
  inviteCodeCopied: "已复制",
};

const zhTW: typeof zh = {
  securityBaselineGuaranteed: "設計保證",
  securityBaselineGuaranteedHint:
    "JWT 認證與租戶隔離為架構層保證，非執行時檢測值；金鑰加密與終端機持久化為實際設定。",
  auditViewAll: "查看全部",
  auditActions: {
    apply_provider: "套用供應商設定",
    model_sync: "同步模型清單",
    "feishu.account.update": "更新飛書帳號",
    "feishu.config.update": "更新飛書設定",
    "feishu.user_mappings.replace": "替換飛書使用者對應",
    "feishu.channel.emergency_stop": "飛書渠道緊急停用",
    "telegram.account.update": "更新 Telegram 帳號",
    "telegram.config.update": "更新 Telegram 設定",
    "telegram.channel.emergency_stop": "Telegram 渠道緊急停用",
    "runtime_settings.update": "更新執行個體執行時設定",
    "project.delete": "刪除專案記錄",
    "template.extract": "從專案提取範本",
    "project.config_sync": "同步專案設定",
    "session_hooks.session_notification": "更新 CLI 通知鉤子",
    "gateway.start": "Gateway 啟動",
    "gateway.recover_sessions_failed": "工作階段復原失敗",
  },
  revokeOthersConfirmTitle: "退出其他裝置？",
  revokeOthersConfirmDescription:
    "將立即註銷除目前裝置外的所有登入工作階段，這些裝置上的使用者需要重新登入。",
  revokeInviteConfirmTitle: "撤銷邀請？",
  revokeInviteConfirmDescription: "邀請碼「{code}」將立即失效，未完成的註冊無法繼續使用。",
  resetPasswordAck: (email: string) => `我確認要為此成員（${email}）重設密碼`,
  deviceIdPrefix: "工作階段",
  copyInviteCode: "複製邀請碼",
  inviteCodeCopied: "已複製",
};

const en: typeof zh = {
  securityBaselineGuaranteed: "By design",
  securityBaselineGuaranteedHint:
    "JWT auth and tenant isolation are architectural guarantees, not runtime detections; key encryption and terminal persistence are actual configured values.",
  auditViewAll: "View all",
  auditActions: {
    apply_provider: "Apply provider config",
    model_sync: "Sync model list",
    "feishu.account.update": "Update Feishu account",
    "feishu.config.update": "Update Feishu config",
    "feishu.user_mappings.replace": "Replace Feishu user mappings",
    "feishu.channel.emergency_stop": "Feishu channel emergency stop",
    "telegram.account.update": "Update Telegram account",
    "telegram.config.update": "Update Telegram config",
    "telegram.channel.emergency_stop": "Telegram channel emergency stop",
    "runtime_settings.update": "Update instance runtime settings",
    "project.delete": "Delete project record",
    "template.extract": "Extract template from project",
    "project.config_sync": "Sync project config",
    "session_hooks.session_notification": "Update CLI notification hooks",
    "gateway.start": "Gateway start",
    "gateway.recover_sessions_failed": "Session recovery failed",
  },
  revokeOthersConfirmTitle: "Sign out other devices?",
  revokeOthersConfirmDescription:
    "All signed-in sessions except this device will be revoked immediately; users on those devices must sign in again.",
  revokeInviteConfirmTitle: "Revoke invitation?",
  revokeInviteConfirmDescription:
    "The invitation code \"{code}\" will stop working immediately; unfinished registrations cannot use it anymore.",
  resetPasswordAck: (email: string) => `I confirm that I want to reset the password for this member (${email})`,
  deviceIdPrefix: "Session",
  copyInviteCode: "Copy code",
  inviteCodeCopied: "Copied",
};

/**
 * Feature copy for the settings/members admin surfaces (security baseline
 * qualifiers, audit action labels, destructive-action confirmations). Raw
 * Gateway enum values fall back to the raw string so newer action types never
 * render blank. Feature copy module, cf. project-copy.ts.
 */
export function useAdminCopy() {
  const { language } = useLanguage();
  return language === "en" ? en : language === "zh-TW" ? zhTW : zh;
}

export function auditActionLabel(copy: typeof zh, action: string): string {
  return copy.auditActions[action] ?? action;
}
