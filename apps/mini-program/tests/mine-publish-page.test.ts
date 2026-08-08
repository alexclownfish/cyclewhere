import { strict as assert } from 'node:assert';
import { test } from 'node:test';

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
