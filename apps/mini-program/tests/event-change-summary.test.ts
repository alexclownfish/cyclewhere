import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { PublishEventInput, RideRoute } from '../types/domain.ts';

(globalThis as any).Page = () => undefined;
const { buildAutomaticChangeSummary } = await import('../pages/event-edit/index.ts');

const original: PublishEventInput = {
  title: '周末晨骑', date: '2026-08-16', time: '07:00', meetingPoint: '北门',
  meetingLatitude: 39.9, meetingLongitude: 116.4, routeId: 'route-1', distanceKm: 80,
  elevationGainM: 600, difficulty: '中等', capacity: 20, speedRange: '25-28 km/h',
  description: '安全骑行', requirements: {
    equipment: ['骑行头盔'], recentDistanceKm: 50, recentElevationM: 500,
    bikeTypes: ['公路车'], disciplines: ['听从领队指挥'], customNote: '',
  },
};
const routes: RideRoute[] = [{
  id: 'route-1', name: '原路书', city: '北京', cover: '', distanceKm: 80, elevationGainM: 600,
  difficulty: '中等', durationMinutes: 180, maxGradient: 8, track: [], elevationProfile: [], pois: [],
}, {
  id: 'route-2', name: '环湖路线', city: '北京', cover: '', distanceKm: 100, elevationGainM: 800,
  difficulty: '进阶', durationMinutes: 240, maxGradient: 10, track: [], elevationProfile: [], pois: [],
}];
const serialized = JSON.stringify(original);

test('automatic change summary describes a single important edit', () => {
  const current = structuredClone(original);
  current.time = '07:30';
  const result = buildAutomaticChangeSummary(serialized, current, routes);
  assert.equal(result.summary, '出发时间改为 2026-08-16 07:30');
  assert.deepEqual(result.labels, ['出发时间']);
});

test('automatic change summary compresses many edits to the backend limit', () => {
  const current = structuredClone(original);
  Object.assign(current, {
    title: '一个很长但合法的全新周末骑行活动名称', date: '2026-09-20', time: '06:20',
    meetingPoint: '城市东部非常长的新集合地点名称', routeId: 'route-2', capacity: 30,
    speedRange: '28-32 km/h', description: '新的活动说明', coverFilePath: 'temp.jpg',
  });
  current.requirements = { equipment: ['骑行头盔', '前后车灯'], recentDistanceKm: 80, recentElevationM: 900, bikeTypes: ['公路车', '砾石车'], disciplines: ['保持安全车距'], customNote: '新要求' };
  const result = buildAutomaticChangeSummary(serialized, current, routes);
  assert.ok(result.summary.startsWith('已调整：'));
  assert.ok(Array.from(result.summary).length <= 80);
  assert.ok(result.labels.includes('活动路书'));
  assert.ok(result.labels.includes('活动封面'));
});

test('automatic change summary clears after fields return to original values', () => {
  assert.deepEqual(buildAutomaticChangeSummary(serialized, structuredClone(original), routes), { summary: '', labels: [] });
});
