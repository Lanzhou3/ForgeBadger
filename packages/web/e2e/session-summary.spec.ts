import {expect,test} from '@playwright/test';

for(const width of [1440,390])test(`current progress and historical result stay separate at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const user={id:'summary-owner',email:'fixture@example.test',role:'admin',status:'active'};
  await page.addInitScript(user=>{localStorage.setItem('forgebadger-language','zh-CN');localStorage.setItem('forgebadger.token','fixture');localStorage.setItem('forgebadger.user',JSON.stringify(user));},user);
  await page.routeWebSocket('**/ws/**',()=>{});
  const base={version:1,runtimeEpoch:'fixture',identityQuality:'exact_turn',observedAt:Date.now(),progress:[],verification:[]};
  await page.route('**/api/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    let data:unknown={};
    if(path==='/api/v1/auth/me')data=user;
    else if(path==='/api/v1/sessions/fixture-summary')data={session:{id:'fixture-summary',name:'Fixture session',projectId:'project',aiTool:'codex',status:'stopped',sessionKind:'ai_cli',attachToken:'',createdAt:Date.now(),updatedAt:Date.now()}};
    else if(path==='/api/v1/sessions/fixture-summary/summary')data={workState:'working',summary:{...base,state:'working',request:'当前 B 请求'},latestResult:{...base,state:'task_completed',request:'旧 A 请求',result:{text:'旧 A 执行结果',source:'native_final_message'}}};
    else if(path==='/api/v1/notifications')data={notifications:[]};
    else if(path.endsWith('/overview'))data={projects:[],observedAt:Date.now()};
    else if(path==='/api/v1/projects'||path.endsWith('/collaboration/projects'))data={projects:[]};
    else if(path==='/api/v1/sessions')data={sessions:[]};
    else if(path.endsWith('/work-state'))data={states:[],snapshotAt:Date.now()};
    await route.fulfill({json:{code:0,data,message:''}});
  });
  await page.goto('/sessions/fixture-summary');
  const panel=page.getByTestId('session-summary');
  await panel.locator('summary').click();
  await expect(panel.getByText('当前请求：当前 B 请求')).toBeVisible();
  await expect(panel.getByText('旧 A 执行结果')).toBeVisible();
  await expect(panel.getByText('来源：CLI 最终回复')).toBeVisible();
  await expect(panel.getByText('当前请求：旧 A 请求')).toHaveCount(0);
  await expect(panel.getByText('未采集到命令验证证据。')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
