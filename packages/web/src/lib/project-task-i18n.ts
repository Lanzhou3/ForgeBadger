const en = {
  "task.artifactStale":
    "The linked artifact no longer matches the task requirements. Generate a new artifact for the current requirements; this historical link cannot be refreshed.",
  "task.artifacts": "Copilot artifact summaries",
  "task.artifactHint":
    "Share only file/check counts and the artifact digest with this project's members. This does not share private prompts, paths, diffs or output, mark the task done, verify code, accept delivery or merge changes.",
  "task.shareSummary":
    "I agree to share this artifact summary with project members",
  "task.linkArtifact": "Link summary",
  "task.artifactCandidate": "Your completed Copilot artifact",
  "task.noArtifacts": "No linked Copilot summaries.",
  "task.noCandidates":
    "No completed Copilot artifacts available from your account in this project.",
  "task.snapshotCurrent":
    "Matches the captured task requirements and artifact digest; not code verification",
  "task.snapshotStale":
    "Historical summary — task requirements or the artifact have changed",
  "task.filesChecks": "Files / passed checks / total checks",
  "task.openPrivate": "Open your private Copilot task",
  "task.manualDone":
    "Manual completion is a planning status, not verified delivery. Verification and review receipts are shown separately below.",
};
const zh: Record<keyof typeof en, string> = {
  "task.artifactStale":
    "关联产物已不匹配当前任务要求。请根据新要求生成新的产物；不能刷新历史关联来代替重新执行。",
  "task.artifacts": "Copilot 产物摘要",
  "task.artifactHint":
    "仅向项目成员分享文件数量、检查数量和产物摘要值，不分享私人提示词、路径、差异或输出；关联不会标记任务完成、验证代码、验收交付或合并改动。",
  "task.shareSummary": "我同意向项目成员分享此产物摘要",
  "task.linkArtifact": "关联摘要",
  "task.artifactCandidate": "我已完成的 Copilot 产物",
  "task.noArtifacts": "尚无关联的 Copilot 摘要。",
  "task.noCandidates": "你的账号在此项目中暂无可关联的已结束 Copilot 产物。",
  "task.snapshotCurrent": "匹配当时的任务要求和产物摘要值，不代表代码验证通过",
  "task.snapshotStale": "历史摘要：任务要求或产物已变更",
  "task.filesChecks": "文件数 / 通过检查数 / 总检查数",
  "task.openPrivate": "查看我的私人 Copilot 任务",
  "task.manualDone":
    "手工完成仅表示计划状态，不代表已验证交付。验证与审核回执在下方单独展示。",
};
const tw: Record<keyof typeof en, string> = {
  "task.artifactStale":
    "關聯產物已不符合目前任務要求。請依新要求產生新的產物；不能重新整理歷史關聯來取代重新執行。",
  "task.artifacts": "Copilot 產物摘要",
  "task.artifactHint":
    "僅向專案成員分享檔案數量、檢查數量和產物摘要值，不分享私人提示詞、路徑、差異或輸出；關聯不會標記任務完成、驗證程式碼、驗收交付或合併變更。",
  "task.shareSummary": "我同意向專案成員分享此產物摘要",
  "task.linkArtifact": "關聯摘要",
  "task.artifactCandidate": "我已完成的 Copilot 產物",
  "task.noArtifacts": "尚無關聯的 Copilot 摘要。",
  "task.noCandidates": "你的帳號在此專案中暫無可關聯的已結束 Copilot 產物。",
  "task.snapshotCurrent":
    "符合當時的任務要求和產物摘要值，不代表程式碼驗證通過",
  "task.snapshotStale": "歷史摘要：任務要求或產物已變更",
  "task.filesChecks": "檔案數 / 通過檢查數 / 總檢查數",
  "task.openPrivate": "查看我的私人 Copilot 任務",
  "task.manualDone":
    "手動完成僅表示計畫狀態，不代表已驗證交付。驗證與審核回執在下方分別展示。",
};
export const projectTaskTranslations = { en, "zh-CN": zh, "zh-TW": tw };
