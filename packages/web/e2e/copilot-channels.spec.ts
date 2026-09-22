import { expect, test } from '@playwright/test';

test('owner pairs a private identity, binds scope and reviews uncertain delivery on desktop and mobile',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.addInitScript(()=>{localStorage.setItem('forgebadger.token','e2e-token');localStorage.setItem('forgebadger-language','zh-CN');localStorage.setItem('forgebadger.user',JSON.stringify({id:'owner',email:'owner@test.local',role:'admin',status:'active'}));});
  await page.routeWebSocket('**/ws/events',()=>{});
  let claimed=false;let confirmed=false;let paired=false;let bound=false;let revoked=false;
  const pairing=()=>({id:'pair',accountId:'a',accountRevision:1,status:confirmed?'confirmed':claimed?'claimed':'pending',revision:claimed?2:1,externalUserId:claimed?'ou_owner':null,chatId:claimed?'oc_owner':null,expiresAt:Date.now()+600000});
  const identity={id:'i',accountId:'a',accountRevision:1,externalUserId:'ou_owner',chatId:'oc_owner',status:'active'};
  const grant={id:'g',name:'项目只读联调授权',status:'active',revision:1,scope:{projectIds:['p'],capabilities:[],allowedRoots:[]},expiresAt:Date.now()+3600000,usedActions:0,maxActions:1,maxConcurrency:1};
  await page.route('**/api/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname;const method=route.request().method();let data:unknown={};
    if(path==='/api/v1/auth/me')data={id:'owner',email:'owner@test.local',role:'admin',status:'active'};
    else if(path.endsWith('/integrations/feishu/account'))data={account:{id:'a',appId:'cli_test',enabled:true,secretConfigured:true,configRevision:1}};
    else if(path.endsWith('/integrations/feishu/health'))data={health:{state:'connected'}};
    else if(path.endsWith('/integrations/telegram/account'))data={account:null};
    else if(path.endsWith('/integrations/telegram/health'))data={health:{state:'disabled',accountId:null,configRevision:null,reconnectAttempt:0,lastConnectedAt:null,lastErrorMessage:null}};
    else if(path.endsWith('/integrations/telegram/config'))data={config:{enabled:true,emergencyDisabled:false,allowedChatIds:[]}};
    else if(path.endsWith('/channels/feishu/diagnostics'))data={channel:'feishu',generatedAt:Date.now(),checks:[]};
    else if(path.endsWith('/channels/telegram/diagnostics'))data={channel:'telegram',generatedAt:Date.now(),checks:[]};
    else if(path.endsWith('/channels/pairings')&&method==='POST'){paired=true;data={pairing:pairing(),token:'browser-one-time-token'};}
    else if(path.endsWith('/channels/pairings'))data={pairings:paired?[pairing()]:[]};
    else if(path.endsWith('/pairings/pair/confirm')){expect(route.request().postDataJSON()).toEqual({revision:2,externalUserId:'ou_owner',chatId:'oc_owner'});confirmed=true;data={identity};}
    else if(path.endsWith('/channels/identities'))data={identities:confirmed?[identity]:[]};
    else if(path.endsWith('/channels/routes')&&method==='POST'){expect(route.request().postDataJSON()).toEqual({identityId:'i',grantId:'g'});bound=true;}
    else if(path.endsWith('/channels/routes'))data={routes:bound?[{id:'r',identityId:'i',grantId:'g',grantRevision:1,conversationId:'c',status:revoked?'revoked':'active'}]:[]};
    else if(path.endsWith('/routes/r/revoke'))revoked=true;
    else if(path.endsWith('/channels/deliveries'))data={deliveries:[{id:'d',inboxId:'m',phase:'terminal',status:'unknown',createdAt:Date.now(),receiptRecorded:false}]};
    else if(path.endsWith('/copilot/grants'))data={grants:[grant],capabilities:[]};
    else if(path.endsWith('/project-manager/overview'))data={projects:[],observedAt:Date.now()};
    else if(path.endsWith('/notifications'))data={notifications:[]};
    else if(path.endsWith('/copilot/conversations'))data={conversations:[]};
    await route.fulfill({json:{code:0,data,message:''}});
  });
  await page.goto('/copilot/channels');await expect(page.getByRole('heading',{name:'远程渠道',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'生成新的配对码'}).click();await expect(page.getByText('/pair browser-one-time-token')).toBeVisible();
  claimed=true;await expect(page.getByText('ou_owner',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'确认身份'})).toBeDisabled();await page.getByRole('checkbox',{name:'我确认这是自己的飞书私聊'}).check();await page.getByRole('button',{name:'确认身份'}).click();
  await page.getByLabel('私聊身份').selectOption('i');await page.getByLabel('授权',{exact:true}).selectOption('g');await page.getByRole('button',{name:'启用飞书远程操作'}).click();
  await expect(page.getByText('独立会话：c')).toBeVisible();await expect(page.getByText('任务结果 · 结果不确定')).toBeVisible();
  await page.getByRole('heading',{name:'远程渠道',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:'/private/tmp/channel-ui-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await expect(page.getByRole('button',{name:'撤销渠道授权'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('heading',{name:'远程渠道',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:'/private/tmp/channel-ui-mobile.png',fullPage:true});await page.getByRole('button',{name:'撤销渠道授权'}).click();
  await expect(page.getByRole('button',{name:'撤销渠道授权'})).toBeDisabled();expect(errors).toEqual([]);
});
