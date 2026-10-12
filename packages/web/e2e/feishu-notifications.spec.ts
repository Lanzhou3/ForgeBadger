import { expect, test, type Page } from '@playwright/test';
import type { FeishuNotificationConfig, FeishuNotificationDelivery, FeishuNotificationTarget } from '../src/lib/feishu-notifications-api';

async function mockNotificationApis(page: Page, blocked = false) {
  const user = { id: 'notification-owner', email: 'owner@example.test', role: 'admin', status: 'active' };
  await page.addInitScript(user => {
    localStorage.setItem('forgebadger-language', 'zh-CN');
    localStorage.setItem('forgebadger.token', 'fixture');
    localStorage.setItem('forgebadger.user', JSON.stringify(user));
  }, user);
  await page.routeWebSocket('**/ws/**', () => {});
  let config: FeishuNotificationConfig = { enabled: false, targetId: null, identityId: null, types: ['attention', 'failure', 'completion'], webBaseUrl: '', revision: 0 };
  const deliveries: FeishuNotificationDelivery[] = [];
  const privateTarget:FeishuNotificationTarget={id:'private:identity',kind:'private',name:'我的飞书私聊',chatId:'oc_owner',accountId:'account',accountRevision:1,revision:1,available:true,reason:null};
  const groupTarget:FeishuNotificationTarget={...privateTarget,id:'group:dev',kind:'group',name:'ForgeBadger 开发群',chatId:'oc_group'};
  let targets=[privateTarget];
  let allowedChatIds = blocked ? ['oc_group'] : [];
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let data: unknown;
    if (path === '/api/v1/notifications/feishu') {
      if (request.method() === 'PUT') {
        expect(request.postDataJSON().revision).toBe(config.revision);
        config = { ...request.postDataJSON(), revision: config.revision + 1 };
      }
      data = { config, ready: !!config.targetId, blocker: config.targetId ? null : 'TARGET_INVALID',targets };
    } else if(path==='/api/v1/notifications/feishu/targets/refresh') {
      targets=[privateTarget,groupTarget];data={targets};
    } else if (path === '/api/v1/notifications/feishu/test') {
      expect(config.enabled).toBe(true);
      expect(Object.keys(request.postDataJSON())).toEqual(['requestId']);
      deliveries.push({ id: request.postDataJSON().requestId, type: 'test', status: 'pending', errorCode: null, createdAt: Date.now() });
      data = deliveries.at(-1);
    } else if (path === '/api/v1/notifications/feishu/deliveries') data = { deliveries };
    else if (path === '/api/v1/auth/me') data = user;
    else if (path === '/api/v1/notifications') data = { notifications: [] };
    else if (path.endsWith('/project-manager/overview')) data = { projects: [], observedAt: Date.now() };
    else if (path.endsWith('/collaboration/projects') || path === '/api/v1/projects') data = { projects: [] };
    else if (path.endsWith('/runtime-settings')) data = { readonly: false, settings: [] };
    else if (path.endsWith('/adapters/discovery')) data = { adapters: [] };
    else if (path.endsWith('/integrations/feishu/account')) data = { account: { id: 'account', appId: 'fixture', enabled: true, secretConfigured: true, configRevision: 1, connectionState: 'connected' } };
    else if (path.endsWith('/integrations/telegram/account')) data = { account: null };
    else if (/integrations\/(feishu|telegram)\/health$/.test(path)) data = { health: { state: 'connected' } };
    else if (/integrations\/(feishu|telegram)\/config$/.test(path)) {
      if (request.method() === 'PATCH') allowedChatIds = request.postDataJSON().allowedChatIds;
      data = { config: { enabled: true, emergencyDisabled: false, allowedChatIds } };
    }
    else if (path.endsWith('/diagnostics')) data = { checks: [], generatedAt: Date.now() };
    else if (path.endsWith('/channels/identities')) data = { identities: [{ id: 'identity', accountId: 'account', accountRevision: 1, externalUserId: 'ou_owner', chatId: 'oc_owner', status: 'active' }] };
    else if (/\/channels\/(pairings|routes|deliveries)$/.test(path)) data = { [path.split('/').pop()!]: [] };
    else throw new Error(`Unhandled notification fixture: ${path}`);
    await route.fulfill({ json: { code: 0, data, message: '' } });
  });
}

for (const width of [1440, 390]) {
  test(`personal notification settings save, test and disable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await mockNotificationApis(page);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('/copilot/channels');
    await expect(page.getByRole('heading', { name: '远程渠道', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/copilot\/channels$/);
    const panel = page.locator('#feishu-notifications');
    const toggle = panel.getByRole('switch', { name: '接收 ForgeBadger 通知' });
    await expect(toggle).not.toBeChecked();
    await expect(toggle).toBeEnabled();
    await toggle.check();
    await expect(panel.getByRole('combobox',{name:'卡片内容'})).toHaveCount(0);
    await expect(panel.getByText(/通知默认包含/)).toBeVisible();
    await expect(panel.getByText(/所选私聊或群聊成员均可看到/)).toBeVisible();
    await panel.getByRole('checkbox', { name: '应用操作结果' }).check();
    await panel.getByLabel('ForgeBadger Web 地址', { exact: true }).fill('https://forge.example.com');
    const send = panel.getByRole('button', { name: '发送测试卡片' });
    await expect(send).toBeDisabled();
    await panel.getByRole('button', { name: '保存通知设置' }).click();
    await expect(panel.getByText('飞书通知已开启，只推送之后产生的通知。')).toBeVisible();
    await send.click();
    await expect(panel.getByText('测试卡片 · 待发送', { exact: true })).toBeVisible();
    expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await panel.screenshot({ path: `/tmp/fb-feishu-notifications-${width}.png` });
    await panel.getByRole('button',{name:'刷新接收位置'}).click();
    const target=panel.getByRole('combobox',{name:'通知接收位置'});
    await expect(target).toContainText('我的飞书私聊');
    await target.click();
    await page.getByRole('option',{name:'群聊 · ForgeBadger 开发群'}).click();
    await expect(panel.getByText(/所选通知将发送到群/)).toContainText('群成员均可查看');
    await expect(send).toBeDisabled();
    await panel.getByRole('button',{name:'保存通知设置'}).click();
    await expect(send).toBeEnabled();
    await panel.screenshot({path:`/tmp/fb-feishu-group-target-${width}.png`});
    await expect(page.getByText('尚未设置聊天白名单。',{exact:true})).toBeVisible();
    await page.reload();
    await expect(toggle).toBeChecked();
    await expect(panel.getByRole('combobox',{name:'通知接收位置'})).toContainText('ForgeBadger 开发群');
    await toggle.uncheck();
    await panel.getByRole('button', { name: '保存通知设置' }).click();
    await expect(panel.getByText('飞书通知已关闭，尚未发送的通知已取消。')).toBeVisible();
    await expect(send).toBeDisabled();
    expect(errors).toEqual([]);
  });
}
