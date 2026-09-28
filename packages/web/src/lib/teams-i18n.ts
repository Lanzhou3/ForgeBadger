const en = {
  "membersHub.intro": "Manage accounts, invitations and project access in one place.",
  "membersHub.accounts": "Accounts",
  "membersHub.collaboration": "Members and invitations",
  "membersHub.projects": "Project access",
  "membersHub.administration": "Ownership and lifecycle",
  "membersHub.selectProject": "Select a project to manage its members and permissions.",
  "membersHub.noProjects": "No accessible projects.",
  "membersHub.selectTeam": "Member group",
  "membersHub.createGroup": "Create a member group",

  "teams.revise": "Revise handoff",
  "teams.reviseHint":
    "Choose current eligible replacements and review the changed plan. Access stays revoked. Saving changes does not resume execution cleanup; resume separately after saving.",
  "teams.confirmRevision": "Confirm handoff revision",
  "teams.reloadImpact": "Reload current impact",
  "teams.targetChanged":
    "A replacement is no longer eligible. Revise this plan with current eligible members before resuming.",

  "teams.switchAccount": "Sign in with another account",

  "delivery.title": "PR title",
  "delivery.headMismatch":
    "The pushed remote head differs from the selected commit. Push the intended branch and refresh before retrying.",
  "delivery.baseMismatch":
    "The remote base has moved. Reconcile against the latest source, then verify and review the new attempt.",
  "delivery.prRejected":
    "GitHub rejected the request. Check repository access, token permissions and branch names before retrying.",
  "delivery.prMismatch":
    "The GitHub response or matching PR could not be verified. Inspect the repository before another request.",
  "delivery.currentReceipt":
    "Verify the current clean commit before creating a PR.",

  "delivery.git": "Git delivery",
  "delivery.reconcile": "Reconcile with latest source",
  "delivery.reconcileHint":
    "Prepare a new workspace on the latest source commit and merge this attempt’s selected commit. Existing uncommitted files and the old workspace are preserved. Verify and review the new result again.",
  "delivery.reconcileConfirm":
    "Stop the old execution and reconcile only the committed changes shown below. Uncommitted changes are not copied; resolve any conflicts in the new private terminal.",
  "delivery.conflicts":
    "Merge conflicts remain. Resolve these paths in the new private terminal, commit, then verify and request review again.",
  "delivery.draftPr": "Create draft GitHub PR",
  "delivery.prHint":
    "Push the branch yourself first. Its remote HEAD must match this verified commit, and the remote base must match this attempt’s base. This action creates a draft PR; it does not push code. Remote PR branches can change later and are not immutable acceptance evidence.",
  "delivery.repository": "GitHub repository (owner/repo)",
  "delivery.head": "Already-pushed head branch",
  "delivery.base": "Remote base branch",
  "delivery.token": "GitHub token (used only for this request)",
  "delivery.secure":
    "Credentials require loopback or HTTPS for both this page and the Gateway. Use the documented SSH forwarding setup.",
  "delivery.confirmPr":
    "Create a draft PR on the specified external GitHub repository using this exact verified commit.",
  "delivery.prUncertain":
    "The remote response is uncertain or pending. Re-enter the token and retry with the same repository and branches to look up the existing request; do not create another PR manually.",

  "teams.title": "Teams",
  "teams.empty": "No teams yet.",
  "teams.create": "Create team",
  "teams.name": "Team name",
  "teams.owner": "Owner",
  "teams.admin": "Team administrator",
  "teams.member": "Member",
  "teams.active": "Active",
  "teams.leaving": "Leaving · access revoked",
  "teams.left": "Left",
  "teams.closing": "Closing",
  "teams.closed": "Closed",
  "teams.members": "Team members",
  "teams.role": "Team role",
  "teams.scope":
    "Team administration does not grant access to private terminals or personal projects. Project development and review permissions are assigned separately.",
  "teams.invitations": "Team invitations",
  "teams.invite": "Create invitation",
  "teams.email": "Email",
  "teams.hours": "Expires in hours",
  "teams.pending": "Pending",
  "teams.used": "Used",
  "teams.revoked": "Revoked",
  "teams.expired": "Expired",
  "teams.expires": "Expires",
  "teams.revoke": "Revoke invitation",
  "teams.copy": "Copy link",
  "teams.copied": "Copied",
  "teams.copyFailed": "Copy failed. Select and copy the link manually.",
  "teams.oneTime":
    "Copy this one-time link now. It will not be shown again after leaving this page. Send it yourself through a trusted channel; no email is sent.",
  "teams.noInvites": "No invitations.",
  "teams.projects": "Team projects",
  "teams.noProjects": "No enrolled projects.",
  "teams.enroll": "Enroll own project",
  "teams.enrollHint":
    "This explicitly grants team administrators management authority over this project. Development, review and private execution remain separately controlled.",
  "teams.noCandidates":
    "No eligible personal projects. Only the current project owner may enroll an unassociated project.",
  "teams.select": "Select…",
  "teams.openProject": "Open project and permissions",
  "teams.transferProject": "Transfer project ownership",
  "teams.newOwner": "New owner",
  "teams.transfer": "Transfer team ownership",
  "teams.transferHint":
    "The selected active member becomes the owner. You remain a team administrator.",
  "teams.close": "Close team",
  "teams.closeHint":
    "Archive all team projects and complete pending execution stops before closing the team.",
  "teams.confirm": "Confirm",
  "teams.offboard": "Offboard / hand off",
  "teams.leave": "Leave team",
  "teams.impact": "Departure impact",
  "teams.handoffHint":
    "Choose ownership and task assignments for every affected project. Existing worktrees, branches and delivery authorship are preserved; private terminals are never transferred.",
  "teams.assignee": "Replacement assignee",
  "teams.reviewer": "Replacement reviewer",
  "teams.unassign": "Clear assignment",
  "teams.preview": "Prepare handoff preview",
  "teams.planConfirm": "Confirm this handoff plan",
  "teams.planNotice":
    "Review the selections below. Confirmation immediately revokes access; handoff finishes only after affected execution has stopped. This preview expires in 10 minutes.",
  "teams.stopping":
    "Access revoked. Execution stopping and handoff are still pending.",
  "teams.completed": "Handoff completed.",
  "teams.resume": "Resume pending handoff",
  "teams.pendingStops": "Pending stops",
  "teams.planId": "Handoff plan ID",
  "teams.loadPlan": "Load handoff plan",
  "teams.noImpact":
    "No affected projects. Membership access will still be revoked.",
  "teams.join": "Join team",
  "teams.joinIntro":
    "An invitation grants membership only to its intended email address. Confirm the team before accepting.",
  "teams.missingInvite":
    "No invitation in this tab. Open the complete link supplied by your team administrator.",
  "teams.signInJoin": "Sign in to accept",
  "teams.registerJoin": "Create account and join",
  "teams.registrationOff":
    "New account registration is disabled. Existing matching accounts can still sign in and join.",
  "teams.signedIn": "Signed in as",
  "teams.forgetInvite": "Discard this invitation",
  "teams.accountInvites": "Account registration invitations",
  "teams.accountScope":
    "System administrators manage instance accounts, not private projects. Team invitations are managed on the Teams page.",
  "teams.accountInviteHint":
    "These codes satisfy invitation-only registration. Ordinary registration still requires the local recovery key. Use team invitations for invited remote members.",
  "teams.inviteCode": "Registration invitation code (if required)",
  "teams.reset": "Reset account password",
  "teams.resetHint":
    "This invalidates the account’s logins and authenticated sockets. Running native CLI processes are not stopped; use account disable or team offboarding for execution revocation.",
  "teams.resetDone": "Password reset; account logins revoked.",
  "teams.error": "Request failed. Please retry.",
  "teams.retry": "Retry",
  "teams.stale":
    "The data or handoff preview changed. Refresh and review a new preview.",
  "teams.denied": "You no longer have permission for this operation.",
  "teams.invalidInvite":
    "This invitation is invalid, expired, revoked or already used. Ask an administrator for a new link.",
  "teams.emailMismatch":
    "Sign in with the email address specified by this invitation.",
  "teams.ownerRequired": "Transfer team ownership before leaving.",
  "teams.externalMembers":
    "Resolve existing project members outside this team before enrollment.",
  "teams.stopPending":
    "Execution is still active or stopping. Wait, then retry this operation.",
  "teams.locked":
    "An execution operation remains unresolved. Keep this plan and ask the host operator to resolve it before resuming.",
  "teams.notFound": "Team or account not found or no longer accessible.",
} as const;
const zhCN: Record<keyof typeof en, string> = {
  "membersHub.intro": "在此管理成员、邀请、角色及项目权限。",
  "membersHub.accounts": "账号管理",
  "membersHub.collaboration": "成员与邀请",
  "membersHub.projects": "项目权限",
  "membersHub.administration": "归属与交接",
  "membersHub.selectProject": "选择项目，管理成员及其开发、评审权限。",
  "membersHub.noProjects": "暂无可访问的项目。",
  "membersHub.selectTeam": "成员分组",
  "membersHub.createGroup": "新建成员分组",

  "teams.revise": "修订交接",
  "teams.reviseHint":
    "请选择当前有效的接任人并核对修订计划。离职成员仍保持撤权；保存后须另行继续停止与交接。",
  "teams.confirmRevision": "确认修订交接",
  "teams.reloadImpact": "重新加载当前影响",
  "teams.targetChanged":
    "接任人已不符合条件，请修订计划选择当前有效成员后再继续。",

  "teams.switchAccount": "使用其他账号登录",

  "delivery.title": "PR 标题",
  "delivery.headMismatch":
    "已推送的远端 HEAD 与选定提交不一致，请推送正确分支并刷新后重试。",
  "delivery.baseMismatch":
    "远端基础分支已变化，请同步最新源代码，再验证和审核新的开发尝试。",
  "delivery.prRejected":
    "GitHub 拒绝了请求，请检查仓库访问权、令牌权限及分支名后重试。",
  "delivery.prMismatch":
    "无法验证 GitHub 响应或匹配的 PR，请先检查仓库再发起请求。",
  "delivery.currentReceipt": "创建 PR 前请验证当前干净的提交。",

  "delivery.git": "Git 交付",
  "delivery.reconcile": "同步源项目最新提交",
  "delivery.reconcileHint":
    "在源项目最新提交上创建新工作区，并合并本次选定提交。保留旧工作区及未提交文件，新结果须重新验证和审核。",
  "delivery.reconcileConfirm":
    "停止旧执行并仅合并以下已提交改动，不复制未提交修改；若有冲突，请在新私人终端解决。",
  "delivery.conflicts":
    "仍有合并冲突。请在新私人终端解决以下文件并提交，再重新验证和申请审核。",
  "delivery.draftPr": "创建 GitHub 草稿 PR",
  "delivery.prHint":
    "请先自行推送分支：远端 HEAD 必须匹配已验证提交，远端基础分支须匹配本次开发的基础提交。此操作创建草稿 PR，不会推送代码。远端 PR 分支后续可变，不是不可变验收证据。",
  "delivery.repository": "GitHub 仓库（owner/repo）",
  "delivery.head": "已推送的开发分支",
  "delivery.base": "远端基础分支",
  "delivery.token": "GitHub 令牌（仅本次请求使用）",
  "delivery.secure":
    "当前页面与 Gateway 均须使用本机回环或 HTTPS 才能提交凭证，请使用文档中的 SSH 转发配置。",
  "delivery.confirmPr":
    "使用此精确已验证提交，在指定的外部 GitHub 仓库创建草稿 PR。",
  "delivery.prUncertain":
    "远端响应不确定或仍在处理中。请重新输入令牌，保持仓库和分支不变后重试查找原请求；不要另行手动创建重复 PR。",

  "teams.title": "团队",
  "teams.empty": "暂无团队。",
  "teams.create": "创建团队",
  "teams.name": "团队名称",
  "teams.owner": "所有者",
  "teams.admin": "团队管理员",
  "teams.member": "成员",
  "teams.active": "有效",
  "teams.leaving": "正在离职 · 权限已撤销",
  "teams.left": "已离职",
  "teams.closing": "关闭中",
  "teams.closed": "已关闭",
  "teams.members": "团队成员",
  "teams.role": "团队角色",
  "teams.scope":
    "团队管理权限不授予私人终端或个人项目访问权。开发和审核权限须单独分配。",
  "teams.invitations": "团队邀请",
  "teams.invite": "创建邀请",
  "teams.email": "邮箱",
  "teams.hours": "有效小时数",
  "teams.pending": "待接受",
  "teams.used": "已使用",
  "teams.revoked": "已撤销",
  "teams.expired": "已过期",
  "teams.expires": "到期时间",
  "teams.revoke": "撤销邀请",
  "teams.copy": "复制链接",
  "teams.copied": "已复制",
  "teams.copyFailed": "复制失败，请选中链接手动复制。",
  "teams.oneTime":
    "请立即复制单次邀请链接，离开页面后不会再次显示。请自行通过可信渠道发送，平台不会发送邮件。",
  "teams.noInvites": "暂无邀请。",
  "teams.projects": "团队项目",
  "teams.noProjects": "暂无归属团队的项目。",
  "teams.enroll": "将自己的项目纳入团队",
  "teams.enrollHint":
    "此操作明确授予团队管理员管理该项目的权限；开发、审核和私人执行仍分别授权。",
  "teams.noCandidates":
    "没有符合条件的个人项目。只有当前项目所有者可纳入尚未归属团队的项目。",
  "teams.select": "请选择…",
  "teams.openProject": "打开项目及权限",
  "teams.transferProject": "转移项目所有权",
  "teams.newOwner": "新所有者",
  "teams.transfer": "转移团队所有权",
  "teams.transferHint": "所选有效成员将成为所有者，你将保留团队管理员角色。",
  "teams.close": "关闭团队",
  "teams.closeHint": "关闭团队前，请归档所有团队项目并完成待处理的执行停止。",
  "teams.confirm": "确认",
  "teams.offboard": "离职与交接",
  "teams.leave": "退出团队",
  "teams.impact": "离职影响",
  "teams.handoffHint":
    "为每个受影响项目明确选择所有者和任务分配。保留已有工作树、分支和交付作者，私人终端不会转交。",
  "teams.assignee": "接任执行者",
  "teams.reviewer": "接任审核者",
  "teams.unassign": "清空分配",
  "teams.preview": "生成交接预览",
  "teams.planConfirm": "确认此交接计划",
  "teams.planNotice":
    "请核对以下选择。确认后立即撤权，受影响执行全部停止后才完成交接。预览 10 分钟后过期。",
  "teams.stopping": "权限已撤销，执行停止与交接仍待完成。",
  "teams.completed": "交接已完成。",
  "teams.resume": "继续待完成的交接",
  "teams.pendingStops": "待停止数",
  "teams.planId": "交接计划 ID",
  "teams.loadPlan": "加载交接计划",
  "teams.noImpact": "没有受影响的项目，仍将撤销团队成员权限。",
  "teams.join": "加入团队",
  "teams.joinIntro": "邀请仅适用于指定邮箱，请确认团队后接受。",
  "teams.missingInvite": "当前标签页没有邀请，请打开团队管理员提供的完整链接。",
  "teams.signInJoin": "登录后接受邀请",
  "teams.registerJoin": "创建账户并加入",
  "teams.registrationOff": "新账号注册已关闭，已有匹配账号仍可登录加入。",
  "teams.signedIn": "当前登录账号",
  "teams.forgetInvite": "清除此邀请",
  "teams.accountInvites": "账号注册邀请",
  "teams.accountScope":
    "系统管理员仅管理全站账号，不自动取得私人项目权限。团队邀请请前往团队页面管理。",
  "teams.accountInviteHint":
    "这些邀请码用于邀请制注册。普通注册仍需本机恢复密钥；远程团队成员请使用团队邀请。",
  "teams.inviteCode": "注册邀请码（如需要）",
  "teams.reset": "重置账号密码",
  "teams.resetHint":
    "此操作使该账号的登录会话与已认证连接失效，但不会停止运行中的原生 CLI 进程。若要撤销执行权限，请禁用账号或执行团队离职。",
  "teams.resetDone": "密码已重置，账号登录已撤销。",
  "teams.error": "请求失败，请重试。",
  "teams.retry": "重试",
  "teams.stale": "数据或交接预览已变化，请刷新并核对新的预览。",
  "teams.denied": "你已无权执行此操作。",
  "teams.invalidInvite":
    "邀请无效、已过期、已撤销或已使用，请联系管理员获取新链接。",
  "teams.emailMismatch": "请使用邀请指定的邮箱登录。",
  "teams.ownerRequired": "退出前请先转移团队所有权。",
  "teams.externalMembers": "纳入团队前，请先处理项目中不属于此团队的成员。",
  "teams.stopPending": "执行仍在运行或停止中，请等待后重试此操作。",
  "teams.locked":
    "执行操作尚未确认结束，请保留计划并由宿主机操作员处理后继续。",
  "teams.notFound": "团队或账号不存在，或已不可访问。",
};
const zhTW: Record<keyof typeof en, string> = {
  "membersHub.intro": "在此管理成員、邀請、角色及專案權限。",
  "membersHub.accounts": "帳號管理",
  "membersHub.collaboration": "成員與邀請",
  "membersHub.projects": "專案權限",
  "membersHub.administration": "歸屬與交接",
  "membersHub.selectProject": "選擇專案，管理成員及其開發、審核權限。",
  "membersHub.noProjects": "暫無可存取的專案。",
  "membersHub.selectTeam": "成員分組",
  "membersHub.createGroup": "新增成員分組",

  "teams.revise": "修訂交接",
  "teams.reviseHint":
    "請選擇目前有效的接任人並核對修訂計畫。離職成員仍保持撤權；儲存後須另行繼續停止及交接。",
  "teams.confirmRevision": "確認修訂交接",
  "teams.reloadImpact": "重新載入目前影響",
  "teams.targetChanged":
    "接任人已不符合條件，請修訂計畫選擇目前有效成員後再繼續。",

  "teams.switchAccount": "使用其他帳號登入",

  "delivery.title": "PR 標題",
  "delivery.headMismatch":
    "已推送的遠端 HEAD 與選定提交不一致，請推送正確分支並重新整理後重試。",
  "delivery.baseMismatch":
    "遠端基礎分支已變更，請同步最新原始碼，再驗證及審核新的開發嘗試。",
  "delivery.prRejected":
    "GitHub 拒絕了請求，請檢查儲存庫存取權、權杖權限及分支名稱後重試。",
  "delivery.prMismatch":
    "無法驗證 GitHub 回應或符合的 PR，請先檢查儲存庫再發起請求。",
  "delivery.currentReceipt": "建立 PR 前請驗證目前乾淨的提交。",

  "delivery.git": "Git 交付",
  "delivery.reconcile": "同步來源專案最新提交",
  "delivery.reconcileHint":
    "在來源專案最新提交上建立新工作區，並合併本次選定提交。保留舊工作區及未提交檔案，新結果須重新驗證及審核。",
  "delivery.reconcileConfirm":
    "停止舊執行並僅合併以下已提交變更，不複製未提交修改；若有衝突，請在新私人終端解決。",
  "delivery.conflicts":
    "仍有合併衝突。請在新私人終端解決以下檔案並提交，再重新驗證及申請審核。",
  "delivery.draftPr": "建立 GitHub 草稿 PR",
  "delivery.prHint":
    "請先自行推送分支：遠端 HEAD 必須符合已驗證提交，遠端基礎分支須符合本次開發的基礎提交。此操作建立草稿 PR，不會推送程式碼。遠端 PR 分支後續可變，並非不可變驗收證據。",
  "delivery.repository": "GitHub 儲存庫（owner/repo）",
  "delivery.head": "已推送的開發分支",
  "delivery.base": "遠端基礎分支",
  "delivery.token": "GitHub 權杖（僅此次請求使用）",
  "delivery.secure":
    "目前頁面與 Gateway 均須使用本機回環或 HTTPS 才能提交憑證，請使用文件中的 SSH 轉送設定。",
  "delivery.confirmPr":
    "使用此精確已驗證提交，在指定的外部 GitHub 儲存庫建立草稿 PR。",
  "delivery.prUncertain":
    "遠端回應不確定或仍在處理中。請重新輸入權杖，保持儲存庫及分支不變後重試查找原請求；不要另行手動建立重複 PR。",

  "teams.title": "團隊",
  "teams.empty": "暫無團隊。",
  "teams.create": "建立團隊",
  "teams.name": "團隊名稱",
  "teams.owner": "擁有者",
  "teams.admin": "團隊管理員",
  "teams.member": "成員",
  "teams.active": "有效",
  "teams.leaving": "正在離職 · 權限已撤銷",
  "teams.left": "已離職",
  "teams.closing": "關閉中",
  "teams.closed": "已關閉",
  "teams.members": "團隊成員",
  "teams.role": "團隊角色",
  "teams.scope":
    "團隊管理權限不授予私人終端或個人專案存取權。開發及審核權限須另行分配。",
  "teams.invitations": "團隊邀請",
  "teams.invite": "建立邀請",
  "teams.email": "電子郵件",
  "teams.hours": "有效小時數",
  "teams.pending": "待接受",
  "teams.used": "已使用",
  "teams.revoked": "已撤銷",
  "teams.expired": "已過期",
  "teams.expires": "到期時間",
  "teams.revoke": "撤銷邀請",
  "teams.copy": "複製連結",
  "teams.copied": "已複製",
  "teams.copyFailed": "複製失敗，請選取連結手動複製。",
  "teams.oneTime":
    "請立即複製單次邀請連結，離開頁面後不會再次顯示。請自行透過可信管道傳送，平台不會寄送郵件。",
  "teams.noInvites": "暫無邀請。",
  "teams.projects": "團隊專案",
  "teams.noProjects": "暫無歸屬團隊的專案。",
  "teams.enroll": "將自己的專案納入團隊",
  "teams.enrollHint":
    "此操作明確授予團隊管理員管理此專案的權限；開發、審核及私人執行仍分別授權。",
  "teams.noCandidates":
    "沒有符合條件的個人專案。只有目前專案擁有者可納入尚未歸屬團隊的專案。",
  "teams.select": "請選擇…",
  "teams.openProject": "開啟專案及權限",
  "teams.transferProject": "轉移專案擁有權",
  "teams.newOwner": "新擁有者",
  "teams.transfer": "轉移團隊擁有權",
  "teams.transferHint": "所選有效成員將成為擁有者，你將保留團隊管理員角色。",
  "teams.close": "關閉團隊",
  "teams.closeHint": "關閉團隊前，請封存所有團隊專案並完成待處理的執行停止。",
  "teams.confirm": "確認",
  "teams.offboard": "離職與交接",
  "teams.leave": "退出團隊",
  "teams.impact": "離職影響",
  "teams.handoffHint":
    "為每個受影響專案明確選擇擁有者及任務分配。保留既有工作樹、分支和交付作者，私人終端不會轉交。",
  "teams.assignee": "接任執行者",
  "teams.reviewer": "接任審核者",
  "teams.unassign": "清空指派",
  "teams.preview": "產生交接預覽",
  "teams.planConfirm": "確認此交接計畫",
  "teams.planNotice":
    "請核對以下選擇。確認後立即撤權，受影響執行全部停止後才完成交接。預覽 10 分鐘後到期。",
  "teams.stopping": "權限已撤銷，執行停止與交接仍待完成。",
  "teams.completed": "交接已完成。",
  "teams.resume": "繼續待完成的交接",
  "teams.pendingStops": "待停止數",
  "teams.planId": "交接計畫 ID",
  "teams.loadPlan": "載入交接計畫",
  "teams.noImpact": "沒有受影響的專案，仍將撤銷團隊成員權限。",
  "teams.join": "加入團隊",
  "teams.joinIntro": "邀請僅適用於指定電子郵件，請確認團隊後接受。",
  "teams.missingInvite": "目前分頁沒有邀請，請開啟團隊管理員提供的完整連結。",
  "teams.signInJoin": "登入後接受邀請",
  "teams.registerJoin": "建立帳戶並加入",
  "teams.registrationOff": "新帳號註冊已關閉，既有符合帳號仍可登入加入。",
  "teams.signedIn": "目前登入帳號",
  "teams.forgetInvite": "清除此邀請",
  "teams.accountInvites": "帳號註冊邀請",
  "teams.accountScope":
    "系統管理員僅管理全站帳號，不會自動取得私人專案權限。團隊邀請請前往團隊頁面管理。",
  "teams.accountInviteHint":
    "這些邀請碼用於邀請制註冊。一般註冊仍需本機復原金鑰；遠端團隊成員請使用團隊邀請。",
  "teams.inviteCode": "註冊邀請碼（如需要）",
  "teams.reset": "重設帳號密碼",
  "teams.resetHint":
    "此操作使該帳號的登入階段與已驗證連線失效，但不會停止執行中的原生 CLI 程序。若要撤銷執行權限，請停用帳號或執行團隊離職。",
  "teams.resetDone": "密碼已重設，帳號登入已撤銷。",
  "teams.error": "請求失敗，請重試。",
  "teams.retry": "重試",
  "teams.stale": "資料或交接預覽已變更，請重新整理並核對新預覽。",
  "teams.denied": "你已無權執行此操作。",
  "teams.invalidInvite":
    "邀請無效、已到期、已撤銷或已使用，請聯絡管理員取得新連結。",
  "teams.emailMismatch": "請使用邀請指定的電子郵件登入。",
  "teams.ownerRequired": "退出前請先轉移團隊擁有權。",
  "teams.externalMembers": "納入團隊前，請先處理專案中不屬於此團隊的成員。",
  "teams.stopPending": "執行仍在運作或停止中，請等待後重試此操作。",
  "teams.locked": "執行操作尚未確認結束，請保留計畫並由主機操作員處理後繼續。",
  "teams.notFound": "團隊或帳號不存在，或已無法存取。",
};
export const teamTranslations = { en, "zh-CN": zhCN, "zh-TW": zhTW };
