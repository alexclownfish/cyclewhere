import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { PublishEventInput, RegistrationInput } from '../types/domain.ts';

const memory = new Map<string, unknown>();
(globalThis as any).wx = {
  getStorageSync: (key: string) => memory.get(key),
  setStorageSync: (key: string, value: unknown) => memory.set(key, structuredClone(value)),
};

const { mockApi } = await import('../services/mock-api.ts');
const actualDateNow = Date.now;

const registrationInput: RegistrationInput = {
  phone: '13800006721', emergencyContact: '林先生 13600001048', bikeType: '公路车',
  abilityConfirmed: true, waiverConfirmed: true,
};

test.beforeEach(() => {
  memory.clear();
  Date.now = () => Date.parse('2026-08-06T00:00:00.000Z');
});
test.afterEach(() => { Date.now = actualDateNow; });

test('duplicate registration returns one record and consumes one place', async () => {
  const before = await mockApi.getEvent('event-miaofeng');
  const first = await mockApi.register('event-miaofeng', registrationInput);
  const second = await mockApi.register('event-miaofeng', registrationInput);
  const after = await mockApi.getEvent('event-miaofeng');
  assert.equal(second.id, first.id);
  assert.equal(after.registeredCount, before.registeredCount + 1);
  assert.equal((await mockApi.getMyRegistrations()).length, 1);
});

test('cancelling registration releases capacity and is idempotent', async () => {
  const before = await mockApi.getEvent('event-shisanling');
  await mockApi.register('event-shisanling', registrationInput);
  await mockApi.cancelRegistration('event-shisanling');
  await mockApi.cancelRegistration('event-shisanling');
  const after = await mockApi.getEvent('event-shisanling');
  assert.equal(after.registeredCount, before.registeredCount);
});

test('published event becomes visible and owned by current user', async () => {
  const input: PublishEventInput = {
    title: '测试发布活动', date: '2026-08-30', time: '07:00', meetingPoint: '北邵洼地铁站 B 口',
    routeId: 'route-shisanling', capacity: 12, speedRange: '22-25 km/h', description: '测试',
    requirements: { equipment: ['骑行头盔'], recentDistanceKm: 50, recentElevationM: 300, bikeTypes: ['公路车'], disciplines: ['听从领队指挥'] },
  };
  const published = await mockApi.publish(input);
  assert.equal(published.ownedByMe, true);
  assert.equal(published.registeredCount, 1);
  assert.equal((await mockApi.listEvents())[0].id, published.id);
});

test('capacity state changes to full and reopens after cancellation', async () => {
  const input: PublishEventInput = {
    title: '两人容量测试活动', date: '2026-08-31', time: '07:00', meetingPoint: '北邵洼地铁站 B 口',
    routeId: 'route-shisanling', capacity: 2, speedRange: '22-25 km/h', description: '测试',
    requirements: { equipment: ['骑行头盔'], recentDistanceKm: 50, recentElevationM: 300, bikeTypes: ['公路车'], disciplines: ['听从领队指挥'] },
  };
  const published = await mockApi.publish(input);
  await mockApi.register(published.id, registrationInput);
  assert.equal((await mockApi.getEvent(published.id)).status, 'full');
  await mockApi.cancelRegistration(published.id);
  assert.equal((await mockApi.getEvent(published.id)).status, 'published');
});
