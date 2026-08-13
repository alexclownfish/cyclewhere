import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

let mineDefinition: any;
(globalThis as any).Page = (value: any) => { mineDefinition = value; };
await import('../pages/mine/index.ts');

test('published event edit opens the independent edit page without touching the publish tab', () => {
  let target = '';
  let storageWrites = 0;
  (globalThis as any).wx = {
    setStorageSync: () => { storageWrites += 1; },
    navigateTo: ({ url }: { url: string }) => { target = url; },
    showToast: () => undefined,
  };

  mineDefinition.editEvent({ currentTarget: { dataset: { id: 'event-published-1' } } });

  assert.equal(storageWrites, 0);
  assert.equal(target, '/pages/event-edit/index?id=event-published-1');
});

test('published card keeps the count and edit action in normal layout flow', () => {
  const markup = readFileSync(new URL('../pages/mine/index.wxml', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../pages/mine/index.wxss', import.meta.url), 'utf8');
  assert.match(markup, /published-card-actions/);
  assert.doesNotMatch(styles, /\.edit-button\s*\{[^}]*position:\s*absolute/);
});

let publishDefinition: any;
(globalThis as any).Page = (value: any) => { publishDefinition = value; };
await import('../pages/publish/index.ts');

test('meeting point input suggests recent and route points', () => {
  (globalThis as any).wx = {
    getStorageSync: () => [],
  };
  const page = {
    ...publishDefinition,
    data: structuredClone(publishDefinition.data),
    setData(update: Record<string, unknown>) { Object.assign(this.data, update); },
  };
  page.data.routes = [{
    id: 'route-1', name: '昌平环线', pois: [
      { id: 'poi-1', name: '北邵洼地铁站', note: '集合点名', kind: 'meeting' },
      { id: 'poi-2', name: '水库北岸', note: '补给', kind: 'supply' },
    ],
  }];
  page.updateLocationSuggestions('北');
  assert.equal(page.data.showLocationSuggestions, true);
  assert.equal(page.data.locationSuggestions[0].label, '北邵洼地铁站');
});

test('map selection keeps coordinates for activity navigation and typing clears stale coordinates', () => {
  (globalThis as any).wx = {
    getStorageSync: () => [],
    setStorageSync: () => undefined,
    chooseLocation: ({ success }: { success: (result: Record<string, unknown>) => void }) => success({ name: '龙井停车场', address: '龙井路', latitude: 30.2, longitude: 120.1 }),
  };
  const page = {
    ...publishDefinition,
    data: structuredClone(publishDefinition.data),
    setData(update: Record<string, unknown>) {
      for (const [path, value] of Object.entries(update)) {
        const parts = path.split('.');
        const leaf = parts.pop() as string;
        const target = parts.reduce((current: Record<string, any>, part) => current[part], this.data as Record<string, any>);
        target[leaf] = value;
      }
    },
  };
  page.chooseMeetingPointOnMap();
  assert.equal(page.data.form.meetingLatitude, 30.2);
  assert.equal(page.data.form.meetingLongitude, 120.1);
  page.onField({ currentTarget: { dataset: { field: 'meetingPoint' } }, detail: { value: '手动输入地点' } });
  assert.equal(page.data.form.meetingLatitude, undefined);
  assert.equal(page.data.form.meetingLongitude, undefined);
});

test('keyboard focus hides the sticky publish action until input blur settles', async () => {
  const markup = readFileSync(new URL('../pages/publish/index.wxml', import.meta.url), 'utf8');
  const page = {
    ...publishDefinition,
    data: structuredClone(publishDefinition.data),
    setData(update: Record<string, unknown>) { Object.assign(this.data, update); },
  };
  page.onKeyboardOpen();
  assert.equal(page.data.keyboardOpen, true);
  assert.match(markup, /wx:if="\{\{!keyboardOpen\}\}" class="sticky-actions"/);
  page.onKeyboardClose();
  await new Promise((resolve) => setTimeout(resolve, 140));
  assert.equal(page.data.keyboardOpen, false);
});

test('resetForNewEvent clears the previous new-event form', () => {
  const page = {
    ...publishDefinition,
    data: structuredClone(publishDefinition.data),
    setData(update: Record<string, unknown>, callback?: () => void) { Object.assign(this.data, update); callback?.(); },
  };
  page.data.form.title = '旧活动标题';
  page.data.form.meetingPoint = '旧集合点';
  page.resetForNewEvent();
  assert.equal(page.data.form.title, '');
  assert.equal(page.data.form.meetingPoint, '');
  assert.equal(page.data.selectedRoute, null);
});

test('publish page has no edit cache lifecycle or update call', () => {
  const source = readFileSync(new URL('../pages/publish/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /pending_edit_event_id|editingId|updateEvent\s*\(/);
  assert.doesNotMatch(source, /onShow\s*\(/);
});

test('event detail exposes latest change summary and expandable field comparison', () => {
  const source = readFileSync(new URL('../pages/event-detail/index.ts', import.meta.url), 'utf8');
  const markup = readFileSync(new URL('../pages/event-detail/index.wxml', import.meta.url), 'utf8');
  assert.match(source, /latestChange/);
  assert.match(source, /PUBLIC_CHANGE_FIELDS/);
  assert.match(source, /route: '活动路书'/);
  assert.match(source, /cover: '活动封面'/);
  assert.match(source, /toggleChangeNotice/);
  assert.match(source, /readableChangeValue/);
  assert.match(markup, /changeNotice\.summary/);
  assert.match(markup, /changeNotice\.changedFields/);
});

test('independent edit page enforces summary and three-change quota in the UI', () => {
  const source = readFileSync(new URL('../pages/event-edit/index.ts', import.meta.url), 'utf8');
  const markup = readFileSync(new URL('../pages/event-edit/index.wxml', import.meta.url), 'utf8');
  assert.match(source, /CHANGE_SUMMARY_LIMIT = 80/);
  assert.match(source, /changeLocked: changesRemaining === 0/);
  assert.match(source, /api\.updateEvent\(this\.data\.id/);
  assert.match(markup, /已修改 \{\{changeCount\}\} \/ \{\{changeLimit\}\} 次/);
  assert.match(markup, /maxlength="80"/);
  assert.doesNotMatch(source, /switchTab\([^)]*publish/);
  assert.match(source, /error instanceof ApiError/);
  assert.doesNotMatch(source, /description: event\.description, coverUrl: event\.coverUrl/);
  assert.match(source, /buildAutomaticChangeSummary/);
  assert.match(source, /活动信息没有发生变化/);
  assert.doesNotMatch(markup, /bindinput="onSummary"/);
  assert.match(markup, /系统根据修改内容自动生成/);
});
