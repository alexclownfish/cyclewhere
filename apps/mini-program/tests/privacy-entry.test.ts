import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { api } from '../services/api';

let privacyDefinition: any;
(globalThis as any).Page = (value: any) => { privacyDefinition = value; };
await import('../pages/privacy/index.ts');

function makePage() {
  return {
    ...privacyDefinition,
    data: structuredClone(privacyDefinition.data),
    setData(update: Record<string, unknown>) { Object.assign(this.data, update); },
  };
}

test('privacy entry is the startup page and exposes browse before login', () => {
  const appConfig = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  const markup = readFileSync(new URL('../pages/privacy/index.wxml', import.meta.url), 'utf8');
  let target = '';
  (globalThis as any).wx = { redirectTo: ({ url }: { url: string }) => { target = url; } };
  const page = makePage();
  page.browse();
  assert.equal(appConfig.pages[0], 'pages/privacy/index');
  assert.equal(target, '/pages/gateway/index');
  assert.match(markup, /仅浏览/);
  assert.match(markup, /同意并继续/);
});

test('roadbook tab stays hidden while activity and publish roadbook flows remain', () => {
  const appConfig = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  const detailMarkup = readFileSync(new URL('../pages/event-detail/index.wxml', import.meta.url), 'utf8');
  const publishMarkup = readFileSync(new URL('../pages/publish/index.wxml', import.meta.url), 'utf8');
  assert.equal(appConfig.pages.includes('pages/routes/index'), false);
  assert.equal(appConfig.pages.includes('pages/route-detail/index'), true);
  assert.equal(appConfig.tabBar.list.some((item: { pagePath: string }) => item.pagePath === 'pages/routes/index'), false);
  assert.match(detailMarkup, /bindtap="openRoute"/);
  assert.match(publishMarkup, /导入自己的路书/);
});

test('agree creates a WeChat session before requesting avatar and nickname', async () => {
  const originalLogin = api.login;
  const originalGetProfile = api.getProfile;
  const calls: string[] = [];
  (globalThis as any).wx = {
    setStorageSync: (key: string) => calls.push(`storage:${key}`),
  };
  (api as any).login = async (forceRefresh: boolean) => { calls.push(`login:${forceRefresh}`); };
  (api as any).getProfile = async () => { calls.push('profile'); return null; };
  try {
    const page = makePage();
    await page.agree();
    assert.deepEqual(calls, ['storage:privacy_policy_accepted_v1', 'login:true', 'profile']);
    assert.equal(page.data.stage, 'profile');
  } finally {
    (api as any).login = originalLogin;
    (api as any).getProfile = originalGetProfile;
  }
});
