import { expect, test, type Page } from "@playwright/test";

async function mockSurfaceApis(page: Page) {
 const user={id:'audit-user',email:'audit@example.test',role:'admin',status:'active'};
 await page.addInitScript(user=>{localStorage.setItem('forgebadger-language','zh-CN');localStorage.setItem('forgebadger.token','fixture');localStorage.setItem('forgebadger.user',JSON.stringify(user));},user);
 await page.routeWebSocket('**/ws/**',()=>{});
 const long='very_long_identifier_'.repeat(24);
 const projects=[{id:'p',name:'项目界面验证',counts:{done:0,total:0,in_progress:0,blocked:0},evidenceFreshness:{status:'unknown'},sessions:[],management:{ownerLabel:'',nextAction:'',freshnessHours:24,revision:1}}];
 const models=[{id:'default',name:'默认模型',providerName:'Provider',status:'active',isDefault:true},{id:'selected',name:'实际选择的模型',providerName:'Provider',status:'active',isDefault:false}];
 const conversations=['a','b'].map(id=>({id,title:'历史会话 '+id,status:'active',mode:'execute' as 'plan'|'execute',created_at:Date.now(),updated_at:Date.now()}));
 const modeWrites: Array<{ id: string; mode: 'plan' | 'execute' }> = [];
 const messages=[{role:'user',content:long},{role:'assistant',content:'## 验证结果\n\n这是长内容和 Markdown 表格的布局检查。\n\n```ts\nconst result = "'+long+'";\n```\n\n| 文件 | 状态 |\n|---|---|\n|'+long+'| 通过 |'},{role:'assistant',kind:'tool_call',toolName:long,toolCallId:'call',toolInputJson:JSON.stringify({file:long}),content:''},{role:'tool',kind:'tool_result',toolCallId:'call',content:JSON.stringify({output:long})}].map((m,i)=>({id:'m'+i,conversationId:'a',userId:user.id,kind:'text',sequence:i+1,createdAt:new Date().toISOString(),...m}));
 await page.route('**/api/v1/**',async route=>{
  const p=new URL(route.request().url()).pathname;let data: unknown;
  if(p==='/api/v1/collaboration/projects')data={projects:[]};
  else if(p==='/api/v1/auth/me')data=user;
  else if(p.endsWith('/notifications'))data={notifications:[]};
  else if(p.endsWith('/notifications/feishu'))data={config:{enabled:false,targetId:null,identityId:null,types:['attention','failure','completion'],webBaseUrl:'',revision:0},ready:false,blocker:'TARGET_INVALID',targets:[]};
  else if(p.endsWith('/notifications/feishu/deliveries'))data={deliveries:[]};
  else if(p==='/api/v1/projects')data={projects};
  else if(p==='/api/v1/projects/git-summaries')data={summaries:{}};
  else if(p==='/api/v1/sessions')data={sessions:[]};
  else if(p==='/api/v1/fleets')data={fleets:[]};
  else if(p.endsWith('/project-manager/overview'))data={projects,observedAt:Date.now()};
  else if(p.endsWith('/project-manager/context'))data={project:{id:'p',name:'项目界面验证',description:null,status:null},access:{role:'owner',capabilities:[],teamId:null,logicalOwnerId:user.id},managedExecution:{supported:false,reason:null},shared:false,privateDetailAllowed:true,revisionRequired:false};
  else if(p.endsWith('/model-providers'))data={providers:[],credentials:[],models};
  else if(p.endsWith('/copilot/preferences'))data={modelId:'selected',planModelId:'default',thinkingEffort:'medium'};
  else if(p.endsWith('/copilot/conversations'))data={conversations};
  else if (/\/copilot\/conversations\/[^/]+$/.test(p)) {
   const conversation = conversations.find(item => item.id === p.split('/').at(-1));
   if (!conversation) throw new Error(`Unknown fixture conversation: ${p}`);
   if (route.request().method() === 'PATCH') {
    const { mode } = route.request().postDataJSON();
    if (mode !== 'plan' && mode !== 'execute') throw new Error('Invalid fixture conversation mode');
    conversation.mode = mode;
    modeWrites.push({ id: conversation.id, mode });
   }
   data = { conversation };
  }
  else if(p.endsWith('/messages'))data={messages};
  else if(p.endsWith('/runs'))data={runs:[],activeRun:null};
  else if(p.endsWith('/followups'))data={followups:[]};
  else if(p.endsWith('/copilot/capabilities'))data={tools:[{name:long,description:'检查当前项目的只读工具',enabled:true,available:true,risk:'read'}]};
  else if(p.endsWith('/copilot/skills'))data={skills:[]};
  else if(p.endsWith('/copilot/connections'))data={connections:[]};
  else if(p.endsWith('/copilot/machine-roots'))data={roots:[]};
  else if(p.endsWith('/copilot/goals'))data={goals:[]};
  else if(p.endsWith('/copilot/commands'))data={commands:[]};
  else if(p.endsWith('/copilot/memory/entries'))data={entries:[{id:'mem',text:long,scope:'global',kind:'preference'}]};
  else if(p.endsWith('/copilot/automations/suggestions'))data={suggestions:[]};
  else if(p.endsWith('/copilot/automations'))data={automations:[{id:'auto',name:long,prompt:'检查项目',status:'enabled',scheduleKind:'cron',scheduleExpression:'0 9 * * *'}]};
  else if(p.endsWith('/runtime-settings'))data={readonly:false,settings:[{key:'pm_auto_dispatch',value:false,source:'settings'}]};
  else if(p.endsWith('/adapters/discovery'))data={adapters:[]};
  else if(/integrations\/(feishu|telegram)\/account$/.test(p))data={account:null};
  else if(/integrations\/(feishu|telegram)\/health$/.test(p))data={health:{state:'disabled'}};
  else if(/integrations\/(feishu|telegram)\/config$/.test(p))data={config:{allowedChatIds:[],enabled:false}};
  else if(p.endsWith('/diagnostics'))data={checks:[],generatedAt:Date.now()};
  else if(/\/channels\/(pairings|identities|routes|deliveries)$/.test(p))data={[p.split('/').pop()]:[]};
  else {throw new Error(`Unhandled fixture API: ${p}`);}
  await route.fulfill({json:{code:0,data,message:''}});
 });
 return { conversations, modeWrites };
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`Copilot surfaces fit and remain navigable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockSurfaceApis(page);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    for (const [path, title] of [["settings", "Copilot 设置"], ["extensions", "Copilot 扩展"], ["channels", "远程渠道"], ["automations", "定时自动化"]]) {
      await page.goto(`/copilot/${path}`);
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await expect(page.locator("[data-floating-copilot]")).toHaveCount(0);
      expect(await page.locator("main").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      if (path === "settings") await expect(page.getByText("Provider / 实际选择的模型", { exact: false })).toBeVisible();
      if (path === "automations") {
        const name = page.getByText("very_long_identifier_".repeat(24), { exact: true });
        await expect(name).toBeVisible();
        expect(await name.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        await page.getByRole("button", { name: "新建", exact: true }).click();
        await expect(page.locator("#automation-name")).toBeVisible();
      }
    }
    await page.goto("/copilot");
    const history = page.getByTestId("copilot-message-history");
    await expect(history.getByText("验证结果", { exact: true })).toBeAttached();
    expect(await history.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const prompt = history.getByText("very_long_identifier_".repeat(24), { exact: true }).first();
    expect(await prompt.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const composer = page.getByRole("combobox", { name: "输入消息…" });
    await expect(composer).toBeInViewport();
    await composer.fill("只检查发送入口");
    await page.getByRole("button", { name: "发送", exact: true }).click({ trial: true });

    if (viewport.width < 768) await page.getByRole("button", { name: "对话", exact: true }).click();
    const sidebar = viewport.width < 768 ? page.getByRole("dialog") : page.locator("main");
    const row = sidebar.getByRole("button", { name: /历史会话 b/ });
    await row.focus();
    await page.keyboard.press("Tab");
    const rename = sidebar.getByRole("button", { name: "重命名", exact: true }).last();
    await expect(rename).toBeFocused();
    await expect(rename.locator("..")).toHaveCSS("opacity", "1");
    await page.keyboard.press("Enter");
    await expect(sidebar.getByRole("textbox", { name: "重命名", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await row.click();
    await page.goto("/copilot/settings");
    await page.getByRole("button", { name: "返回对话", exact: true }).click();
    await expect(page.locator('[aria-current="page"]').filter({ hasText: '历史会话 b' })).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}

test("connection forms and quick chat fit a short desktop viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 500 });
  await mockSurfaceApis(page);
  await page.goto("/copilot/extensions");
  await page.getByRole("tab", { name: "MCP 连接", exact: true }).click();
  await page.getByRole("button", { name: "添加 MCP Connection", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const bounds = await dialog.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(500);
  await dialog.getByRole("button", { name: "创建连接", exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole("button", { name: "创建连接", exact: true })).toBeInViewport();
  await page.keyboard.press("Escape");
  await page.route("**/api/v1/projects", route => route.fulfill({ json: { code: 0, data: { projects: [] }, message: "" } }));
  await page.goto("/projects");
  await page.locator("[data-floating-copilot]").getByRole("button", { name: "Copilot", exact: true }).click();
  const panel = page.getByTestId("robot-chat-panel");
  await expect(panel.getByRole("combobox", { name: "输入消息…" })).toBeFocused();
  // Parity chrome: model/thinking pickers and project context live inside
  // the floating panel as well.
  await expect(panel.getByRole("combobox", { name: "当前模型", exact: true })).toBeVisible();
  await expect(panel.getByRole("combobox", { name: "思考强度", exact: true })).toBeVisible();
  await expect(panel.getByRole("combobox", { name: "项目上下文", exact: true })).toBeVisible();
  const box = await panel.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(500);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("mobile quick chat keeps the panel clear of the corner robot", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSurfaceApis(page);
  await page.goto("/notifications");
  const robot = page.locator("[data-floating-copilot]").getByRole("button", { name: "Copilot", exact: true });
  await robot.click();
  const panel = page.getByTestId("robot-chat-panel");
  await expect(panel).toBeVisible();
  // The near-fullscreen sheet hides the robot on small screens instead of
  // half-covering it; desktop keeps both visible.
  await expect(robot).toBeHidden();
  const box = await panel.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(robot).toBeVisible();
});

test("mobile plan confirmation survives a conversation reload", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { conversations, modeWrites } = await mockSurfaceApis(page);
  const common = { conversationId: "a", userId: "audit-user", runId: "plan-run", stepId: "plan-step",
    toolName: "submit_plan", toolCallId: "plan-call", createdAt: new Date().toISOString() };
  const plan = { title: "更新项目文档", summary: "补全安装步骤。", todos: [{ title: "添加安装示例" }, { title: "改写教程" }] };
  let confirmation: { action: string; todoIndexes: number[]; runId: string } | undefined;
  await page.route("**/copilot/conversations/a/messages", route => route.fulfill({ json: {
    code: 0, message: "", data: { messages: [
      { ...common, id: "call", sequence: 1, role: "assistant", kind: "tool_call", content: "submit_plan" },
      { ...common, id: "result", sequence: 2, role: "tool", kind: "tool_result",
        content: JSON.stringify({ status: "plan_proposed", plan }), planProposal: { projectId: null, confirmation } },
    ] },
  } }));
  await page.route("**/copilot/conversations/a/plans/plan-step/confirm", async route => {
    expect(route.request().postDataJSON()).toEqual({ action: "execute", todoIndexes: [0], modelId: "selected" });
    confirmation = { action: "execute", todoIndexes: [0], runId: "execute-run" };
    conversations[0]!.mode = "execute";
    await route.fulfill({ json: { code: 0, data: { confirmation }, message: "" } });
  });

  await page.goto("/copilot?c=a&mode=plan");
  const card = page.getByTestId("copilot-plan-card");
  await expect(page.getByRole("button", { name: "计划", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => modeWrites).toEqual([{ id: "a", mode: "plan" }]);
  await expect(page).toHaveURL(/\/copilot\?c=a$/);
  await expect(card.getByRole("heading", { name: plan.title })).toBeVisible();
  expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await card.getByRole("checkbox", { name: "改写教程" }).uncheck();
  await card.getByRole("button", { name: "确认并开始执行" }).click();
  await expect(card.getByRole("status")).toHaveText("已开始执行计划");
  await expect(page.getByRole("button", { name: "执行", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(card.getByRole("status")).toHaveText("已开始执行计划");
  await expect(page.getByRole("button", { name: "执行", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(modeWrites).toEqual([{ id: "a", mode: "plan" }]);
  await expect(card.getByRole("checkbox", { name: "改写教程" })).not.toBeChecked();
});

test("mobile approval displays exact input and reconciles a rejected action", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSurfaceApis(page);
  let decided = false;
  const run = () => ({ id: "approval-run", conversationId: "a", userId: "audit-user", status: decided ? "completed" : "awaiting_approval", phase: "tool", steps: 1, revision: 1, createdAt: new Date().toISOString() });
  const action = { id: "action", runId: "approval-run", userId: "audit-user", tool: "write_project_file", inputJson: JSON.stringify({ path: "src/example.ts", content: "<script>untrusted input</script>" }), inputDigest: "digest", status: "pending" };
  await page.route("**/api/v1/copilot/conversations/a/runs", route => route.fulfill({ json: { code: 0, data: { runs: [run()], activeRun: decided ? null : run() }, message: "" } }));
  await page.route("**/api/v1/copilot/runs/approval-run", route => route.fulfill({ json: { code: 0, data: { run: run(), pendingActions: decided ? [] : [action] }, message: "" } }));
  await page.route("**/api/v1/copilot/runs/approval-run/pending-actions/action/decide", async route => {
    expect(route.request().postDataJSON()).toEqual({ approved: false });
    decided = true;
    await route.fulfill({ json: { code: 0, data: { resumed: true, runId: "approval-run" }, message: "" } });
  });
  await page.goto("/copilot?c=a");
  await expect(page.getByText(JSON.stringify(JSON.parse(action.inputJson), null, 2), { exact: true })).toBeAttached();
  const reject = page.getByRole("button", { name: "拒绝本次调用", exact: true });
  await reject.scrollIntoViewIfNeeded();
  await expect(reject).toBeInViewport();
  await reject.click();
  await expect(reject).toHaveCount(0);
  expect(decided).toBe(true);
  await expect(page.getByTestId("copilot-composer")).toBeInViewport();
});

for (const width of [1440, 390]) {
  test(`Skill update comparison and explicit adoption work at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await mockSurfaceApis(page);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const oldFiles = [{ path: 'SKILL.md', content: '---\nname: session-dispatch\ndescription: Dispatch\nversion: 2.0.0\n---\nMy retained instructions' }, { path: 'references/custom.md', content: 'Retain in history' }];
    const newFiles = [{ path: 'SKILL.md', content: '---\nname: session-dispatch\ndescription: Dispatch\nversion: 4.0.1\n---\nOfficial new instructions' }];
    let skill = { id: 'upgrade-skill', name: 'session-dispatch', description: 'Dispatch', kind: 'builtin-playbook', version: '2.0.0', currentVersion: '4.0.1', revisionId: 'r1', source: { kind: 'builtin' }, isEnabled: true, available: false, unavailableReason: 'playbook_review_required' as string | null, compatible: true, incompatibilityReasons: [], requiredTools: [], reviewRequired: true, customized: true, editable: true, updatedAt: new Date().toISOString(), content: 'My retained instructions', files: oldFiles, bundled: { version: '4.0.1', files: newFiles } };
    await page.route('**/api/v1/copilot/skills**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/adopt-builtin')) {
        expect(route.request().postDataJSON()).toEqual({ expectedRevisionId: 'r1', version: '4.0.1' });
        skill = { ...skill, version: '4.0.1', revisionId: 'r2', files: newFiles, content: 'Official new instructions', available: true, unavailableReason: null, reviewRequired: false, customized: false };
      }
      await route.fulfill({ json: { code: 0, data: path.endsWith('/skills') ? { skills: [skill] } : { skill }, message: '' } });
    });
    await page.goto('/copilot/extensions');
    await expect(page.getByText('已开启，但当前不可用')).toBeVisible();
    await page.getByRole('button', { name: '详情与版本' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('内置新版 v4.0.1')).toBeVisible();
    await expect(dialog.getByRole('button', { name: '保留编辑内容并完成核对' })).toBeDisabled();
    await dialog.getByRole('checkbox', { name: '我已对照新版核对当前编辑内容' }).check();
    await expect(dialog.getByRole('button', { name: '保留编辑内容并完成核对' })).toBeEnabled();
    await dialog.getByRole('textbox', { name: 'SKILL.md' }).fill(oldFiles[0]!.content + '\nEdited after review');
    await expect(dialog.getByRole('button', { name: '保留编辑内容并完成核对' })).toBeDisabled();
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await dialog.getByRole('button', { name: '采用内置新版', exact: true }).click();
    await expect(dialog.getByText('待核对内置更新', { exact: false })).toHaveCount(0);
    await expect(dialog.getByRole('textbox', { name: 'SKILL.md' })).toHaveValue(newFiles[0]!.content);
    await expect(dialog.getByText('已启用', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('已启用', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
