import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { api } from '../services/api';
import { resolveAppleModal } from '../utils/apple-modal';

let mineDefinition: any;
(globalThis as any).Page = (value: any) => { mineDefinition = value; };
await import('../pages/mine/index.ts');

test('published event edit stores the id before switching to the publish tab', () => {
  let storedKey = '';
  let storedValue = '';
  let switchedTo = '';
  (globalThis as any).wx = {
    setStorageSync: (key: string, value: string) => { storedKey = key; storedValue = value; },
    switchTab: ({ url }: { url: string }) => { switchedTo = url; },
    showToast: () => undefined,
  };

  mineDefinition.editEvent({ currentTarget: { dataset: { id: 'event-published-1' } } });

  assert.equal(storedKey, 'pending_edit_event_id');
  assert.equal(storedValue, 'event-published-1');
  assert.equal(switchedTo, '/pages/publish/index');
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

test('resetForNewEvent clears edit mode and the previous event form', () => {
  const page = {
    ...publishDefinition,
    data: structuredClone(publishDefinition.data),
    setData(update: Record<string, unknown>, callback?: () => void) { Object.assign(this.data, update); callback?.(); },
  };
  page.data.editingId = 'event-old';
  page.data.form.title = '旧活动标题';
  page.data.form.meetingPoint = '旧集合点';
  page.resetForNewEvent();
  assert.equal(page.data.editingId, '');
  assert.equal(page.data.form.title, '');
  assert.equal(page.data.form.meetingPoint, '');
  assert.equal(page.data.selectedRoute, null);
});

test('submitting an edit resets the page so the next submit creates a new event', async () => {
  const calls: string[] = [];
  const originalUpdate = api.updateEvent;
  const originalPublish = api.publish;
  const originalSwitchTab = (globalThis as any).wx?.switchTab;
  (api as any).updateEvent = async () => { calls.push('update'); return {}; };
  (api as any).publish = async () => { calls.push('publish'); return {}; };
  (globalThis as any).wx = {
    showToast: () => undefined,
    switchTab: () => undefined,
  };
  const page = {
    ...publishDefinition,
    data: structuredClone(publishDefinition.data),
    setData(update: Record<string, unknown>, callback?: () => void) {
      for (const [path, value] of Object.entries(update)) {
        const parts = path.split('.');
        const leaf = parts.pop() as string;
        const target = parts.reduce((current: Record<string, any>, part) => current[part], this.data as Record<string, any>);
        target[leaf] = value;
      }
      callback?.();
    },
  };
  page.data.authReady = true;
  page.data.editingId = 'event-old';
  page.data.form = {
    ...page.data.form,
    title: 'Edited event', date: '2026-08-15', time: '06:30', meetingPoint: 'Start point',
    distanceKm: 80, elevationGainM: 600,
    description: 'A safe group ride with a leader and sweeper.',
    requirements: { equipment: ['Helmet'], recentDistanceKm: 50, recentElevationM: 400, bikeTypes: ['Road bike'], disciplines: ['Stay together'], customNote: '' },
  };

  try {
    const editRequest = page.submit();
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveAppleModal(page, true);
    await editRequest;
    assert.deepEqual(calls, ['update']);
    assert.equal(page.data.editingId, '');
    assert.equal(page.data.form.title, '');

    page.data.form.title = 'Brand new event';
    page.data.form.meetingPoint = 'Another start point';
    page.data.form.description = 'A new safe group ride with clear rules.';
    page.data.form.distanceKm = 60;
    const publishRequest = page.submit();
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveAppleModal(page, true);
    await publishRequest;
    assert.deepEqual(calls, ['update', 'publish']);
  } finally {
    (api as any).updateEvent = originalUpdate;
    (api as any).publish = originalPublish;
    if (originalSwitchTab) (globalThis as any).wx.switchTab = originalSwitchTab;
  }
});
