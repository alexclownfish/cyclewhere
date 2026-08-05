import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createAuthenticationProvider, createRealApi, type RequestSpec, type Transport } from '../services/api.ts';
import type { BackendEvent, BackendRegistrationResult, BackendRoadbook } from '../services/api-contract.ts';
import type { PublishEventInput, RegistrationInput } from '../types/domain.ts';

const roadbook: BackendRoadbook = {
  id: 'route-1', ownerId: 'organizer-demo', name: '西湖群山环线', description: '测试路书说明', distanceKm: 68.4,
  elevationGainM: 1060, estimatedMinutes: 240, difficulty: 'challenging', region: '杭州', coordinateSystem: 'WGS84',
  track: [
    { longitude: 120.104, latitude: 30.222 },
    { longitude: 120.096, latitude: 30.205 },
    { longitude: 120.087, latitude: 30.191 },
  ],
  elevationProfile: [35, 420, 180], maxGradient: 11.8,
  waypoints: [
    { name: '龙井集合点', type: 'start', longitude: 120.104, latitude: 30.222, distanceKm: 0 },
    { name: '梅家坞补水', type: 'water', longitude: 120.087, latitude: 30.191, distanceKm: 23.6 },
  ],
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
};

const backendEvent: BackendEvent = {
  id: 'event-1', organizerId: 'organizer-demo', routeId: 'route-1', title: '西湖群山晨间爬坡',
  summary: '稳定拉练，设置等候点，适合有连续爬坡经验的骑友。', startAt: '2026-09-12T23:00:00.000Z',
  registrationDeadline: '2026-09-11T12:00:00.000Z', meetingPoint: '杭州龙井路停车场入口', difficulty: 'challenging',
  distanceKm: 68.4, elevationGainM: 1060, speedMinKph: 24, speedMaxKph: 29, capacity: 20, registrationCount: 3,
  equipmentRequirements: ['头盔', '前后车灯'], abilityRequirements: ['近三个月完成过 60 公里骑行', '累计爬升 800 米'],
  safetyNotice: '遵守交通规则，路线可能因天气调整。', status: 'published', createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z', version: 1,
};

const auth = () => ({ Authorization: 'Bearer verified-test-token' });

test('list adapter consumes backend pages and maps event/roadbook field names', async () => {
  const transport: Transport = async <T>(spec: RequestSpec) => {
    if (spec.url.startsWith('/api/v1/events')) return { items: [backendEvent], nextCursor: null } as T;
    if (spec.url.startsWith('/api/v1/routes')) return { items: [roadbook], nextCursor: null } as T;
    throw new Error(`unexpected ${spec.url}`);
  };
  const [event] = await createRealApi(transport, 'organizer-demo', auth).listEvents();
  assert.equal(event.registeredCount, 3);
  assert.equal(event.registrationDeadline, backendEvent.registrationDeadline);
  assert.equal(event.description, backendEvent.summary);
  assert.equal(event.route.city, '杭州');
  assert.equal(event.route.durationMinutes, 240);
  assert.equal(event.route.pois.length, 2);
  assert.equal(event.route.track.length, roadbook.track.length);
  assert.deepEqual(event.route.elevationProfile, roadbook.elevationProfile);
  assert.equal(event.route.maxGradient, 11.8);
  assert.notEqual(event.route.track[0].longitude, roadbook.track[0].longitude);
  assert.equal(event.ownedByMe, true);
});

test('registration sends the encrypted-field payload contract and keeps one supplied idempotency key', async () => {
  let captured: RequestSpec | undefined;
  const result: BackendRegistrationResult = {
    registration: { id: 'reg-1', eventId: 'event-1', userId: 'user-1', status: 'active', abilityConfirmed: true, equipmentConfirmed: true, waiverVersion: 'v1.0', waiverAcceptedAt: '2026-08-02T00:00:00.000Z', createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z', cancelledAt: null },
    event: backendEvent, replayed: false,
  };
  const transport: Transport = async <T>(spec: RequestSpec) => { captured = spec; return result as T; };
  const input: RegistrationInput = { phone: '13800006721', emergencyContact: '林先生 13600001048', bikeType: '公路车', abilityConfirmed: true, waiverConfirmed: true };
  const registration = await createRealApi(transport, 'user-1', auth).register('event-1', input, 'intent-event-1-100');
  assert.equal(registration.status, 'approved');
  assert.deepEqual(captured?.data, {
    phone: input.phone,
    emergencyContact: input.emergencyContact,
    bikeType: input.bikeType,
    abilityConfirmed: true,
    equipmentConfirmed: true,
    waiverVersion: 'v1.0',
  });
  assert.equal(captured?.header?.['Idempotency-Key'], 'intent-event-1-100');
  assert.equal(captured?.header?.Authorization, 'Bearer verified-test-token');
  assert.equal(captured?.header?.['x-user-id'], undefined);
});

test('authentication provider exchanges one WeChat code and reuses the stored bearer token', async () => {
  const values = new Map<string, unknown>();
  let exchangeCount = 0;
  const transport: Transport = async <T>(spec: RequestSpec) => {
    assert.equal(spec.url, '/api/v1/auth/wechat/login');
    exchangeCount += 1;
    return { accessToken: 'issued-token', expiresIn: 604800, user: { id: 'user-1' } } as T;
  };
  const provider = createAuthenticationProvider(
    transport,
    async () => 'wechat-temporary-code',
    { get: (key) => values.get(key), set: (key, value) => values.set(key, value) },
  );
  const [first, concurrent] = await Promise.all([provider(), provider()]);
  const reused = await provider();
  assert.deepEqual(first, { Authorization: 'Bearer issued-token' });
  assert.deepEqual(concurrent, first);
  assert.deepEqual(reused, first);
  assert.equal(exchangeCount, 1);
  assert.equal((values.get('demo_account') as { id: string }).id, 'user-1');
});

test('my registrations uses the JWT aggregate endpoint and keeps historical event data', async () => {
  const cancelledRegistration = {
    id: 'reg-history', eventId: backendEvent.id, userId: 'user-1', status: 'cancelled' as const,
    abilityConfirmed: true, equipmentConfirmed: true, waiverVersion: 'v1.0', waiverAcceptedAt: '2026-08-02T00:00:00.000Z',
    createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z', cancelledAt: '2026-08-03T00:00:00.000Z',
  };
  const calls: RequestSpec[] = [];
  const transport: Transport = async <T>(spec: RequestSpec) => {
    calls.push(spec);
    return { items: [{ registration: cancelledRegistration, event: { ...backendEvent, status: 'completed' } }] } as T;
  };
  const records = await createRealApi(transport, 'user-1', auth).getMyRegistrationRecords();
  assert.deepEqual(calls.map((item) => item.url), ['/api/v1/me/registrations']);
  assert.equal(calls[0].header?.Authorization, 'Bearer verified-test-token');
  assert.equal(records[0].registration.status, 'cancelled');
  assert.equal(records[0].event.status, 'completed');
  assert.equal(records[0].event.registrationDeadline, backendEvent.registrationDeadline);
});

test('publish adapter creates a draft then calls publish endpoint', async () => {
  const calls: RequestSpec[] = [];
  const transport: Transport = async <T>(spec: RequestSpec) => {
    calls.push(spec);
    if (spec.url === '/api/v1/routes/route-1') return roadbook as T;
    if (spec.url === '/api/v1/events') return { ...backendEvent, status: 'draft' } as T;
    if (spec.url === '/api/v1/events/event-1/publish') return backendEvent as T;
    throw new Error(`unexpected ${spec.url}`);
  };
  const input: PublishEventInput = {
    title: '西湖群山晨间爬坡', date: '2026-09-13', time: '07:00', meetingPoint: '杭州龙井路停车场入口',
    routeId: 'route-1', capacity: 20, speedRange: '24-29 km/h', description: '遵守交通规则，路线可能因天气调整。',
    requirements: { equipment: ['头盔'], recentDistanceKm: 60, recentElevationM: 800, bikeTypes: ['公路车'], disciplines: ['听从领队指挥'] },
  };
  const event = await createRealApi(transport, 'organizer-demo', auth).publish(input);
  assert.deepEqual(calls.map((item) => `${item.method} ${item.url}`), [
    'GET /api/v1/routes/route-1', 'POST /api/v1/events', 'POST /api/v1/events/event-1/publish',
  ]);
  assert.equal((calls[1].data as { summary: string }).summary, input.description);
  assert.equal(event.status, 'published');
});
